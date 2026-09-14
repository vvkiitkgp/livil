---
tier: 4
owner: chief-architect
consumers: [CA, TR, ALL]
last_verified: 2026-07-29
verify_every: 30d
verified_by: manual
visibility: private-content
supersedes: []
related_adrs: [0014]
---

# PROP-0005 — Restore the `messages` write boundary — private

**The content of this document is held privately.** It describes defects that are **live and
unfixed in production**, with reproduction detail. Publishing it from a public repository would
disclose a working method against the running app before the fix ships.

| | |
|---|---|
| Real document | `kb/private/kb-private-backup/debt/proposals/0005-restore-the-messages-write-boundary.md` |
| Backing repo | `vvkiitkgp/livil-kb-private` (private) — cloned at `kb/private/kb-private-backup/` |
| Status | Draft — awaiting human ratification |
| Defects | 4 on the `messages` table, plus 1 accumulation issue |
| Domain | data, with security and client |
| Addresses | [ADR-0014](../../decisions/0014-reject-widening-msg-update-for-orphaned-messages.md), D-62 |

Discovered by the Architecture Board on 2026-07-29 while debating a **different** question
(ADR-0014). None of these defects is a consequence of that debate; each predates it. The proposal
grants no new authority to anyone and needs no product decision — it is separable from the
escalation recorded in ADR-0014.

**Why this one is private when PROP-0001 through PROP-0004 are not:** those describe work to be
done. This one describes doors that are currently open. It returns to the public tree once the
fixes have shipped.

An agent without access must say so rather than assume the `messages` table carries no known
defects (Constitution P6).
