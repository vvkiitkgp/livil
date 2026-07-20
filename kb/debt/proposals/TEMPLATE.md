---
tier: 4
owner: chief-architect
consumers: [CA, TR, ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# PROP-NNNN — <what this proposes to do>

| | |
|---|---|
| **Status** | **Draft** · Ratified · Rejected · Deferred · Implemented |
| **Date** | YYYY-MM-DD |
| **Domain** | one of the six principal domains |
| **Addresses** | D-NN, INC-NNNN, ADR-NNNN |
| **Jira** | LIV-NN *(added on ratification)* |

---

## Problem

What is wrong, in observable terms. Reference the debt item, incident, or ADR it comes from.

**Not** "the code is messy" — what breaks, for whom, and under what conditions.

## Why now

Why this, ahead of the other things on the register. If the answer is "it is cheap and
valuable," say so plainly; if it is "it blocks something else," name that.

## Proposal

What to do. Specific enough that someone else could implement it.

## Implementation plan

Steps that become Jira Stories or Tasks on ratification. Each should be independently
verifiable.

1.
2.
3.

## Scope boundaries

**Explicitly what this does not include.** The most common failure of a proposal is silent
scope growth during implementation (Constitution: propose a larger change, do not perform it).

## Risk

What could go wrong, and what makes it reversible. If it touches playback, the schema, or the
native patch, say what a bad outcome looks like and how it would be detected.

## Verification

How we will know it worked — a test, a measurement, a behaviour to exercise. **Not "the code
compiles."** A proposal with no verification plan is not ready (P8).

## Alternatives

Options considered and set aside, with reasons.

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
>
> **WIP cap: 8 unratified proposals.** The board blocks on its own backlog rather than
> generating indefinitely.
