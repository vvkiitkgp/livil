---
tier: 3
owner: principal-security
consumers: [P-SE, SR, CA]
last_verified: 2026-07-21
verify_every: 180d
verified_by: manual
visibility: private-content
supersedes: []
related_adrs: []
---

# Threat Model — private

**The content of this document is held privately.** It enumerates assets, adversaries, attack
surface, and known-unfixed weaknesses with their exploit preconditions. Publishing that in a
public repository would be publishing a target list.

| | |
|---|---|
| Real document | `kb/private/security/threat-model.md` |
| Backing repo | `vvkiitkgp/livil-kb-private` (private) |
| Review cadence | Semi-annual, plus after any incident |

An agent without access to the private repository must say so plainly rather than treat this
stub as the full picture (Constitution P6). In particular, **do not conclude that an area is
safe because no concern about it appears in the public knowledge base.**

The security model as designed — the perimeter, trust boundaries, and rules — is public in
[model.md](model.md).

Rules governing private content: [knowledge-base-spec.md §4](../ai-org/knowledge-base-spec.md).
