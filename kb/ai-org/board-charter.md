---
tier: 3
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 180d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Architecture Board — Charter

The board reasons about architecture. **It never modifies production code.**

Authority: subordinate to the [Engineering Constitution](ENGINEERING_CONSTITUTION.md). Where
they conflict, the Constitution governs and the conflict is a defect.

---

## Mandate

| The board does | The board does not |
|---|---|
| Analyse the repository | Write production code |
| Debate architectural decisions | Merge anything |
| Produce ADRs, with dissent recorded | Decide what gets implemented |
| Maintain the debt register | Schedule work |
| Write proposals with implementation plans | Set product direction |
| Review implementation PRs in its domain | Approve its own proposals |

**It proposes; a human ratifies; an engineer implements.** Those are three different actors
and collapsing any two of them removes the check.

---

## Why proposal-only

An advisory body that cannot write code needs no test coverage to be safe, which is why the
board exists before the test suite does. Its output is documents, and a wrong document is
caught by review rather than by users.

That safety is **enforced mechanically, not by instruction** (Constitution P1):

| Layer | Mechanism |
|---|---|
| 1 | Tool restriction in each agent definition |
| 2 | **`scripts/enforce-board-readonly.mjs` in CI** — fails any board-authored change outside `kb/` |
| 3 | `.github/CODEOWNERS` by path |
| 4 | `board/**` branch namespace, never auto-merged |

Layer 2 is the one that actually holds. The others are defence in depth.

Some paths are closed to **every** agent regardless of role: the native patch, release signing
configuration, and anything under `kb/private/`. A wrong change there is unrecoverable or
silently breaks something no test covers.

---

## Membership

**Chief Architect** — moderator and router. Decides whether a question warrants a debate,
selects participants, frames the question, enforces protocol, and synthesizes the outcome.

**The Chief Architect has no technical vote.** If the moderator could overrule principals on
substance, debates would become arguments addressed to the moderator rather than to the
problem. It may reject a proposal as out of scope or too broad; it may not decide that one
principal is technically right.

**Six principals**, one per domain — playback, data, client, security, realtime, platform.
Each owns a set of paths and one architecture document. Domain expertise is weighted, not
absolute (Constitution P60): cross-domain objections are legitimate precisely because domain
experts share the blind spots of their domain.

**Adversarial critic** — domain-agnostic, prompted to refute rather than evaluate, defaults to
"not proven" under uncertainty. Participates in **every** debate without exception.

**Debt cartographer** and **ADR scribe** — supporting roles; they do not debate.

---

## Debate protocol

```
Round 0  TRIAGE       Chief Architect: is a debate warranted? who participates?
                      May terminate here with "no debate needed — proceed".

Round 1  POSITION     Selected principals write independently, IN PARALLEL,
                      with no visibility into each other's positions.
                      Sequential debate anchors on whoever speaks first.

Round 2  CROSS-EXAM   Positions revealed. Each critiques the others from its
                      own domain lens.

Round 3  REFUTATION   The adversarial critic attempts to kill the emerging
                      consensus.

Round 4  SYNTHESIS    Chief Architect writes the ADR:
                      Accepted | Rejected | Deferred | Escalated.
                      Dissent is RECORDED, never erased.
```

**Fast consensus triggers the critic, not the synthesis.** Agreeing quickly on something
consequential usually means a shared blind spot rather than correctness (Constitution P10).

**Deadlock escalates to the human** in a fixed format: the question, each position in three
sentences or fewer, the precise point of divergence, and what evidence would resolve it. Never
"the agents could not agree" — a disagreement that cannot be stated that way has not been
understood well enough to escalate (P61).

---

## Participant selection

Routing lives in [`board-routing.yml`](board-routing.yml) and is applied by the Chief
Architect. Summary:

- **Minimum:** 2 principals + the adversarial critic
- **Maximum:** 4 principals — a cost ceiling
- **More than 4 domains implicated → reject the proposal as too broad and require it be
  split.** This is a feature. A change touching five domains is not one decision; debating it
  as one guarantees a muddy outcome.
- Any principal may **self-nominate** into a debate it was not routed to, with a one-line
  justification. Cheap insurance against gaps in the routing table.

---

## Output and the ratification gate

```
debt-cartographer ──▶ kb/private/debt/register.md
                              │
        Chief Architect triage ┘
                │
             DEBATE ──▶ kb/decisions/NNNN-*.md          the decision + dissent
                │
                └────▶ kb/debt/proposals/NNNN-*.md      spec + implementation plan
                              │
                    ── HUMAN RATIFICATION ──            approve · reject · defer
                              │
                       Jira Epic in LIV ──▶ implementation agent (Phase 6+)
```

**WIP cap: 8 open unratified proposals.** The board blocks on its own backlog rather than
generating indefinitely. A proposal-only body with no downstream capacity produces a pile
nobody can act on, which is demoralising and worse than silence.

**The knowledge base holds the reasoning; Jira holds the state.** An ADR records *why* and does
not change; a ticket records *where the work is* and changes constantly. Keeping them separate
is why neither has to be edited to keep the other true.

---

## Standing role after the bootstrap

The board does not dissolve once its first sweep is done. From Phase 6 onward the relevant
principal is a **required reviewer** on implementation PRs in its domain. The board becomes the
standing review authority — which is where a solo-maintained codebase gets the second pair of
eyes it otherwise lacks (Constitution P33).

## Related

- [debate-protocol.md](debate-protocol.md) — the rounds in detail
- [board-routing.yml](board-routing.yml) — the routing table
- [knowledge-base-spec.md](knowledge-base-spec.md) — where output may be written
- [../standards/work-tracking.md](../standards/work-tracking.md) — proposal → Epic
