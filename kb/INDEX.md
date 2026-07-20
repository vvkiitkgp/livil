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

---

## Routing — find your question

### "How does playback work?"
| Question | Document |
|----------|----------|
| Audio engine, media session, lock screen, clip coordinates | [architecture/playback.md](architecture/playback.md) ⏳ W3 |
| Upload, storage, transcoding, streaming, file limits | [architecture/media-pipeline.md](architecture/media-pipeline.md) ⏳ W3 |
| Why the native dependency is patched | [decisions/](decisions/) ⏳ W6 |

### "How does the app work?"
| Question | Document |
|----------|----------|
| State model, contexts, re-render behavior, navigation | [architecture/client.md](architecture/client.md) ⏳ W3 |
| Services, Supabase access patterns, error handling | [architecture/backend.md](architecture/backend.md) ⏳ W3 |
| Realtime subscriptions, presence, jam sync, push | [architecture/realtime.md](architecture/realtime.md) ⏳ W3 |
| Sessions, sign-in, deep links, username claim | [architecture/auth.md](architecture/auth.md) ⏳ W3 |

### "What's in the database?"
| Question | Document |
|----------|----------|
| Tables, columns, indexes, triggers | [architecture/data-model.md](architecture/data-model.md) ⏳ W2 |
| Privileged functions and their authorization guards | [architecture/rpc-reference.md](architecture/rpc-reference.md) ⏳ W2 🔒 |
| Row-level security policies | [security/rls-policies.md](security/rls-policies.md) ⏳ W2 🔒 |
| Routes, screens, services, dependency versions | [architecture/inventory.md](architecture/inventory.md) ⏳ W2 |

### "How do I write code here?"
| Question | Document |
|----------|----------|
| Conventions, required components, enforced rules | [standards/coding.md](standards/coding.md) ⏳ W5 |
| Colors, tokens, spacing, iconography | [standards/design-system.md](standards/design-system.md) ⏳ W5 |
| Query patterns, RPC conventions, error taxonomy | [standards/data-access.md](standards/data-access.md) ⏳ W5 |
| What to test and why | [standards/testing.md](standards/testing.md) ⏳ W5 |
| Latency, memory, frame, bundle budgets | [standards/performance-budgets.md](standards/performance-budgets.md) ⏳ W5 |

### "Is this safe?"
| Question | Document |
|----------|----------|
| The security model — where the perimeter is | [security/model.md](security/model.md) ⏳ W4 |
| Attack surface and threats | [security/threat-model.md](security/threat-model.md) ⏳ W4 🔒 |
| Policy inventory | [security/rls-policies.md](security/rls-policies.md) ⏳ W2 🔒 |

### "How does it ship and run?"
| Question | Document |
|----------|----------|
| What actually runs in production (**no AWS**) | [operations/infrastructure.md](operations/infrastructure.md) ⏳ W4 |
| Build and release process | [operations/deployment.md](operations/deployment.md) ⏳ W4 |
| External services, why chosen, exit paths | [operations/third-party.md](operations/third-party.md) ⏳ W4 |
| Scale we design for, and the known cliffs | [operations/scaling-assumptions.md](operations/scaling-assumptions.md) ⏳ W4 |
| Emergency procedures | [operations/runbooks/](operations/runbooks/) ⏳ W4 |

### "Why is it like this?"
| Question | Document |
|----------|----------|
| Decisions, alternatives considered, recorded dissent | [decisions/](decisions/) ⏳ W6 |
| Past failures and the rules they produced | [incidents/](incidents/) ⏳ W6 🔒 |
| Known debt, ranked by blast radius | [debt/register.md](debt/register.md) ⏳ W6 🔒 |

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
