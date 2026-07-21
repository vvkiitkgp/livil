---
tier: 1
owner: chief-architect
consumers: [DS, CA]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: generated
visibility: public
supersedes: []
related_adrs: []
---

# Knowledge Map

> **GENERATED FILE — DO NOT EDIT.**
> Produced by `npm run kb:generate`. Edits are overwritten on the next run.
> To change this document, change the generator or the source it reads.

45 document(s) under `kb/`.

## Health

| Metric | Count |
|---|---:|
| Documents | 45 |
| Drift-proof (tier 1 + 4) | 17 |
| Hand-maintained (tier 3 + 5) | 21 |
| Past freshness SLA | 0 |
| Private-content stubs | 5 |

Tiers 1 and 4 cannot drift by construction — the first is regenerated, the second is never
edited. Historical documentation drift in this project occurred entirely in hand-maintained
content, so the hand-maintained count is the number worth keeping small.

## Tier 1 — Generated

| Document | Owner | Consumers | Verified | SLA |
|---|---|---|---|---|
| `ai-org/knowledge-map.md` | chief-architect | DS, CA | 2026-07-21 | 9999d |
| `architecture/data-model.md` | principal-data | P-DA, BE, QA, DC | 2026-07-21 | 9999d |
| `architecture/inventory.md` | principal-client | ALL | 2026-07-21 | 9999d |
| `architecture/rpc-reference.md` 🔒 | principal-data | P-DA, P-SE, SR, BE | 2026-07-21 | 9999d |
| `security/rls-policies.md` 🔒 | principal-security | P-SE, SR, P-DA, QA | 2026-07-21 | 9999d |

## Tier 2 — Enforced

| Document | Owner | Consumers | Verified | SLA |
|---|---|---|---|---|
| `debt/register.md` 🔒 | chief-architect | DC, CA, TR, ALL | 2026-07-21 | 30d |
| `standards/coding.md` | principal-client | ALL, CR, RF, FE, BE | 2026-07-21 | 90d |
| `standards/data-access.md` | principal-data | BE, P-DA, CR, QA | 2026-07-21 | 90d |
| `standards/design-system.md` | principal-client | FE, RF, CR, P-CL | 2026-07-21 | 90d |
| `standards/performance-budgets.md` | principal-client | P-CL, P-PF, FE, QA | 2026-07-21 | 90d |
| `standards/testing.md` | chief-architect | QA, ALL, CR | 2026-07-21 | 90d |
| `standards/work-tracking.md` | chief-architect | TR, CA, ALL | 2026-07-21 | 90d |

## Tier 3 — Curated

| Document | Owner | Consumers | Verified | SLA |
|---|---|---|---|---|
| `ai-org/board-charter.md` | chief-architect | ALL | 2026-07-21 | 180d |
| `ai-org/debate-protocol.md` | chief-architect | ALL | 2026-07-21 | 180d |
| `ai-org/knowledge-base-spec.md` | chief-architect | ALL | 2026-07-20 | 180d |
| `architecture/auth.md` | principal-security | P-SE, SR, BE, CR | 2026-07-21 | 90d |
| `architecture/backend.md` | principal-data | P-DA, BE, CR, QA | 2026-07-21 | 90d |
| `architecture/client.md` | principal-client | P-CL, FE, RF, CR | 2026-07-21 | 90d |
| `architecture/media-pipeline.md` | principal-playback | P-PB, P-DA, BE, P-SE | 2026-07-21 | 90d |
| `architecture/overview.md` | chief-architect | ALL | 2026-07-20 | 90d |
| `architecture/playback.md` | principal-playback | P-PB, P-PF, CR, QA, FE | 2026-07-21 | 90d |
| `architecture/realtime.md` | principal-realtime | P-RT, BE, P-DA, QA | 2026-07-21 | 90d |
| `glossary.md` | chief-architect | ALL | 2026-07-20 | 180d |
| `INDEX.md` | chief-architect | ALL | 2026-07-20 | 90d |
| `operations/deployment.md` | principal-platform | DO, P-PF | 2026-07-21 | 90d |
| `operations/infrastructure.md` | principal-platform | P-PF, DO, P-DA | 2026-07-21 | 90d |
| `operations/runbooks/incident-response.md` | principal-platform | DO, P-PF, P-SE, human | 2026-07-21 | 180d |
| `operations/runbooks/keystore-recovery.md` | principal-platform | DO, P-PF, human | 2026-07-21 | 180d |
| `operations/scaling-assumptions.md` | principal-data | P-DA, P-PF, CA, DC | 2026-07-21 | 90d |
| `operations/third-party.md` | principal-platform | P-PF, CA, DO | 2026-07-21 | 365d |
| `security/model.md` | principal-security | P-SE, SR, P-DA, BE, ALL | 2026-07-21 | 90d |
| `security/threat-model.md` 🔒 | principal-security | P-SE, SR, CA | 2026-07-21 | 180d |

## Tier 4 — Append-only

| Document | Owner | Consumers | Verified | SLA |
|---|---|---|---|---|
| `debt/proposals/0001-hedge-the-patch.md` | principal-playback | CA, TR, ALL | 2026-07-21 | 9999d |
| `debt/proposals/0002-version-storage-config.md` | principal-data | CA, TR, ALL | 2026-07-21 | 9999d |
| `debt/proposals/TEMPLATE.md` | chief-architect | CA, TR, ALL | 2026-07-21 | 9999d |
| `decisions/0001-single-audio-engine.md` | principal-playback | ALL | 2026-07-21 | 9999d |
| `decisions/0002-patched-video-library.md` | principal-playback | ALL | 2026-07-21 | 9999d |
| `decisions/0003-on-device-waveform-decode.md` | principal-playback | ALL | 2026-07-21 | 9999d |
| `decisions/0004-supabase-direct-no-api-tier.md` | principal-data | ALL | 2026-07-21 | 9999d |
| `decisions/0005-ios-platform-status.md` | principal-platform | ALL | 2026-07-21 | 9999d |
| `decisions/0006-maintain-patched-video-until-trigger.md` | principal-playback | ALL | 2026-07-21 | 9999d |
| `decisions/0007-storage-policies-unversioned.md` | principal-security | ALL | 2026-07-21 | 9999d |
| `decisions/TEMPLATE.md` | chief-architect | ALL | 2026-07-21 | 9999d |
| `incidents/README.md` 🔒 | chief-architect | ALL | 2026-07-21 | 9999d |

## Tier 5 — Narrative

| Document | Owner | Consumers | Verified | SLA |
|---|---|---|---|---|
| `ai-org/ENGINEERING_CONSTITUTION.md` | human | ALL | 2026-07-20 | 365d |

## Ownership

| Owner | Documents |
|---|---:|
| chief-architect | 13 |
| human | 1 |
| principal-client | 5 |
| principal-data | 7 |
| principal-platform | 6 |
| principal-playback | 7 |
| principal-realtime | 1 |
| principal-security | 5 |

Every document has exactly one accountable owner — a surface nobody owns will decay
(Constitution P48).
