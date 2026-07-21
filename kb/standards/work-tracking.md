---
tier: 2
owner: chief-architect
consumers: [TR, CA, ALL]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Work Tracking

How work is represented, from an architecture proposal through to a merged change.

**Tracker: Jira.** Site `vvkiitkgp.atlassian.net`, project **`LIV`** ("Livil"), team-managed,
Kanban.

---

## Tracker access is behind an adapter

**Agents never call the tracker API directly.** All access goes through an adapter module, so
the tracker is a swappable dependency rather than a hard-coded assumption. Swapping trackers
should touch one module and nothing else.

This matters more than it looks: tracker APIs are the kind of dependency that leaks into
dozens of call sites if unmanaged, and then cannot be changed.

---

## Issue types

`LIV` provides a three-level hierarchy. **We use four of the seven available types.**

| Level | Type | Represents | Created by |
|---|---|---|---|
| **1** | **Epic** | A ratified architecture proposal, or a substantial feature | Human, or the board on ratification |
| **0** | **Story** | A user-visible increment | Board decomposition, or human |
| **0** | **Task** | Engineering work with no direct user-visible outcome | Board, human, or triage |
| **0** | **Bug** | A defect, ideally traced to an incident | Anyone |
| **−1** | **Subtask** | A step within a Story or Task | Whoever is implementing |

**`Feature` and `Request` are deliberately unused.** Two clear types beat six fuzzy ones — if
`Feature` and `Story` both exist, every ticket becomes a categorisation debate rather than a
description of work.

---

## From proposal to merge

```
board debate  →  ADR (kb/decisions/)          the decision and its dissent
                        │
                        ▼
              proposal (kb/debt/proposals/)   spec + implementation plan
                        │
                 ── HUMAN RATIFICATION ──     ◀── you approve, reject, or defer
                        │
                        ▼
                   Epic in LIV                links back to the ADR
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
           Story               Task            one per plan step
              │
              ▼
          branch  →  PR  →  review  →  merge  →  ticket closed
```

**The knowledge base holds the reasoning; Jira holds the state.** An ADR records *why* and does
not change; a ticket records *where the work is* and changes constantly. Keeping them separate
is why neither has to be edited to keep the other true.

Do not paste ADR content into tickets. Link.

---

## Definition of ready

A ticket an agent may pick up must have:

1. **A concrete outcome** — what is true when this is done, in observable terms
2. **Scope boundaries** — explicitly what is *not* included
3. **The affected domain**, so it routes to the right reviewer
4. **Acceptance criteria** that can be checked, not judged
5. **A link** to the ADR, proposal, or incident that motivated it

**A ticket that fails this is sent back with specific questions, not guessed at.** Guessing on
an underspecified request where guessing wrong is expensive is a refusal condition
(Constitution, Part XVI).

## Definition of done

1. The stated outcome is achieved and **verified by running something**, not by reasoning (P8)
2. Tests exist for new logic; a bug fix has a test that failed before the fix (P31)
3. `npx tsc --noEmit`, `npm run lint`, `npm test` all pass
4. Documentation updated **in the same change** if behaviour or an invariant changed
5. Reviewed by the relevant domain owner
6. Merged, and the ticket closed by the merge

---

## Conventions

**Branches — and the prefix is load-bearing, not cosmetic:**

| Author | Prefix | Example |
|---|---|---|
| Human | `<type>/LIV-<n>-<slug>` | `fix/LIV-42-jam-membership-guard` |
| **Agent** | **`agent/LIV-<n>-<slug>`** | `agent/LIV-42-jam-membership-guard` |

`scripts/enforce-agent-scope.mjs` keys on the `agent/` prefix. An earlier version of this
document specified `<type>/` for all work, which meant an agent following the documented
convention **bypassed the scope gate entirely** — found by the triage agent on its first
run. Agent commits must also carry an `Agent-Implemented:` trailer, which is the
secondary marker.

Types for human branches: `feat` · `fix` · `docs` · `refactor` · `chore`.

**PR titles:** `<type>(<scope>): <summary> (LIV-<n>)`. The ticket key in the title is what links
the two systems.

**Labels:** `ai-ready` (an agent may pick this up) · `needs-debate` (requires the architecture
board) · `security` (routes to security review) · `blocked-on-human`.

**`ai-ready` is applied by a human**, not by an agent on its own ticket. It is the gate, and a
gate that can be self-opened is not a gate.

---

## What agents may and may not do

Ticket state is how you know what is happening in your own project. An agent that can silently
close things degrades your visibility into it.

| Action | Permitted |
|---|---|
| Create a ticket | ✅ |
| Comment, attach findings, link a PR | ✅ |
| Update a ticket it created, before work starts | ✅ |
| Move a ticket it is working on to In Progress | ✅ |
| **Transition to Done or Closed** | ❌ **human only** |
| **Edit a ticket it did not create** | ❌ |
| **Delete anything** | ❌ — and the integration exposes no delete |
| **Apply `ai-ready`** | ❌ **human only** |
| Change project or workflow configuration | ❌ |

This is the same tiering as code: agents propose, humans approve the irreversible step.

---

## Intake pipeline

```
board proposal ──▶ ADR + proposal in kb/  ──▶  HUMAN RATIFIES  ──▶  Epic in LIV
                                                                        │
                                                              triage-agent
                                                                        │
                                     ┌──────────────────────────────────┤
                                     ▼                                  ▼
                          path is WRITABLE                    path is PROPOSE-ONLY
                        implementation agent                  agent writes a proposal
                          branch agent/LIV-N                     human implements
                                     │
                                 PR ──▶ CI (6 jobs) ──▶ domain principal reviews
                                                     ──▶ HUMAN MERGES
```

**Triage answers "implement or propose?" up front**, by checking the ticket's implied
paths against `.claude/autonomy-config.yml`. Overall coverage is ~1%, so most of `src/`
is propose-only and **many tickets will correctly end in a proposal**.

Saying that during triage rather than at push time is the point. An agent that discovers
at the end that it may not write the file has wasted the work.

**Branch naming for agent work: `agent/LIV-N-slug`.** The `agent/` prefix is what
`enforce-agent-scope.mjs` keys on — it is not cosmetic.

## Enforcement status

| Rule | Enforcement |
|---|---|
| Branch and PR naming | `ADVISORY` — a CI check is cheap and planned |
| Definition of ready | `ADVISORY` — triage agent will check it (Phase 7) |
| Definition of done | `ADVISORY` — depends on CI existing |
| Agent transition limits | **Not enforced** — the integration grants write access; this is currently a rule, not a control |

**The last row is the honest gap.** The credential in use can create and modify tickets, so the
restriction on closing them is convention rather than a permission boundary. Tightening it
means a scoped credential, and that is worth doing before autonomous operation.

## Related

- [../ai-org/board-charter.md](../ai-org/board-charter.md) *(planned)*
- [../decisions/](../decisions/) *(planned)* · [../debt/register.md](../debt/register.md) *(planned)*
