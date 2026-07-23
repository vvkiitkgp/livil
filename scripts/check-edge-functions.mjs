#!/usr/bin/env node
/**
 * CI smoke check (LIV-29): assert the required Supabase edge functions EXIST in production.
 *
 * WHY THIS EXISTS
 * ---------------
 * LIV-9 / D-54 was a P0 outage: EVERY out-of-app push notification in Livil was dead for
 * months and nothing reported it. `src/services/pushDispatch.ts` calls
 * `supabase.functions.invoke('send-push', …)`, but that edge function did not exist in the
 * live Mumbai project. The failure was triple-silent — `functions.invoke` returns
 * `{data:null, error}` instead of throwing, the error was discarded, and callers used
 * `void sendPush(…)`. No throw, no log, no signal. The KB described the function's behaviour
 * confidently enough that no reader questioned it while it never existed.
 *
 * This guardrail closes that class of failure: if a function the client depends on is not
 * deployed to prod, CI goes red instead of production going silently dark.
 *
 * WHAT IT DOES
 * ------------
 * Lists the deployed edge functions for the production project via the Supabase Management
 * API and asserts every function in REQUIRED_FUNCTIONS is present (matched by slug, falling
 * back to name). Exits non-zero with a clear message if any is missing.
 *
 * SECRET
 * ------
 * Needs a Supabase personal access token in env `SUPABASE_ACCESS_TOKEN` (GitHub Actions
 * secret of the same name). If the secret is ABSENT, the check does NOT fail the build — the
 * founder has not wired it yet, and failing red for a missing secret is unrelated to what the
 * check guards (it would become noise and get disabled). Instead it emits a LOUD warning
 * (GitHub `::warning::` annotation + job summary) and exits 0, so the guardrail's dormant
 * state is visible rather than silent. Once the secret exists, a missing function is a hard
 * failure.
 *
 * Usage:
 *   node scripts/check-edge-functions.mjs             # real check (needs SUPABASE_ACCESS_TOKEN)
 *   node scripts/check-edge-functions.mjs --self-test # exercise the parsing/assertion logic
 */

import { appendFileSync } from 'node:fs';

// ── Config ──────────────────────────────────────────────────────────────────
// Production project ref (Mumbai / ap-south-1). The parked Sydney project is not checked;
// prod is the only place these functions must exist.
const PROJECT_REF = 'fqzrmqnlgjeuxzinbqvs';

// The edge functions the client hard-depends on. Add a slug here when the app starts
// invoking a new function, so its absence in prod fails CI instead of failing users.
//   send-push — push fan-out, invoked by src/services/pushDispatch.ts (LIV-9 / D-54).
const REQUIRED_FUNCTIONS = ['send-push'];

const MANAGEMENT_API = 'https://api.supabase.com';

// ── Pure logic (unit-tested via --self-test) ────────────────────────────────

/**
 * Extract the set of deployed function identifiers from a Management API response.
 * The API returns an array of objects; each has a `slug` (and a human `name`). We accept
 * either so a rename of the display name never spuriously trips the check.
 * @param {unknown} apiResponse parsed JSON from GET /v1/projects/{ref}/functions
 * @returns {Set<string>}
 */
export function deployedSlugs(apiResponse) {
  if (!Array.isArray(apiResponse)) {
    throw new Error(
      `Management API returned ${typeof apiResponse}, expected an array of functions`,
    );
  }
  const slugs = new Set();
  for (const fn of apiResponse) {
    if (fn && typeof fn === 'object') {
      if (typeof fn.slug === 'string') slugs.add(fn.slug);
      if (typeof fn.name === 'string') slugs.add(fn.name);
    }
  }
  return slugs;
}

/**
 * Which required functions are NOT present among the deployed ones.
 * @param {unknown} apiResponse parsed JSON from the Management API
 * @param {string[]} required
 * @returns {string[]} missing function slugs (empty === all present)
 */
export function missingFunctions(apiResponse, required) {
  const have = deployedSlugs(apiResponse);
  return required.filter((slug) => !have.has(slug));
}

// ── Side-effecting helpers ──────────────────────────────────────────────────

function annotateWarning(message) {
  // Surfaces in the PR "Checks" UI and the run's annotations list.
  console.log(`::warning title=edge-function-parity::${message}`);
}

function stepSummary(markdown) {
  // Best-effort: only present inside GitHub Actions.
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, markdown + '\n');
  } catch {
    /* summary is best-effort; never let it break the check */
  }
}

