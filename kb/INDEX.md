---
tier: 3
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-20
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Livil Knowledge Base — Index

**Read this first.** It routes you to the 1–2 documents you need. Do not load the whole
knowledge base; load what this table points to.

Rules for the knowledge base itself: [knowledge-base-spec.md](ai-org/knowledge-base-spec.md).
How we work: [ENGINEERING_CONSTITUTION.md](ai-org/ENGINEERING_CONSTITUTION.md).

Status: ✅ available · ⏳ planned (wave) · ✍️ awaiting human author · 🔒 private content

---

## Start here

| Read | When |
|------|------|
| [ENGINEERING_CONSTITUTION.md](ai-org/ENGINEERING_CONSTITUTION.md) ✅ | Always. Values, decision-making, when to refuse. |
| [architecture/overview.md](architecture/overview.md) ✅ | Always. What this system is, and which domain owns what. |
| [glossary.md](glossary.md) ✅ | When a Livil term is unfamiliar or means something unusual. |

### The knowledge base itself

| Read | When |
|------|------|
| [ai-org/knowledge-base-spec.md](ai-org/knowledge-base-spec.md) ✅ | Before adding or changing any document here. |
| [ai-org/knowledge-map.md](ai-org/knowledge-map.md) ✅ | To see every document's tier, owner, and freshness. Generated. |

---

## Routing — find your question

### "How does playback work?"
| Question | Document |
|----------|----------|
| Audio engine, media session, lock screen, clip coordinates | [architecture/playback.md](architecture/playback.md) ✅ |
| Upload, storage, transcoding, streaming, file limits | [architecture/media-pipeline.md](architecture/media-pipeline.md) ✅ |
| Why the native dependency is patched | [decisions/0002-patched-video-library.md](decisions/0002-patched-video-library.md) ✅ |

### "How does the app work?"
| Question | Document |
|----------|----------|
| State model, contexts, re-render behavior, navigation | [architecture/client.md](architecture/client.md) ✅ |
| Services, Supabase access patterns, error handling | [architecture/backend.md](architecture/backend.md) ✅ |
| Realtime subscriptions, presence, jam sync, push | [architecture/realtime.md](architecture/realtime.md) ✅ |
| Sessions, sign-in, deep links, username claim | [architecture/auth.md](architecture/auth.md) ✅ |

### "What's in the database?"
| Question | Document |
|----------|----------|
| Tables, columns, indexes, triggers | [architecture/data-model.md](architecture/data-model.md) ✅ |
| Privileged functions and their authorization guards | [architecture/rpc-reference.md](architecture/rpc-reference.md) ✅ 🔒 |
| Row-level security policies | [security/rls-policies.md](security/rls-policies.md) ✅ 🔒 |
| Routes, screens, services, dependency versions | [architecture/inventory.md](architecture/inventory.md) ✅ |

### "How do I write code here?"
| Question | Document |
|----------|----------|
| Conventions, required components, enforced rules | [standards/coding.md](standards/coding.md) ✅ |
| Colors, tokens, spacing, iconography | [standards/design-system.md](standards/design-system.md) ✅ |
| Query patterns, RPC conventions, error taxonomy | [standards/data-access.md](standards/data-access.md) ✅ |
| What to test and why | [standards/testing.md](standards/testing.md) ✅ |
| How work is tracked (Jira `LIV`), ticket types, agent limits | [standards/work-tracking.md](standards/work-tracking.md) ✅ |
| Latency, memory, frame, bundle budgets | [standards/performance-budgets.md](standards/performance-budgets.md) ✅ |

### "Is this safe?"
| Question | Document |
|----------|----------|
| The security model — where the perimeter is | [security/model.md](security/model.md) ✅ |
| Attack surface and threats | [security/threat-model.md](security/threat-model.md) ✅ 🔒 |
| Policy inventory | [security/rls-policies.md](security/rls-policies.md) ✅ 🔒 |

