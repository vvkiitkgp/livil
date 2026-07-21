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

# Debate Protocol

Five rounds. Each exists to prevent a specific failure mode; the design notes below say which.

Participants are selected per [`board-routing.yml`](board-routing.yml). Mandate and limits are
in [`board-charter.md`](board-charter.md).

---

## Round 0 — Triage

**Who:** Chief Architect alone.

Decide and state publicly:

1. **Does this warrant a debate at all?** Check `no_debate` in the routing table. Terminating
   here with *"no debate needed — proceed"* is a good outcome.
2. **Who participates?** 2–4 principals, plus the adversarial critic.
3. **Is it too broad?** More than 4 domains → reject and require a split.
4. **Frame the question** in one sentence: answerable, and not leading.

> **Why:** debating routine work trains everyone to ignore the mechanism. A body that debates
> everything is indistinguishable from one that debates nothing.

State who was **not** routed and why. A silent omission is indistinguishable from an oversight.

---

## Round 1 — Positions

**Who:** the selected principals, **in parallel, with no visibility into each other**.

Each writes: what they would do, why, what it costs, and **what they are unsure about**.

> **Why parallel:** sequential debate anchors on whoever speaks first. Everyone after them
> argues against a framing rather than the problem. Positions written blind are genuinely
> independent, and where they *converge* independently that convergence means something.

> **Why "what I am unsure about" is mandatory:** it tells the critic where to push, and it is
> the honest form of Constitution P6. A position with no stated uncertainty is either trivial
> or overconfident.

Principals must distinguish what they **verified** from what they **inferred**.

---

## Round 2 — Cross-examination

**Who:** the same principals, now with all positions visible.

Each critiques the others from its own domain lens.

> **Why:** domain expertise is weighted, not absolute (P60). Cross-domain objections are
> legitimate precisely because domain experts share the blind spots of their domain. The
> playback expert is the *least* likely person to notice a playback assumption.

---

## Round 3 — Refutation

**Who:** the adversarial critic. **Never skipped.**

The critic tries to kill the emerging consensus, defaulting to "not proven" under uncertainty.

> **Why mandatory:** if the critic ran only when the board felt uncertain, it would never run
> when it mattered — the dangerous case is confident agreement.

> **Fast consensus escalates here, not to synthesis.** Quick agreement on something
> consequential is usually a shared blind spot rather than correctness (P10).

"I could not refute this, and here is what I tried" is a valid and valuable outcome.

---

## Round 4 — Synthesis

**Who:** Chief Architect.

Produces an ADR: **Accepted · Rejected · Deferred · Escalated**.

- **Dissent is recorded, never erased** (P62)
- **Alternatives considered** is the most valuable section — the rejected option is what someone
  proposes again next year (P11)
- **Costs are stated.** An ADR listing only benefits is advocacy, not a record
- If work follows, a proposal is written too — subject to the **8 open proposal** cap

---

## Deadlock

Escalate to the human in exactly this shape:

> **Question:** …
> **Position A** (principal-x): … *(≤3 sentences)*
> **Position B** (principal-y): … *(≤3 sentences)*
> **Precise point of divergence:** …
> **What would resolve it:** …

Never *"the agents could not agree."* A disagreement that cannot be stated this way has not
been understood well enough to escalate (P61).

---

## Cost control

Debates are expensive: 4–6 agents, each reading real code. Controls:

| Control | Value |
|---|---|
| Debates should cover | ~5–10% of changes |
| Principals per debate | 2–4 |
| Rounds | 5, fixed — no open-ended back-and-forth |
| Open unratified proposals | 8 max |

A board that debates everything costs more than it returns and gets switched off. The routing
table's `no_debate` list is as important as its triggers.

---

## What the protocol does not do

It does not make the board *right*. It makes disagreement visible, dissent durable, and
reasoning reviewable. A debate can still reach a wrong conclusion — which is why the human
ratification gate exists, and why ADRs record what would make us revisit.
