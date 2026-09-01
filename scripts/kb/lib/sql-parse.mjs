/**
 * Heuristic SQL parsing for the Livil migration set.
 *
 * SCOPE AND HONESTY (Constitution P32 — "green is a claim, and claims must be earned"):
 * This is a regex-driven reader, NOT a PostgreSQL parser. It is good enough to build an
 * inventory and to FLAG things worth a human look. It is not sound, and a clean report
 * from it is never proof that anything is safe. Every generated document must say so.
 *
 * Known limits:
 *   - Does not resolve dynamic SQL, EXECUTE, or anything built at runtime
 *   - Does not follow function-to-function call chains beyond one hop
 *   - Cannot see objects created outside this repo (12 core tables predate migrations)
 *   - Comment-stripping is naive about $$-quoted bodies containing '--'
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadMigrations(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => ({ file, sql: readFileSync(join(dir, file), 'utf8') }));
}

/** Strip line comments outside of $$ bodies. Naive; see limits above. */
export function stripComments(sql) {
  return sql
    .split('\n')
    .map(l => l.replace(/^\s*--.*$/, ''))
    .join('\n');
}

// ── Tables ───────────────────────────────────────────────────────────────────

export function parseTables(migrations) {
  const tables = new Map();

  for (const { file, sql } of migrations) {
    const body = stripComments(sql);

    // create table [if not exists] [public.]name ( ... )
    for (const m of body.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      const name = m[1];
      const cols = extractParenBlock(body, m.index + m[0].length - 1);
      if (!tables.has(name)) {
        tables.set(name, { name, definedIn: file, columns: [], altered: [], indexes: [] });
      }
      const t = tables.get(name);
      t.definedIn ??= file;
      for (const line of splitTopLevel(cols)) {
        const c = line.trim();
        if (!c) continue;
        if (/^(primary\s+key|unique|constraint|check|foreign\s+key|exclude)\b/i.test(c)) {
          t.columns.push({ name: null, def: c, isConstraint: true });
          continue;
        }
        const cm = c.match(/^([a-z_][a-z0-9_]*)\s+(.+)$/is);
        if (cm) t.columns.push({ name: cm[1], def: cm[2].replace(/\s+/g, ' ').trim() });
      }
    }

    // alter table name add column [if not exists] col type
    for (const m of body.matchAll(
      /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
    )) {
      const name = m[1];
      for (const c of m[2].matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+([^,;]+)/gi,
      )) {
        if (!tables.has(name)) {
          tables.set(name, { name, definedIn: null, columns: [], altered: [], indexes: [] });
        }
        tables.get(name).altered.push({
          column: c[1],
          def: c[2].replace(/\s+/g, ' ').trim(),
          file,
        });
      }
    }

    // indexes
    for (const m of body.matchAll(
      /create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)?\s*on\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*([^;]*);/gi,
    )) {
      const name = m[3];
      if (!tables.has(name)) {
        tables.set(name, { name, definedIn: null, columns: [], altered: [], indexes: [] });
      }
      tables.get(name).indexes.push({
        name: m[2] || '(unnamed)',
        unique: Boolean(m[1]),
        spec: m[4].replace(/\s+/g, ' ').trim(),
        file,
      });
    }
  }

  return tables;
}