### "How does it ship and run?"
| Question | Document |
|----------|----------|
| What actually runs in production (**no AWS**) | [operations/infrastructure.md](operations/infrastructure.md) ✅ |
| Build and release process | [operations/deployment.md](operations/deployment.md) ✅ |
| External services, why chosen, exit paths | [operations/third-party.md](operations/third-party.md) ✅ |
| Scale we design for, and the known cliffs | [operations/scaling-assumptions.md](operations/scaling-assumptions.md) ✅ |
| Emergency procedures | [operations/runbooks/keystore-recovery.md](operations/runbooks/keystore-recovery.md) ✅ · [incident-response.md](operations/runbooks/incident-response.md) ✅ · [disable-autonomy.md](operations/runbooks/disable-autonomy.md) ✅ |

### "How does the AI organization work?"
| Question | Document |
|----------|----------|
| The Architecture Board — mandate, membership, limits | [ai-org/board-charter.md](ai-org/board-charter.md) ✅ |
| How debates run, and why each round exists | [ai-org/debate-protocol.md](ai-org/debate-protocol.md) ✅ |
| Which principals are routed into which debate | [ai-org/board-routing.yml](ai-org/board-routing.yml) ✅ |
| Whether the advisory reviewers are worth listening to | [ai-org/review-log.md](ai-org/review-log.md) ✅ |
| Where agents may write, and why the rest is propose-only | [`.claude/autonomy-config.yml`](../.claude/autonomy-config.yml) ✅ |
| What agents may do without a human, and why the ceiling is Tier 2 | [ai-org/autonomy-policy.md](ai-org/autonomy-policy.md) ✅ |

### "Why is it like this?"
| Question | Document |
|----------|----------|
| Decisions, alternatives considered, recorded dissent | [decisions/](decisions/) ✅ — [0001](decisions/0001-single-audio-engine.md) · [0002](decisions/0002-patched-video-library.md) · [0003](decisions/0003-on-device-waveform-decode.md) · [0004](decisions/0004-supabase-direct-no-api-tier.md) · [0005](decisions/0005-ios-platform-status.md) · [0006](decisions/0006-maintain-patched-video-until-trigger.md) · [0007](decisions/0007-storage-policies-unversioned.md) · [template](decisions/TEMPLATE.md) |
| Past failures and the rules they produced | [incidents/README.md](incidents/README.md) ✅ 🔒 |
| Known debt, ranked by blast radius | [debt/register.md](debt/register.md) ✅ 🔒 · [proposal template](debt/proposals/TEMPLATE.md) · open: [PROP-0001](debt/proposals/0001-hedge-the-patch.md) · [PROP-0002](debt/proposals/0002-version-storage-config.md) |

### "What are we building, and why?"
| Question | Document |
|----------|----------|
| Product vision | [product/vision.md](product/vision.md) ✍️ |
| Roadmap and sequencing | [product/roadmap.md](product/roadmap.md) ✍️ |
| Business goals and success measures | [product/business-goals.md](product/business-goals.md) ✍️ |

> ✍️ **These three require a human author.** Until they exist, agents have no basis for
> product tradeoffs and must escalate such decisions rather than guess (Constitution P63).

---

## Domain ownership

Six domains. Each owns a set of paths and the documents describing them.

| Domain | Owns |
|--------|------|
| `principal-playback` | Native media, media session, clip coordinates, the patch |
| `principal-data` | Schema, RLS, privileged functions, services, query performance |
| `principal-client` | State model, navigation, components, design system |
| `principal-security` | AuthN/AuthZ, deep links, secrets, user safety |
| `principal-realtime` | Subscriptions, presence, jam sync, push delivery |
| `principal-platform` | Build, CI, release, dependencies, native toolchain |

---

## Related, deliberately separate

| Location | What | Why separate |
|----------|------|--------------|
| [`.ai/`](../.ai/) | Brand, content strategy, Instagram system | Marketing audience and lifecycle, not engineering. Cross-referenced, never merged — absorbing it would exceed the context budget. |
| [`docs/`](../docs/) | Public marketing site for livil-music.com | Published by GitHub Pages. **Never put engineering docs here** — they would be served publicly on the product domain. |
| `kb/private/` | Sensitive documents (🔒 above) | Gitignored. Backed by a separate private repository. See [spec §4](ai-org/knowledge-base-spec.md). |

---

## Maintaining this index

Every document under `kb/` must be reachable from this file — an orphaned document is a
defect (Constitution P48), and `npm run kb:validate` enforces it.

**Hard cap: 200 lines.** If this file outgrows the cap, routing has failed. Fix it by moving
detail into a domain document, never by raising the cap.
