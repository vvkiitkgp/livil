#!/usr/bin/env node
/**
 * Fails when a SECURITY DEFINER function in `public` is left executable by `anon`.
 *
 * ── WHY THIS IS A TEXT LINT AND NOT A DATABASE ASSERTION ───────────────────
 *
 * The obvious implementation — build the schema, ask `has_function_privilege` —
 * cannot work here, and the reason is the whole point of the check.
 *
 * Supabase issues a DEFAULT PRIVILEGE granting EXECUTE on every new function in
 * `public` to `anon`. CI's Postgres does not: `.github/workflows/ci.yml` creates
 * the `anon` role but never sets those default privileges. So a function that is
 * anon-executable in production has no anon grant at all in CI, and a live
 * assertion would pass every time while production stayed open. That mismatch is
 * precisely how three migrations shipped believing they had revoked something.
 *
 * Reading the SQL instead sidesteps the fidelity problem: the mistake is visible
 * in the text.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * A `SECURITY DEFINER` function created in `public` must either
 *
 *   * be revoked from anon somewhere in the migration set —
 *     `REVOKE EXECUTE ON FUNCTION public.f(...) FROM anon;`  or
 *   * be listed in BASELINE below, with a reason.
 *
 * `REVOKE ... FROM public` does NOT count, and that is deliberate. It drops the
 * PUBLIC pseudo-role grant and leaves the direct `anon` grant untouched. It reads
 * like a guard, is not one, and has now been written that way three separate
 * times (20260806040000 corrected four instances; 20260808130000 corrected seven
 * more). Rejecting it is the entire purpose of this file.
 *
 * ── THE BASELINE IS A RATCHET, NOT AN APPROVAL ─────────────────────────────
 *
 * Entries below are functions that were already anon-executable when this lint
 * was written. Listing one is not a statement that it is correct — only that it
 * predates the rule and is not this commit's to change. Some are load-bearing
 * (signup runs before an account exists); most are simply legacy and fail closed
 * on their own because `auth.uid()` is null for anon. Shrinking this list is
 * work worth doing; growing it needs a reason in the comment.
 *
 *   node scripts/check-definer-anon-grants.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(REPO, 'supabase/migrations');

/**
 * Functions that may be executed by anon. Each needs a reason.
 *
 * "reachable before sign-in" is the only justification that makes a function
 * BELONG here. Everything marked "legacy" is debt: it is anon-executable because
 * an early migration wrote `REVOKE ... FROM public` and stopped, not because
 * anyone decided anon should reach it.
 */