/** Tables referenced anywhere but never created in this repo. */
export function findUndefinedTables(tables, migrations) {
  const referenced = new Set();
  for (const { sql } of migrations) {
    const body = stripComments(sql);
    for (const m of body.matchAll(
      /(?:alter\s+table|create\s+policy\s+"[^"]*"\s+on|references|from|join|update|insert\s+into|on)\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      referenced.add(m[1]);
    }
  }
  const out = [];
  for (const [name, t] of tables) if (!t.definedIn) out.push(name);
  return out.sort();
}

// ── RLS ──────────────────────────────────────────────────────────────────────

/**
 * Replays migrations in order. A policy's final state is whatever the last migration
 * to mention it did — CREATE or DROP. Without replaying drops, a policy that has been
 * removed is still reported as live, which puts false findings in a security report.
 */
export function parseRls(migrations) {
  const rlsEnabled = new Set();
  const live = new Map(); // `${table}.${policy}` → policy record

  for (const { file, sql } of migrations) {
    const body = stripComments(sql);

    for (const m of body.matchAll(
      /alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi,
    )) {
      rlsEnabled.add(m[1]);
    }

    // Drops first; a create later in the same file re-adds.
    for (const d of body.matchAll(
      /drop\s+policy\s+(?:if\s+exists\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      live.delete(`${d[3]}.${d[1] ?? d[2]}`);
    }

    for (const m of body.matchAll(
      /create\s+policy\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+for\s+([a-z]+)([\s\S]*?);/gi,
    )) {
      const [, quoted, bare, table, command, rest] = m;
      const name = quoted ?? bare;
      const roleMatch = rest.match(/\bto\s+([a-z_, ]+?)\s*(?:using|with\s+check|$)/i);
      const usingMatch = rest.match(/\busing\s*\(([\s\S]*?)\)\s*(?:with\s+check|$)/i);
      const checkMatch = rest.match(/\bwith\s+check\s*\(([\s\S]*)$/i);
      const norm = s => (s ? s.replace(/\s+/g, ' ').trim().replace(/\)+$/, '') : null);

      live.set(`${table}.${name}`, {
        name,
        table,
        command: command.toLowerCase(),
        roles: roleMatch ? roleMatch[1].trim() : null,
        using: norm(usingMatch?.[1]),
        withCheck: norm(checkMatch?.[1]),
        file,
      });
    }
  }

  return { rlsEnabled, policies: [...live.values()] };
}

/** A select policy readable by everyone, including anon when no role is scoped. */
export function isPermissive(policy) {
  const expr = (policy.using || '').replace(/\s/g, '').toLowerCase();
  return expr === 'true';
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Authorization helpers in this codebase. A call to one of these is treated as a
 * genuine authorization guard.
 */
const AUTHZ_HELPERS = ['assert_friendship', 'is_conversation_member'];

/**
 * THE KEY DISTINCTION.
 *
 * `if v_me is null then raise exception 'not_authenticated'` is an AUTHENTICATION
 * check. It proves someone is logged in. It proves NOTHING about whether they may
 * touch the resource identified by the function's parameters.
 *
 * Both known privilege-escalation bugs in this codebase carry exactly this line,
 * which is why they read as guarded at a glance. The classifier must not be fooled
 * the way a human skimming the file was.
 */
const AUTHN_ONLY = /is\s+null\s+then\s+raise\s+exception\s+'not_authenticated'/i;

/**
 * Replays migrations in filename order. A function's final state is whatever the last
 * migration to mention it did — CREATE OR REPLACE, or DROP. Without this, dropped
 * functions are reported as live, which sends reviewers after code that no longer exists.
 */
export function parseFunctions(migrations) {
  const fns = new Map();
  const grants = parseGrants(migrations);

  for (const { file, sql } of migrations) {
    const body = stripComments(sql);

    // Process drops for this migration before creates, then let creates in the same
    // file re-add anything recreated.
    for (const d of body.matchAll(
      /drop\s+function\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi,
    )) {
      fns.delete(d[1]);
    }

    // Handles: optional `public.` schema prefix; balanced parens in the parameter list
    // (e.g. numeric(10,3)); and any dollar-quote tag ($$ or $function$).
    const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;

    for (const m of body.matchAll(head)) {
      const name = m[1];
      const openIdx = m.index + m[0].length - 1;
      const params = extractParenBlock(body, openIdx);
      if (params === null) continue;

      const afterParams = body.indexOf(')', openIdx + params.length) + 1;

      // Dollar-quoted body: find the opening tag, then its matching close.
      const tagMatch = body.slice(afterParams).match(/\$([a-z_]*)\$/i);
      if (!tagMatch) continue;
      const tag = `$${tagMatch[1]}$`;
      const bodyStart = afterParams + tagMatch.index + tag.length;
      const bodyEnd = body.indexOf(tag, bodyStart);
      if (bodyEnd === -1) continue;

      const header = body.slice(afterParams, afterParams + tagMatch.index);
      const fnBody = body.slice(bodyStart, bodyEnd);

      const isDefiner = /security\s+definer/i.test(header);
      const isInvoker = /security\s+invoker/i.test(header);
      const returnsTrigger = /returns\s+trigger\b/i.test(header);

      // Later migrations replace earlier definitions; last wins, as in Postgres.
      fns.set(name, {
        name,
        params: params.replace(/\s+/g, ' ').trim(),
        security: isDefiner ? 'DEFINER' : isInvoker ? 'INVOKER' : 'DEFAULT (INVOKER)',
        returnsTrigger,
        grantedTo: grants.get(name) ?? null,
        anonCallable: (grants.get(name) ?? '').includes('anon'),
        file,
        body: fnBody,
        ...classifyGuard(name, params, fnBody, isDefiner, returnsTrigger),
      });
    }
  }

  return fns;
}

function parseGrants(migrations) {
  const out = new Map();
  for (const { sql } of migrations) {
    for (const m of stripComments(sql).matchAll(
      /grant\s+execute\s+on\s+function\s+([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*to\s+([a-z_, ]+);/gi,
    )) {
      out.set(m[1], m[2].replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

/**
 * Caller-supplied references to PRE-EXISTING objects.
 *
 * This codebase uses a consistent convention: parameters prefixed `p_` name an object
 * the caller did not necessarily create and may not belong to (`p_conversation_id`,
 * `p_jam_room_id`, `p_member_ids`). Parameters like `target_user_id` / `other_user_id`
 * are the *counterparty* to a symmetric relation where the actor is always the caller,
 * which is a different and far lower risk shape.
 *
 * This is a naming-convention heuristic. If the convention drifts, so does this check.
 */
const FOREIGN_REF_PARAM = /\bp_[a-z_]*_ids?\b/i;

/**
 * Tables where a row GRANTS ACCESS rather than merely recording that something happened.
 *
 * This is the distinction the syntax cannot express. `get_jam_snapshot` and
 * `activity_record_play` are structurally identical — both SECURITY DEFINER, both take a
 * caller-supplied object id, both insert a row attributed to the caller. The difference is
 * entirely in what the row MEANS: membership in a private room versus an entry in a view
 * log. Only the first is a privilege escalation.
 *
 * A regex cannot know this. Naming it here makes the judgement explicit and reviewable
 * instead of hiding it inside a verdict.
 */
const ACCESS_GRANTING_TABLE = /_members$|^jam_rooms$|^conversations$|^friendships$|^follows$/i;

const SQL_KEYWORDS = new Set(['set', 'where', 'select', 'from', 'values', 'returning', 'only']);

function writeTargets(body) {
  const t = new Set();
  for (const m of body.matchAll(
    /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  )) {
    // `on conflict ... do update set` yields a bogus "set" target.
    if (!SQL_KEYWORDS.has(m[1].toLowerCase())) t.add(m[1]);
  }
  return [...t];
}

function classifyGuard(name, params, body, isDefiner, returnsTrigger) {
  const mutates = /\b(insert\s+into|update\s+|delete\s+from)\b/i.test(body);
  const takesForeignRef = FOREIGN_REF_PARAM.test(params);
  const writes = writeTargets(body);
  const grantsAccess = writes.some(t => ACCESS_GRANTING_TABLE.test(t));

  const calledHelpers = AUTHZ_HELPERS.filter(h => new RegExp(`\\b${h}\\s*\\(`, 'i').test(body));

  // An existence test binding auth.uid() to the resource, followed by a rejection.
  const hasAuthzGate =
    /if\s+not\s+exists\s*\([\s\S]*?auth\.uid\(\)[\s\S]*?\)\s*then[\s\S]{0,200}?raise\s+exception/i.test(body);

  // The actor is derived from the session rather than supplied by the caller.
  const actorFromSession = /\b(me|v_me|v_uid|v_user)\s+uuid\s*:=\s*auth\.uid\(\)/i.test(body);

  const authnOnly = AUTHN_ONLY.test(body);

  let verdict;
  let reason;

  if (returnsTrigger) {
    verdict = 'TRIGGER';
    reason = 'trigger function — fires on row events, not callable with caller-supplied arguments';
  } else if (!isDefiner) {
    verdict = 'N/A';
    reason = 'not SECURITY DEFINER — row-level security still applies';
  } else if (calledHelpers.length) {
    verdict = 'GUARDED';
    reason = `calls ${calledHelpers.join(', ')}`;
  } else if (hasAuthzGate) {
    verdict = 'GUARDED';
    reason = 'rejects when the caller is not bound to the resource';
  } else if (takesForeignRef && mutates && grantsAccess) {
    verdict = 'UNGUARDED';
    reason =
      `writes to ${writes.filter(t => ACCESS_GRANTING_TABLE.test(t)).join(', ')} — a row there ` +
      'GRANTS ACCESS — using a caller-supplied object id, with no membership check' +
      (authnOnly ? '; the only check present confirms authentication, not authorization' : '');
  } else if (takesForeignRef && mutates) {
    verdict = 'REVIEW';
    reason =
      `writes to ${writes.join(', ')} using a caller-supplied object id with no authorization ` +
      'check found. These rows do not appear to grant access, so this is likely abuse ' +
      'surface (forgery, metric inflation) rather than privilege escalation — needs human judgement';
  } else if (takesForeignRef && !mutates) {
    verdict = 'REVIEW';
    reason = 'reads a caller-supplied object id with no authorization check found';
  } else if (actorFromSession) {
    verdict = 'SELF-SCOPED';
    reason = 'actor derived from auth.uid(); the caller can only act as themselves';
  } else if (!mutates) {
    verdict = 'READ-ONLY';
    reason = 'no write detected';
  } else {
    verdict = 'REVIEW';
    reason = 'writes, and no authorization check was recognised';
  }

  return {
    verdict, reason, mutates, takesForeignRef, authnOnly, actorFromSession,
    writes, grantsAccess,
  };
}

// ── Realtime ─────────────────────────────────────────────────────────────────

export function parsePublications(migrations) {
  const pub = new Set();
  for (const { sql } of migrations) {
    for (const m of stripComments(sql).matchAll(
      /alter\s+publication\s+supabase_realtime\s+add\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      pub.add(m[1]);
    }
  }
  return pub;
}

export function parseTriggers(migrations) {
  const out = [];
  for (const { file, sql } of migrations) {
    for (const m of stripComments(sql).matchAll(
      /create\s+trigger\s+([a-z_][a-z0-9_]*)\s+([\s\S]*?)\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
    )) {
      out.push({
        name: m[1],
        timing: m[2].replace(/\s+/g, ' ').trim(),
        table: m[3],
        rest: m[4].replace(/\s+/g, ' ').trim(),
        file,
      });
    }
  }
  return out;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function extractParenBlock(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return '';
}

function splitTopLevel(block) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of block) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function frontmatter({ tier, owner, consumers, visibility, verifiedBy = 'generated' }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    '---',
    `tier: ${tier}`,
    `owner: ${owner}`,
    `consumers: [${consumers.join(', ')}]`,
    `last_verified: ${today}`,
    'verify_every: 9999d',
    `verified_by: ${verifiedBy}`,
    `visibility: ${visibility}`,
    'supersedes: []',
    'related_adrs: []',
    '---',
    '',
  ].join('\n');
}

/**
 * Writes a generated document, but keeps its recorded `last_verified` when NOTHING ELSE
 * in the file changed.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `frontmatter()` above stamps TODAY on every run, unconditionally. CI runs
 * `kb:generate --check`, which regenerates and diffs against what is committed. So a
 * document generated on one day differs from its own regeneration on the next — by the
 * date line, and by nothing else.
 *
 * The generated docs on `main` were last written 2026-08-19. From 2026-08-20 the
 * "knowledge base" gate therefore failed on EVERY open pull request, none of which had
 * touched a generated document, and its instruction — "Run: npm run kb:generate" —
 * bought exactly one more day before failing again. Four pull requests sat red behind
 * it, and the repository merged nothing for twelve days.
 *
 * A gate that fires on every change for a reason no change caused is not a gate, it is
 * a calendar (P6). The date now moves when the CONTENT moves, which is what
 * `last_verified` was always claiming to record.
 *
 * Returns true when the file was actually rewritten.
 */
export function writeGenerated(path, content) {
  if (existsSync(path) && sameButForDate(readFileSync(path, 'utf8'), content)) return false;
  writeFileSync(path, content);
  return true;
}

const VERIFIED_LINE = /^last_verified: \d{4}-\d{2}-\d{2}$/m;
const sameButForDate = (a, b) =>
  a.replace(VERIFIED_LINE, 'last_verified: -') === b.replace(VERIFIED_LINE, 'last_verified: -');

export const GENERATED_WARNING =
  '> **GENERATED FILE — DO NOT EDIT.**\n' +
  '> Produced by `npm run kb:generate`. Edits are overwritten on the next run.\n' +
  '> To change this document, change the generator or the source it reads.';
