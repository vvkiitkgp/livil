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
/** name -> file of the LAST drop. Compared against the last declaration by
 *  filename, which sorts in apply order, so a function dropped after its final
 *  CREATE is gone and a function re-created after a drop is not. */
const dropped = new Map();
/** `REVOKE ... FROM public` sightings, for the "this is not a guard" hint. */
const revokedFromPublicOnly = new Map();

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
    if (/\banon\b/.test(roles)) { revokedFromAnon.add(name); }
    else if (/\bpublic\b/.test(roles)) { revokedFromPublicOnly.set(name, f); }
  }

  for (const d of sql.matchAll(
    /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?("?)([a-z0-9_]+)\1/gi,
  )) {
    dropped.set(d[2].toLowerCase(), f);
  }
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
  `${revokedFromAnon.size} revoked from anon, ${BASELINE.size} baselined`,
);