const BASELINE = new Map([
  // Genuinely reachable before an account exists.
  ['is_username_available', 'signup form, both clients, before an account exists'],
  ['waitlist_request', 'the waitlist form is public by design'],
  ['handle_new_user', 'signup trigger — runs as the row is created'],
  ['welcome_email_mark', 'signup-time bookkeeping'],
  ['claim_username', 'runs during onboarding, immediately post-signup'],
  // Not legacy and not an oversight: this one is anon-executable ON PURPOSE, and the
  // grant is written out in 20260901000000 rather than inherited from Supabase's
  // defaults. It IS the public share page — a livil-music.com/p/<id> link has to render
  // for someone with no account, which is the whole product. Revoking it, the other fix
  // this lint suggests, would blank every shared link.
  //
  // What keeps it inside the rule's intent: the return type is an ENUMERATED column
  // list rather than `select *`, `kind = 'upload'` excludes reposts in the WHERE clause,
  // and views_count is withheld. The post id is a v4 uuid with no listing endpoint, so
  // it is a capability rather than a guessable handle. The migration header argues all
  // of this at length — read it before shrinking or widening this entry.
  ['shared_post_public', 'the public share page; anon read by design, enumerated columns'],

  // Legacy. Anon-executable since the relationship layer shipped; each raises
  // 'not_authenticated' when auth.uid() is null, so they fail closed on their own.
  // Listed to stop this lint failing on pre-existing state, not to bless it.
  ['send_friend_request', 'legacy — fails closed on auth.uid() null'],
  ['accept_friend_request', 'legacy — fails closed on auth.uid() null'],
  ['reject_friend_request', 'legacy — fails closed on auth.uid() null'],
  ['cancel_friend_request', 'legacy — fails closed on auth.uid() null'],
  ['remove_friend', 'legacy — fails closed on auth.uid() null'],
  ['add_star', 'legacy — fails closed on auth.uid() null'],
  ['remove_star', 'legacy — fails closed on auth.uid() null'],
  ['get_or_create_dm', 'legacy — asserts friendship and caller participation'],
  ['assert_friendship', 'legacy — helper, raises when the pair are not friends'],
  ['list_incoming_friend_requests', 'legacy — returns nothing for a null uid'],
  ['is_conversation_member', 'legacy — false for a null uid'],
  ['message_preview', 'legacy — pure formatter, no data access'],
  ['update_conversation_last_message', 'trigger'],
  ['get_jam_snapshot', 'legacy — jam room read'],
  ['waitlist_mark_emailed', 'legacy — service-side bookkeeping'],
  ['list_my_conversations', 'legacy — scoped to auth.uid(), empty for anon'],
  ['create_group', 'legacy — fails closed on auth.uid() null'],
  ['create_jam_room', 'legacy — fails closed on auth.uid() null'],
  ['broadcast_jam_state', 'legacy — membership-checked'],
  ['activity_list', 'legacy — scoped to auth.uid(), empty for anon'],
  ['activity_unread_count', 'legacy — scoped to auth.uid(), 0 for anon'],
  ['activity_mark_all_read', 'legacy — scoped to auth.uid(), no-op for anon'],
  ['activity_mark_read', 'legacy — scoped to auth.uid(), no-op for anon'],
  ['recompute_conversation_last_message', 'trigger helper'],
  ['enforce_username_reservation', 'trigger'],

  // ── Flagged, not blessed ───────────────────────────────────────────────────
  // get_email_for_username(p_username) returns the account's email from
  // auth.users for any username, and anon CAN call it. That is not incidental:
  // username sign-in resolves the address before an account session exists
  // (src/screens/auth/SignInScreen.tsx), so revoking it breaks logging in by
  // username on both clients.
  //
  // It is still an email-harvesting endpoint. Anyone who can guess or enumerate
  // usernames can read the address behind each one, unauthenticated. Baselined
  // because removing the grant without replacing the sign-in flow would take
  // username login down — NOT because the exposure is acceptable. Fixing it
  // properly means not returning the address at all: resolve username → session
  // inside one privileged call, so the email never crosses the wire.
  ['get_email_for_username', 'FLAGGED: anon email lookup — load-bearing for username sign-in, see note'],
]);

/** Strip -- line comments and /* *\/ blocks so keywords inside them do not match. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Function bodies are dollar-quoted and routinely contain the word "function"
 * and even nested CREATEs in DO blocks. Blank the bodies out before scanning so
 * only top-level statements are considered.
 */
function stripDollarBodies(sql) {
  return sql.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, ' BODY ');
}

const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

/** name -> { file, definer } for the LAST declaration seen. */
const declared = new Map();
/** names revoked from anon anywhere. */
const revokedFromAnon = new Set();
/**
 * name -> file of the LAST `revoke ... from authenticated`, and of the LAST
 * `grant ... to authenticated`, for CLIENT_UNREACHABLE below.
 *
 * BY FILENAME, NOT A FLAT SET. A set can only answer "was this ever revoked", and a later
 * migration granting the permission back would leave the earlier revoke in it — so the
 * lint would pass while the endpoint was open. That failure mode is theoretical for the
 * `anon` rule (granting to anon is rare and conspicuous) and entirely ordinary for this
 * one. Filenames sort in apply order, so the last one wins, same as `dropped`.
 */
const revokedFromAuthenticated = new Map();
const grantedToAuthenticated = new Map();
/** name -> file of the LAST drop. Compared against the last declaration by
 *  filename, which sorts in apply order, so a function dropped after its final
 *  CREATE is gone and a function re-created after a drop is not. */
