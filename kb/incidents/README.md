---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: private-content
supersedes: []
related_adrs: []
---

# Incident Record — private

**The incident record is held in the private knowledge base**, because incidents can contain
vulnerability detail and this repository is public.

| | |
|---|---|
| Real location | `kb/private/incidents/` |
| Backing repo | `vvkiitkgp/livil-kb-private` (private) |
| Entries | 5 backfilled, covering playback, data, client, and platform |

Each entry records the symptom as observed, the mechanism, **why it was hard to find**, the rule
it produced, and whether that rule is enforced. Constitution P2 — *we pay for a bug once* — is
unenforceable without this record.

An agent without access must say so rather than assume no relevant incident exists
(Constitution P6).

**Open classification question:** none of the five backfilled entries is security-sensitive —
they are engineering failures. Holding them privately reduces their usefulness, since the whole
point is that agents read them before touching related code. Reclassifying non-security
incidents as public is recommended and awaits a decision.
