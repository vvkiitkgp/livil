---
tier: 3
owner: principal-platform
consumers: [P-PF, DO, P-DA]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Infrastructure

What actually runs in production. Nothing here is aspirational.

---

## There is no AWS

**No AWS account, SDK, credentials, or infrastructure-as-code exists in this project.** No EC2,
S3, Lambda, RDS, CloudFront, or anything else. This is stated explicitly because AWS is a
common assumption for a mobile backend, and reasoning from it here would be wrong.

Also **not** present, despite appearing in older documentation as plans:

| Named in old docs | Reality |
|---|---|
| Cloudflare R2 for file storage | Never built — storage is Supabase |
| Socket.io for realtime | Never built — realtime is Supabase |
| A backend service of our own | There is none — clients talk to Postgres |

---

## What does run

```
┌──────────────────────────────────────────────────────────┐
│  Android devices  (Play Store, com.livil)                │
└────────────┬─────────────────────────────┬───────────────┘
             │                             │
             ▼                             ▼
   ┌───────────────────┐         ┌────────────────────┐
   │  Supabase         │         │  Firebase (FCM)    │
   │  Postgres + RLS   │         │  push transport    │
   │  Auth · Storage   │         └────────────────────┘
   │  Realtime · Edge  │
   └───────────────────┘
             ▲
             │ the dashboard talks to Supabase directly, same as the app
   ┌───────────────────┐
   │  Vercel           │  livil-music.com        — marketing, static, from docs/
   │                   │  livil-music.com/studio — creator dashboard, from web/
   └───────────────────┘
```

### Supabase — the entire backend

| | |
|---|---|
| Project ref | `fqzrmqnlgjeuxzinbqvs` |
| Region | Mumbai (`ap-south-1`) |
| Services in use | Postgres, Auth, Storage, Realtime, one Edge Function |
| Storage buckets | `avatars`, `tracks-media` |

Migrated from an earlier Sydney project on 2026-07-07, primarily for latency. The old project
is parked as a fallback and is **not** kept in sync — it is a historical snapshot, not a
standby.

**This is a single point of failure for the entire product.** There is no multi-region setup,
no read replica, and no failover. That is an appropriate trade at current scale and should be
a conscious one — see [scaling-assumptions.md](scaling-assumptions.md).

### Firebase — push transport only

Project `livil-87116`. **Cloud Messaging is the only service used.** Not Firestore, not
Firebase Auth, not Analytics, and notably **not Crashlytics** — there is no crash reporting.

The Android config file is committed, which is standard: it is a client identifier extractable
from any published APK. It should nonetheless be restricted by package name and signing
certificate in the cloud console.

### GitHub

| Repo | Visibility | Role |
|---|---|---|
| `vvkiitkgp/livil` | **public** | The application |
| `vvkiitkgp/livil-kb-private` | private | Sensitive knowledge base content |

**`docs/` is a published website.** Engineering documentation must never go there — it is why
the knowledge base lives at `kb/`. Since 2026-08-05 it is published by **Vercel** rather than
GitHub Pages ([deployment.md](deployment.md)); the directory's status as public did not change,
only who serves it.

**GitHub Pages is still enabled**, serving the redirect that keeps three Play-registered policy
URLs alive until the listing points at `livil-music.com`. It is a retirement in progress, not a
second hosting strategy.

**CI runs on every push, on every branch** — `.github/workflows/ci.yml`, plus `ai-review.yml`
and `edge-function-parity.yml`. Not only on pull requests: feature branches are pushed and
reviewed directly here, so gating on PRs would leave most pushes unverified.

Eight jobs, and they check more than code:

| Job | What it defends |
|---|---|
| `typecheck · lint · test` | the obvious one |
| `knowledge base` | link validity, and that generated docs are not stale |
| `version drift` | `CLAUDE.md` still matches `build.gradle` |
| `migrations apply cleanly` | every migration in order against a shim, then the authorization, RPC-contract, stories, messages, deletion and comments suites, plus a `SECURITY DEFINER` `search_path` lint |
| `production matches the repo` | schema parity against the live database — **also on a 07:00 UTC schedule**, because drift can start without a push |
| `board is proposal-only` | the Architecture Board cannot write code |
| `agents write only where tests exist` | [autonomy-config.yml](../../.claude/autonomy-config.yml), enforced rather than asserted |

The scope gate has a **known limitation**: it identifies agent work by `agent/*` branch names
and `Agent-Implemented:` trailers, so an agent using neither is not detected. It is a
convention gate, not a cryptographic one — `scripts/enforce-agent-scope.mjs` says so itself,
and the never-lists apply to every author regardless.

### Google Play

| | |
|---|---|
| Package | `com.livil` |
| Track | **Production** — live since 2026-08-14, full rollout, 176 countries + rest of world |
| Current | versionCode 70 / versionName 2.0.5 |

---

## The Android build

| Setting | Value | Note |
|---|---|---|
| minSdk | 24 | Android 7.0 |
| compile / target SDK | 36 | Current |
| Architectures | **`arm64-v8a` only** | Excludes 32-bit ARM and x86 from release builds |
| New Architecture | on | Fabric — see [../architecture/playback.md](../architecture/playback.md) |
| Hermes | on | |
| ProGuard / R8 | **off** | Unminified, unobfuscated; larger APK, readable stack traces |

Permissions requested: internet, notifications, camera, media images, external storage
(legacy), vibrate, foreground service, foreground service media playback. Deliberately narrow —
notably **no audio recording**, since waveform analysis decodes files rather than capturing.

**iOS does not build.** No `Podfile.lock`, no installed pods, no entitlements, and missing
usage descriptions that would both fail review and crash at runtime. Three commits have ever
touched it. Treat the platform as unsupported until a decision says otherwise.

---

## Single points of failure

Ranked by cost of loss.

| Asset | Blast radius | Recoverable? | Backed up? |
|---|---|---|---|
| Supabase project | Total product outage; user data loss | Only as far as provider backups reach | Provider backups only |
| **Edge function source** | Push breaks | **No — the source exists nowhere but the provider** | **No — not in any repo** |
| Play Console account | Cannot ship at all | Google account recovery, which can fail | Google account recovery |
| Release signing key (**upload key**) | Releases blocked until reset approved — **days** | Yes — Play App Signing is enrolled; Google holds the app signing key | One copy, one laptop. See [runbooks/keystore-recovery.md](runbooks/keystore-recovery.md) |
| Developer machine | Blocks releases entirely | Yes, with setup time | Whatever is on it |

**This table was reordered on 2026-07-21.** The signing key sat at the top on the belief that
its loss was permanent; it isn't (see the runbook). The genuinely unrecoverable asset here is
the **edge function source**, which exists in no repository — it ranks below Supabase only
because its blast radius is push notifications rather than the whole product.

**Release capability depends on one machine.** The signing key and its passwords live on a
single laptop. Nothing in this list is redundant.

## Related

- [deployment.md](deployment.md) — how a release is made
- [third-party.md](third-party.md) — vendors and exit paths
- [scaling-assumptions.md](scaling-assumptions.md) — where this stops working