const dropped = new Map();
/** `REVOKE ... FROM public` sightings, for the "this is not a guard" hint. */
const revokedFromPublicOnly = new Map();
/** migrations containing a blanket grant to authenticated over all of `public`. */
const blanketGrants = [];

for (const f of files) {
  const raw = readFileSync(join(MIGRATIONS, f), 'utf8');
  const sql = stripComments(stripDollarBodies(raw));

  // CREATE [OR REPLACE] FUNCTION [public.]name( ... ) ... up to the body marker.
  const createRe =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?)([a-z0-9_]+)\1\s*\(/gi;
  let m;
  while ((m = createRe.exec(sql)) !== null) {
    const name = m[2].toLowerCase();
    // Look ahead to the body placeholder for the modifiers of THIS statement.
    const tail = sql.slice(m.index, sql.indexOf('BODY', m.index) + 4);
    const definer = /security\s+definer/i.test(tail);
    // A later CREATE OR REPLACE can flip a function to definer; keep the latest.
    declared.set(name, { file: f, definer });
  }

  for (const r of sql.matchAll(
    /revoke\s+(?:execute|all)[\s\S]{0,80}?on\s+function\s+(?:public\.)?("?)([a-z0-9_]+)\1\s*\([^)]*\)\s*from\s+([a-z_, ]+)/gi,
  )) {
    const name = r[2].toLowerCase();
    const roles = r[3].toLowerCase();
    if (/\bauthenticated\b/.test(roles)) { revokedFromAuthenticated.set(name, f); }
    if (/\banon\b/.test(roles)) { revokedFromAnon.add(name); }
    else if (/\bpublic\b/.test(roles)) { revokedFromPublicOnly.set(name, f); }
  }

  // GRANT [EXECUTE|ALL] ON FUNCTION public.name(...) TO roles
  for (const g of sql.matchAll(
    /grant\s+(?:execute|all)[\s\S]{0,80}?on\s+function\s+(?:public\.)?("?)([a-z0-9_]+)\1\s*\([^)]*\)\s*to\s+([a-z_, ]+)/gi,
  )) {
    if (/\bauthenticated\b/.test(g[3].toLowerCase())) {
      grantedToAuthenticated.set(g[2].toLowerCase(), f);
    }
  }

  // A blanket `grant execute on all functions in schema public to authenticated` inside a
  // MIGRATION would defeat every CLIENT_UNREACHABLE entry at once and match no per-function
  // pattern. CI issues one, but from the workflow, not from a migration — so seeing one
  // here means the schema itself re-opens them.
  if (/grant\s+(?:execute|all)[\s\S]{0,60}?on\s+all\s+functions\s+in\s+schema\s+public[\s\S]{0,40}?to\s+[a-z_, ]*\bauthenticated\b/i.test(sql)) {
    blanketGrants.push(f);
  }

  for (const d of sql.matchAll(
    /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?("?)([a-z0-9_]+)\1/gi,
  )) {
    dropped.set(d[2].toLowerCase(), f);
  }
}

/**
 * Functions NO CLIENT may execute — not anon, not authenticated.
 *
 * Almost every function here is meant to be callable by a signed-in user, which is why the
 * rule above is about `anon` alone. A handful are pure internals: called only from inside
 * other functions, with the definer's rights, so no caller needs a grant and exposing one
 * only publishes another PostgREST endpoint.
 *
 * WHY THIS NEEDS A TEXT LINT TOO, and cannot be a runtime assertion — the same fidelity
 * problem as the anon rule, in the opposite direction. Supabase's default privilege grants
 * EXECUTE to `authenticated` on every new function in `public`, so DECLINING TO GRANT
 * achieves nothing; only an explicit revoke does. CI's Postgres carries no such default, so
 * a migration that drops its revoke looks identical to one that keeps it — and worse, CI
 * then issues its own blanket `grant execute on all functions ... to authenticated` after
 * migrations, which re-opens it. A live `has_function_privilege` check therefore cannot
 * fail in the direction that matters. The mistake is only visible in the text.
 */
const CLIENT_UNREACHABLE = new Map([
  ['badge_grant_occupies_slot',
   'pure predicate over its 4 arguments; called only inside grant_badge and badge_status, both SECURITY DEFINER'],
  ['notify_badge_granted',
   'writes an activity notification as Livil; a caller could post themselves a notice claiming any badge'],
]);

const unreachableViolations = [];
for (const [name, why] of CLIENT_UNREACHABLE) {
  if (!declared.has(name)) { continue; }          // not created yet, or removed
  if ((dropped.get(name) ?? '') > declared.get(name).file) { continue; }
  const revokedIn = revokedFromAuthenticated.get(name) ?? '';
  const grantedIn = grantedToAuthenticated.get(name) ?? '';
  if (revokedIn && revokedIn > grantedIn) { continue; }
  unreachableViolations.push({ name, why, revokedIn, grantedIn });
}

if (blanketGrants.length) {
  console.error(
    '\nFAIL  a migration grants EXECUTE on ALL functions in schema public to authenticated\n',
  );
  for (const f of blanketGrants) { console.error(`  ✗ ${f}`); }
  console.error(
    '\n  That re-opens every CLIENT_UNREACHABLE function at once and matches no\n' +
    '  per-function revoke, so the rule below cannot see it. Grant per function.\n',
  );
  process.exit(1);
}

if (unreachableViolations.length) {
  console.error('\nFAIL  functions that no client may execute are reachable by authenticated\n');
  for (const v of unreachableViolations) {
    console.error(`  ✗ public.${v.name}   — ${v.why}`);
    if (v.grantedIn && v.grantedIn > v.revokedIn) {
      console.error(
        `      ${v.grantedIn} GRANTS it back` +
        (v.revokedIn ? ` after ${v.revokedIn} revoked it.` : ' and nothing revokes it.'),
      );
    }
    console.error(
      `      Add:  revoke execute on function public.${v.name}(...) from authenticated;\n` +
      '      Not granting is NOT enough: Supabase grants EXECUTE to `authenticated` by\n' +
      '      default on every new function in public, so the absence of a grant leaves\n' +
      '      the default in place. Only an explicit revoke closes it.\n',
    );
  }
  process.exit(1);
}

const violations = [];
for (const [name, { file, definer }] of declared) {
  if (!definer) { continue; }
  // Dropped after its last declaration — the function no longer exists.
  if ((dropped.get(name) ?? '') > file) { continue; }
  if (revokedFromAnon.has(name)) { continue; }
  if (BASELINE.has(name)) { continue; }
  violations.push({ name, file, publicOnly: revokedFromPublicOnly.get(name) });
}

if (violations.length) {
  console.error('\nFAIL  SECURITY DEFINER functions reachable by anon\n');
  for (const v of violations) {
    console.error(`  ✗ public.${v.name}   (${v.file})`);
    if (v.publicOnly) {
      console.error(
        '      This migration writes `REVOKE ... FROM public`, which is NOT this.\n' +
        '      Supabase grants EXECUTE to the `anon` ROLE directly, and revoking\n' +
        '      the PUBLIC pseudo-role leaves that grant in place.',
      );
    }
    console.error(
      `      Add:  revoke execute on function public.${v.name}(...) from anon;\n` +
      '      Or, if anon must reach it, add it to BASELINE in\n' +
      `      scripts/${basename(fileURLToPath(import.meta.url))} with a reason.\n`,
    );
  }
  console.error(
    `  ${violations.length} function(s). A SECURITY DEFINER function runs with the\n` +
    "  owner's rights, so an anon grant is an unauthenticated caller inside them.\n",
  );
  process.exit(1);
}

const definerCount = [...declared.values()].filter(d => d.definer).length;
console.log(
  `PASS  ${definerCount} SECURITY DEFINER function(s); ` +
  `${revokedFromAnon.size} revoked from anon, ${BASELINE.size} baselined; ` +
  `${CLIENT_UNREACHABLE.size} client-unreachable function(s) still revoked from authenticated`,
);
