---
tier: 3
owner: principal-platform
consumers: [P-PF, CA, DO]
last_verified: 2026-07-21
verify_every: 365d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Third-Party Services & Dependencies

Every external dependency, why it was chosen, what breaks without it, and how we would leave.

The exit path matters more than the choice. A dependency with no exit is not a vendor
relationship, it is an architecture.

---

## Services

### Supabase — Postgres, Auth, Storage, Realtime, Edge

**Role:** the entire backend.

**Why:** one provider covering database, authentication, file storage, and realtime, with no
server to operate. For a solo-maintained product that is decisive.

**If it disappears:** total product outage. Everything stops.

**Lock-in: high, and unevenly so.**

| Layer | Portability |
|---|---|
| Postgres data and schema | **Good** — standard Postgres, dumps out cleanly |
| Row-level security policies | **Good** — standard Postgres |
| Auth | **Poor** — users, identities, and sessions are provider-shaped |
| Storage | Moderate — objects copy out; URL structure and policies do not |
| Realtime | **Poor** — no direct equivalent elsewhere |
| Edge functions | Poor — and our one function's source is not in any repo |

**Exit:** the database is genuinely portable. Auth and realtime are the anchors — migrating
would mean reimplementing sign-in and every subscription. A move would be measured in months.

**Concentration risk:** one project, one region, no replica, no failover. Deliberate at this
scale; revisit per [scaling-assumptions.md](scaling-assumptions.md).

### Firebase Cloud Messaging — push transport

**Role:** delivering push notifications. **Nothing else** — not Firestore, not Firebase Auth,
not Analytics, not Crashlytics.

**Why:** on Android there is no practical alternative. FCM is the platform mechanism.

**If it disappears:** push stops. The app keeps working.

**Lock-in:** low in code (a thin service module), unavoidable on the platform.

### notifee — notification display

**Role:** rendering notifications. Paired with FCM data-only messages so the app controls
channels, grouping, and layout rather than the OS auto-displaying.

**If it disappears:** fall back to OS-rendered notifications, losing per-category channels and
messaging-style layout.

**Exit:** moderate — the display layer is contained, but the data-only send convention is
built around it.

### GitHub — code, and CI

Repositories, Actions, and — until the Play policy URLs finish moving — a Pages deployment kept
alive only for the redirect it serves ([deployment.md](deployment.md)).

**If it disappears:** development continues from local clones; the web deploy stops, since
Vercel builds from pushes to `main`.

**Exit:** easy for code. Harder than it looks for the redirect, which is load-bearing for three
Play-registered URLs until those declarations republish.

### Vercel — the web surface

Serves `livil-music.com` (marketing, from `docs/`) and `livil-music.com/studio` (the creator
dashboard, from `web/`) out of one project, rebuilt on every push to `main`. Added 2026-08-05
([ADR-0015](../decisions/0015-web-creator-dashboard.md)).

**If it disappears:** the marketing site and the dashboard go down together; the Android app is
unaffected, because it talks to Supabase directly and never to Vercel. Artists lose desktop
upload; listeners lose nothing.

**Exit:** easy. The build is a static bundle plus `vercel.json`; any static host takes it. The
one thing that does not travel is the Vercel-side configuration — root directory and the two
`VITE_*` variables — which is why `deployment.md` records them.

### Resend — transactional email

SMTP relay for every Supabase auth email: signup confirmation, password reset, password-changed
notice, email change. Sends as `noreply@mail.livil-music.com` over `smtp.resend.com`, with SPF,
DKIM and a bounce MX on the `mail.` subdomain. Free tier: 3,000/month, 100/day, one domain.

**If it disappears:** nobody can confirm an address or reset a password — account recovery stops
entirely. The app keeps working for anyone already signed in, which makes the failure quiet.

**Exit:** easy and rehearsed. It is one SMTP host, username and key in Supabase's settings; any
provider substitutes in minutes. The domain verification records travel with the DNS, not with
Resend.

**Watch:** inbound is **off**, so mail sent to `noreply@` bounces. Templates must not invite
replies — they point at the contact address published on the policy pages instead.

### Google Play — distribution

**If access is lost:** cannot ship. See [runbooks/keystore-recovery.md](runbooks/keystore-recovery.md)
for the signing key, which is the sharper risk.

**Exit:** none realistically. It is the Android distribution channel.

### Atlassian Jira — work tracking

**Role:** the backlog, and the intake point for the AI engineering organization.

**If it disappears:** work tracking stops; the product is unaffected.

**Exit:** designed to be easy. The tracker sits behind an adapter so agents never call it
directly — swapping trackers should touch one module.

---

## Notable code dependencies

Full versions are generated into [../architecture/inventory.md](../architecture/inventory.md).
Only the ones carrying real risk are discussed here.

### react-native-video — **patched, and the largest upgrade obstacle**

Pinned to an exact version with a **1,373-line local patch** across Kotlin, Java, Swift, and
TypeScript, implementing clip-relative lock-screen presentation, native track skipping, and
background auto-advance.

**Upgrading means re-deriving the entire patch.** Every hunk is commented with its rationale,
which makes it possible rather than easy.

**Alternative considered and rejected:** `react-native-track-player` — V4 launch-crashes on
this React Native version with the New Architecture, and the paid V5 introduces audio/video
sync risk for video posts. Recorded so it is not re-proposed annually.

### react-native-audio-api — decode only

Used **only** for one-shot file decoding to build the waveform envelope. **Never** as a
playback engine — that would create a second audio engine and break the single-engine
invariant. See [../architecture/playback.md](../architecture/playback.md).

### react-native-app-auth — unused

Declared as a dependency and imported nowhere. It ships a native library into the binary for
nothing. **Safe to remove**; Google sign-in goes through the browser instead.

### Icon libraries — pure JS

Phosphor plus one Lucide icon, both rendering through the existing SVG library. No native
rebuild needed to add an icon.

---

## Dependency policy

**The bar for adding is high; the bar for removing is low** (Constitution P13). Every
dependency is a future upgrade obligation, and this project already carries one that is
extremely expensive to move.

Before adding anything:

1. Does it work on this React Native version with the New Architecture? Verify, do not assume.
2. Does it require a native rebuild, and does it conflict with the patched media library?
3. Could a small amount of our own code do it instead?
4. What is the exit path?

**Versions are pinned deliberately.** A dependency that drifts past a documented pin has broken
the contract even when nothing visibly fails (P52). The generated inventory reports drift
between declared ranges and installed versions.

## Related

- [infrastructure.md](infrastructure.md)
- [../architecture/inventory.md](../architecture/inventory.md) — versions, generated
- [scaling-assumptions.md](scaling-assumptions.md)
