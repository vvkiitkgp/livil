---
tier: 2
owner: chief-architect
consumers: [QA, ALL, CR]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Testing Strategy

What we test, what we deliberately do not, and why.

---

## ⚠️ Current state: effectively zero

| | |
|---|---|
| Test files | **1** |
| Assertions | **0** — it renders the app and asserts nothing |
| Source files under `src/` | ~122 |
| **`npm test`** | **fails** — a module transform error, unrelated to any product code |
| Coverage reporting | not configured |
| CI | none |

The single test is the untouched React Native template. **It has never protected anything, and
it does not currently run.**

This document therefore describes a strategy that is mostly *not yet implemented*. It is
written now so the first tests are aimed at the right targets rather than at whatever is
easiest to test.

---

## Why we test

**Tests exist to make future change safe, not to prove correctness** (Constitution P29).

The consequence: a test that would not fail if the behaviour broke is not coverage, it is
decoration. **A small number of tests that genuinely constrain behaviour beats a large number
that assert nothing** — and the current suite is the degenerate case of the latter.

The second consequence: **coverage follows blast radius, not line count** (P30). 60% concentrated
on things that break silently is worth far more than 90% spread evenly across screens.

---

## Priority order

Ranked by *how badly it fails and how hard the failure is to notice* — not by ease.

### 1. The JavaScript ↔ native prop seam — **highest value**

New native props must be mirrored in three separate type locations. **A missed mirror silently
drops the prop**: no error, no warning, the feature simply does nothing, and only on a real
device in a release build.

Our own architecture documentation calls this seam "easy to silently break." That sentence is
currently doing a regression test's job.

**Test shape:** a contract test asserting the three declarations agree, and that every prop the
JS side sends appears in the native spec.

### 2. Playback coordinate translation

Absolute time in the app, clip-relative at the OS boundary. Errors here produce a lock screen
that disagrees with the app — visible to users, hard to reproduce, and easy to introduce.

**Test shape:** pure functions over the translation. `absolute → clip-relative → absolute` round
trips, boundaries, no-clip pass-through, seeks at the clip edges.

### 3. Authorization

**No test asserts that a non-owner is denied anything.** Row-level security is the entire
perimeter, and nothing verifies it.

**Test shape:** SQL tests per table — as user A, attempt to read/update/delete user B's row,
assert denial. Plus one per `SECURITY DEFINER` function: call it as a non-member, assert
rejection. Those tests would fail today on three known functions, which is exactly what they
are for.

### 4. Services

Query construction, row mapping, error mode. Run against a scratch database rather than mocks —
mocking the client tests the mock.

### 5. Pure utilities

Waveform bucketing, now-playing metadata, chat time grouping, mention parsing. Cheap, fast,
genuinely useful, and the obvious place to start building the habit.

### 6. Components

Only where logic lives in them. **Snapshot tests of large screens are explicitly not wanted** —
they fail on every intentional change, get regenerated without reading, and constrain nothing.

---

## What we deliberately do not test

Saying this explicitly so the gaps are chosen rather than accidental:

| Not tested | Why | How it is covered instead |
|---|---|---|
| Native patch internals | Kotlin/Swift under `node_modules`; no harness | Manual device check before release |
| Lock-screen and background behaviour | Needs a real device, backgrounded | Manual release checklist |
| Media decode | Depends on hardware decoders | Fail-safe by design |
| Third-party SDKs | Not our code | — |
| Visual appearance | No visual regression tooling | Review |

**The riskiest parts of this product are in the untested column.** That is a real limitation,
not a solved problem — and it is why the release checklist in
[../operations/deployment.md](../operations/deployment.md) exists and why step 6 there matters.

---

## Conventions

- **A bug fix begins with a failing test** (P31). It proves the cause was understood rather than
  the symptom, and ensures the bug can only be found once.
- **Name the behaviour, not the function** — `denies delete when not the owner`, not
  `deletePost works`.
- **No logic in tests.** A test with branching is a second implementation to debug.
- **Deterministic.** No wall-clock time, no random values, no network. Inject them.
- **Fast.** The full suite should stay under a few minutes or it stops being run.

---

## Coverage targets

Thresholds are meaningless until there is something to measure. Targets for when the suite
exists:

| Area | Target | Reasoning |
|---|---:|---|
| `src/utils/` | 85% | Pure, cheap, no excuse |
| `src/services/` | 85% | Every data path |
| Playback coordinates | 95% | Silent failures |
| Prop-seam contract | 100% | It is one assertion set |
| Authorization (per table) | every table | Denial is the assertion |
| Components / screens | none set | Coverage here is a poor proxy for value |

**Ratchet upward, never downward.** A threshold that gets lowered to make a build pass has
stopped being a threshold.

---

## Green is a claim (P32)

A passing suite means only as much as the suite can detect. Be explicit about what is *not*
covered rather than letting green imply a guarantee it cannot make.

**This applies to the tooling too.** The knowledge base generators flag privileged functions
missing authorization checks, and their own output says plainly that a clean report is not
proof of safety. Same principle.

---

## Enforcement status

| Mechanism | State |
|---|---|
| `npm test` | **failing** — must be fixed before anything else here matters |
| Coverage thresholds | not configured |
| Authorization tests | do not exist |
| Contract tests | do not exist |
| CI | does not exist |

**First three actions:** fix the test harness, delete the assertion-free template test, write
the prop-seam contract test.

## Related

- [../operations/deployment.md](../operations/deployment.md) — the manual checklist standing in for tests
- [../architecture/playback.md](../architecture/playback.md) — what needs the most coverage
- [../security/model.md](../security/model.md) — why authorization tests matter