async function fetchDeployedFunctions(token) {
  const url = `${MANAGEMENT_API}/v1/projects/${PROJECT_REF}/functions`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Management API GET /v1/projects/${PROJECT_REF}/functions returned ${res.status} ${res.statusText}. ` +
        `Check that SUPABASE_ACCESS_TOKEN is valid and scoped to this project.\n${body.slice(0, 500)}`,
    );
  }
  return res.json();
}

// ── Self-test (proves the check catches a missing function) ─────────────────

function selfTest() {
  let failures = 0;
  const check = (name, cond) => {
    if (cond) {
      console.log(`  ok    ${name}`);
    } else {
      console.error(`  FAIL  ${name}`);
      failures++;
    }
  };

  // Shape mirrors the real Management API payload.
  const present = [
    { id: 'a', slug: 'send-push', name: 'send-push', status: 'ACTIVE', version: 3 },
    { id: 'b', slug: 'some-other-fn', name: 'some-other-fn', status: 'ACTIVE', version: 1 },
  ];
  const absent = [
    { id: 'b', slug: 'some-other-fn', name: 'some-other-fn', status: 'ACTIVE', version: 1 },
  ];
  const renamedNameOnly = [{ id: 'a', name: 'send-push', status: 'ACTIVE' }];

  // The guardrail must PASS when the function is deployed …
  check('present → nothing missing', missingFunctions(present, REQUIRED_FUNCTIONS).length === 0);

  // … and must FAIL (report the missing slug) when it is not — this is the outage shape.
  check(
    'absent → reports send-push missing',
    JSON.stringify(missingFunctions(absent, REQUIRED_FUNCTIONS)) === JSON.stringify(['send-push']),
  );

  // Empty project (exactly the D-54 state: list_edge_functions returned []).
  check('empty list → reports send-push missing', missingFunctions([], ['send-push']).length === 1);

  // Slug absent but name matches → still considered present.
  check(
    'name-only match counts as present',
    missingFunctions(renamedNameOnly, ['send-push']).length === 0,
  );

  // Malformed payloads must throw, not silently pass (a non-array is an API contract break).
  let threw = false;
  try {
    missingFunctions({ error: 'nope' }, ['send-push']);
  } catch {
    threw = true;
  }
  check('non-array payload throws', threw);

  if (failures) {
    console.error(`\nself-test: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nself-test: all assertions passed');
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    const msg =
      'SUPABASE_ACCESS_TOKEN is not set — edge-function-parity check is DORMANT. ' +
      'Add the repo Actions secret to activate it (see PR body / workflow file). ' +
      'Until then, an undeployed send-push would NOT be caught here.';
    annotateWarning(msg);
    stepSummary(
      '### edge-function-parity: SKIPPED (secret not configured)\n\n' +
        '`SUPABASE_ACCESS_TOKEN` is not set, so the check could not talk to the Supabase ' +
        'Management API. This guardrail is **inactive** until the founder adds that secret.\n\n' +
        `Required functions it *would* assert exist in \`${PROJECT_REF}\`: ` +
        REQUIRED_FUNCTIONS.map((f) => `\`${f}\``).join(', '),
    );
    console.log(`SKIP  ${msg}`);
    process.exit(0);
  }

  let functions;
  try {
    functions = await fetchDeployedFunctions(token);
  } catch (err) {
    // Token present but the API call failed (bad/expired token, wrong scope, network).
    // This is a real, actionable configuration problem — fail loudly rather than pass blind.
    console.error(`FAIL  could not verify edge functions in ${PROJECT_REF}:\n      ${err.message}`);
    stepSummary(`### edge-function-parity: ERROR\n\n\`\`\`\n${err.message}\n\`\`\``);
    process.exit(1);
  }

  const missing = missingFunctions(functions, REQUIRED_FUNCTIONS);
  const present = REQUIRED_FUNCTIONS.filter((f) => !missing.includes(f));

  if (missing.length > 0) {
    console.error(
      `\nFAIL  required edge function(s) NOT deployed to production (${PROJECT_REF}):\n` +
        missing.map((f) => `        x ${f}`).join('\n') +
        '\n\n' +
        '      This is the LIV-9 / D-54 failure mode: the client invokes a function that\n' +
        '      does not exist, and the call fails SILENTLY. Deploy it:\n' +
        `        supabase functions deploy ${missing[0]} --project-ref ${PROJECT_REF}\n`,
    );
    stepSummary(
      `### edge-function-parity: FAILED\n\nMissing in \`${PROJECT_REF}\`: ` +
        missing.map((f) => `\`${f}\``).join(', ') +
        '\n\nThis is the LIV-9 / D-54 outage shape — deploy the function.',
    );
    process.exit(1);
  }

  console.log(
    `PASS  all required edge functions deployed to ${PROJECT_REF}: ` + present.join(', '),
  );
  stepSummary(
    `### edge-function-parity: PASS\n\nAll required functions present in \`${PROJECT_REF}\`: ` +
      present.map((f) => `\`${f}\``).join(', '),
  );
}

main().catch((err) => {
  console.error(`FAIL  unexpected error:\n      ${err?.stack || err}`);
  process.exit(1);
});
