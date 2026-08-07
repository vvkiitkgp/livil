# tracker

The only supported way anything in this repository touches the issue tracker.

`kb/standards/work-tracking.md` has said *"agents never call the tracker API directly"* since it
was written. Until 2026-08-07 there was nothing to call instead — `types.mjs` held the shapes
and the constants, and no client existed. A standard describing a module that does not exist is
not a standard; it is a hope, and it was being followed by nobody, including the agents reading
the document that said so. This is that module.

## Why it exists

**Concentrate the dependency.** Everything Jira-shaped — endpoints, ADF, issue-type names,
transition lookup, auth — lives in `jira.mjs` and nowhere else. Swapping to Linear or GitHub
Issues is a second file with the same seven methods and one changed line in `index.mjs`.
(Constitution P13: every dependency is a future obligation; know the exit path.)

**Concentrate the permission boundary.** The rules in the standard's *What agents may and may
not do* table are enforced in `index.mjs`, above the implementation, so a second tracker cannot
forget to reimplement them.

## Files

| File | |
|---|---|
| `types.mjs` | Shapes, `READY_LABEL`, `NEEDS_RATIFICATION`, the six readiness checks, `expectedOutcome()` |
| `adf.mjs` | Plain text → Atlassian Document Format. A line classifier, not a parser |
| `jira.mjs` | The Jira Cloud implementation. The only Jira-aware file |
| `index.mjs` | The port: the factory, the permission boundary, `checkReadiness()` |
| `cli.mjs` | Command-line entry point |
| `tracker.test.mjs` | 30 tests, no network, `fetch` injected |

## Use

```bash
export JIRA_EMAIL=you@example.com
export JIRA_API_TOKEN=...        # id.atlassian.com/manage-profile/security/api-tokens
```

Never commit these. `JIRA_SITE` and `JIRA_PROJECT` default to `vvkiitkgp.atlassian.net` and `LIV`.

```bash
node scripts/tracker/cli.mjs create --type Task --summary "..." --body-file ./body.md
node scripts/tracker/cli.mjs comment LIV-93 --body-file ./comment.md
node scripts/tracker/cli.mjs ready LIV-93          # score against the definition of ready
node scripts/tracker/cli.mjs start LIV-93          # → In Progress
node scripts/tracker/cli.mjs handoff LIV-93 --lane "Apply to Prod"
```

Or from a script:

```js
import { createTracker } from './scripts/tracker/index.mjs';
const tracker = createTracker();
await tracker.create({ type: 'Task', summary: '...', body: '...' });
```

**`--body-file`, not `--body`, for anything long.** A ticket body passed as a shell argument gets
mangled by quoting, and the failure is silent: the ticket is filed, just wrong. Every command
takes `--dry-run`, which prints exactly what would be sent and calls nothing — it works without
credentials, so a body can be checked before it is public.

## What it will not do

No `close`, no `done`, no `delete`, and `ai-ready` is refused wherever labels are accepted.
Those are not guarded commands; they are absent. `moveTo` accepts only `In Progress`,
`ToDo Deploy` and `Apply to Prod`, and `updateOwn` reads the reporter first and refuses to edit
a ticket this credential did not file.

A refusal exits **3**, a bad invocation **2**, a real error **1** — so a caller can tell the
adapter working from the adapter breaking.

## What it is honest about

The standard's enforcement table says the transition limits are *"not enforced — the integration
grants write access; this is currently a rule, not a control"*. **That is still true.** A
credential that can write can write anything, and anybody who bypasses this module has full
access to the API.

What changed is that every *accidental* path to a forbidden action is gone. "An agent must
remember not to" became "an agent would have to deliberately go around the adapter to". That is
a real improvement and it is not the same thing as a control. The scoped credential named in the
standard is still the fix, and this module is where it will be read from when it exists.

## Formatting

`adf.mjs` classifies lines: `## ` … `###### ` become headings, `- ` and `* ` become flat bullet
lists, blank lines break paragraphs, everything else is prose. There is no inline formatting —
`**bold**` stays literal — and no tables, nesting, or numbered lists.

That ceiling is deliberate. Every line falls into exactly one case decided by its first
characters, with no lookahead and no backtracking, so there is no input it can be wrong about.
A Markdown parser would be a heuristic reading human text, and this repository has been bitten
by that before (the `--`-inside-a-string-literal hazard in LIV-94, the lyrics-format note in
CLAUDE.md). Pass a ready-made ADF document to any function if you need more; the escape hatch is
what lets the classifier stay this small.

## Tests

```bash
npm run test:tracker
```

No network and no credential — `fetch` is injected. That is not only for speed: the paths worth
pinning are the refusals, and a test against live Jira could only prove them by attempting the
very actions the adapter exists to prevent.
