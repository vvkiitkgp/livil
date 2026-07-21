---
tier: 3
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Autonomy Policy

What agents are permitted to do without a human, and why the ceiling is where it is.

**Current ceiling: Tier 2. Tier 3 is deliberately not implemented.**

---

## The ladder

| Tier | Requirement | Agent may |
|---|---|---|
| **0 — Advisory** | default | comment only |
| **1 — Propose** | — | open PRs; a human implements and merges |
| **2 — Write** | the path has tests that fail when behaviour breaks | write code; **a human merges** |
| ~~3 — Autonomous~~ | ≥85% coverage · 20 clean PRs · 60 incident-free days | *(not implemented)* |

Tier is assigned **per path, not per agent**, in [`.claude/autonomy-config.yml`](../../.claude/autonomy-config.yml).
A backend engineer is Tier 2 in `supabase/migrations/` and Tier 1 in `src/services/`
simultaneously, because the safety net differs between them.

---

## Why Tier 3 is not built

Not caution for its own sake. The evidence from this organization's first days:

| Found by | What it was |
|---|---|
| debt-cartographer | An inert CI check that could never pass and swallowed its own failure |
| security-reviewer | A security fix reported as CLOSED that guarded the RPC and left the table open |
| code-reviewer | Four tests, well-named and passing, that asserted nothing |
| triage-agent | A scope gate that did not fire on its own documented branch convention |
| triage-agent | A never-list that would have blocked the next release build |

**Every one was caught because a human was in the loop.** An organization that finds
that many real defects in a few days — several in its own enforcement — has not earned
the right to ship unsupervised.

The quantitative bar is also nowhere close: Tier 3 wants ≥85% coverage against **~1%
actual**, and 60 incident-free days against an organization two days old.

**Tier 3 is not disabled pending a date. It is unbuilt pending evidence.** Building it
now would mean writing the mechanism before the case for it exists, which is the shape
of every problem listed above.

---

## What Tier 2 means in practice

An agent may write to a path only where a test would fail if the behaviour broke.
Everywhere else it proposes and a human implements. Enforced by
`scripts/enforce-agent-scope.mjs` in CI — **not by the agent definitions**, because a
prompt cannot fail a build and an agent can be argued out of an instruction.

A human always merges. There is no auto-merge, on any path, for any agent.

### How a path graduates to Tier 2

1. Tests exist that fail when the behaviour breaks — **demonstrated by mutation, not
   asserted**
2. Those tests run in CI
3. The path is added to `writable` with its evidence recorded

This creates the incentive the project needs: **an area earns agent help by getting
tested.** Do not graduate a path because an agent found it inconvenient — the friction
is the mechanism working.

---

## The kill switch

`.claude/AUTONOMY_ENABLED`. First line `enabled` or anything else.

Set it to `disabled` and every agent-authored change is blocked at CI, regardless of
scope or tier. One edit, one commit, works from a phone.

**It stops agent changes landing. It does not revert what has merged, and it does not
stop a running session** — close the session for that. Procedure:
[disable-autonomy.md](../operations/runbooks/disable-autonomy.md).

Flipping it is a **pause, not an escalation**. "An agent did something unexpected and I
want to think" is sufficient reason. Re-enabling costs one commit.

---

## Known limitations, stated rather than implied away

**Agent detection is a convention, not a proof.** The gate keys on an `agent/` branch
prefix or an `Agent-Implemented:` trailer. An agent using neither is undetected. What
makes this acceptable at Tier 2 is that a human merges everything; what would make it
airtight is a per-agent credential — the right first step if Tier 3 is ever considered.

**Coverage is ~1%.** Most of the codebase is Tier 1 as a result, and that is the honest
position rather than a temporary inconvenience.

**No crash reporting exists.** Automatic rollback on a crash-rate spike is specified in
the roadmap and **cannot be built** — there is nothing to measure. That is D-05, and it
is a prerequisite for any autonomy beyond Tier 2, because unsupervised shipping without
production visibility is shipping blind.

---

## Review

This policy is reviewed when any of the following becomes true, not on a calendar:

- Coverage on a candidate path reaches the bar and someone proposes graduating it
- Crash reporting exists, making production failure observable
- The organization runs for a sustained period without an agent-introduced defect
- A per-agent credential replaces the convention-based gate

## Related

- [`.claude/autonomy-config.yml`](../../.claude/autonomy-config.yml) — the per-path tiers
- [board-charter.md](board-charter.md) — the board is Tier 0 by construction
- [review-log.md](review-log.md) — whether the reviewers earn their trust
- [../standards/work-tracking.md](../standards/work-tracking.md) — the intake pipeline
