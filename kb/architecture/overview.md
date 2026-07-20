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

# Architecture Overview

The system map. **This document deliberately explains nothing in depth** — it establishes
shape and vocabulary, then routes you to the domain document that goes deep.

If you are looking for *why* something is the way it is, you want [decisions/](../decisions/)
or the domain document, not this file.

---

## What Livil is

A social music platform: creators upload audio and video, listeners follow each other, listen
together in real time (**Jam Rooms**), build shared playlists, and share clipped highlights as
**Stories** and **Reposts**. One React Native codebase, shipping on Android.

Terms in **bold** here have precise Livil-specific meanings — see [glossary.md](../glossary.md).

---

## Shape

```
┌─────────────────────────────────────────────────────────────┐
│  React Native 0.85.3 · New Architecture (Fabric) · Hermes   │
│  TypeScript (strict) · no Expo                              │
├─────────────────────────────────────────────────────────────┤
│  index.js      polyfills · FCM background handler · notifee │
│  App.tsx       GestureHandler ▸ SafeArea ▸ Keyboard          │
│                ▸ Playback ▸ Navigation ▸ Toast              │
│  RootNavigator four-state session gate + 5 more providers   │
│                ├ AuthNavigator      (6 screens)             │
│                ├ AppNavigator       (4 tabs, 23 routes)     │
│                └ Global overlays    (player surfaces)       │
├─────────────────────────────────────────────────────────────┤
│  8 Contexts  ·  22 Services  ·  screens call services       │
│  No API layer, no ORM, no query cache                       │
├─────────────────────────────────────────────────────────────┤
│  Supabase   Postgres + RLS · privileged RPCs · Realtime     │
│             Storage (avatars, tracks-media) · 1 Edge Fn     │
│  Firebase   Cloud Messaging (push delivery only)            │
└─────────────────────────────────────────────────────────────┘
```

**There is no backend service of our own.** Clients talk to Postgres through PostgREST and
privileged functions. This is a deliberate choice with real consequences — see
[backend.md](backend.md) and [../security/model.md](../security/model.md).

**There is no AWS.** Infrastructure is Supabase, Firebase, GitHub Pages, and Play Console.
See [../operations/infrastructure.md](../operations/infrastructure.md).

---

## The one thing to understand first

**Playback is a single engine.**

One component is the sole audio source for every post — audio tracks and the audio of video
posts alike — and the only owner of the OS media session. Every other player surface is a
follower: a muted video frame, a floating control, a waveform. They read position from shared
refs; they never produce audio.

This is the most expensive knowledge in the codebase, and the rule most likely to be broken by
someone who does not know it exists. **Before changing anything under playback, read
[playback.md](playback.md).**

Related invariant: time is **absolute** everywhere inside the app, and translated to
**clip-relative** only at the boundary with the operating system. One truth, converted at the
edge (Constitution P3).

---

## Domains

Six domains. Each has one owner and one deep document.

| Domain | Covers | Deep document |
|--------|--------|---------------|
| **Playback** | Media engine, media session, clip coordinates, native patch | [playback.md](playback.md) ⏳ |
| **Data** | Schema, RLS, privileged functions, services, queries | [backend.md](backend.md) ⏳ · [data-model.md](data-model.md) ⏳ |
| **Client** | State model, navigation, components, rendering | [client.md](client.md) ⏳ |
| **Security** | Sessions, authorization, deep links, user safety | [auth.md](auth.md) ⏳ · [../security/model.md](../security/model.md) ⏳ |
| **Realtime** | Subscriptions, presence, jam sync, push | [realtime.md](realtime.md) ⏳ |
| **Platform** | Build, release, dependencies, native toolchain | [../operations/](../operations/) ⏳ |

⏳ = planned; see [INDEX.md](../INDEX.md) for wave.

---

## Cross-cutting facts worth knowing early

**State is layered by update frequency.** High-frequency values (playback position, duration,
clip window) live in refs and never trigger re-render; surfaces poll them. Version counters
exist to opt back into rendering deliberately. Adding ordinary React state to the playback
context is a performance defect, not a style choice. See [client.md](client.md).

**Authorization lives in the database, not the client.** Deletes and updates are issued
without client-side owner filters and rely on row-level security. Client-side ownership checks
shape the interface only. See [../security/model.md](../security/model.md).

**Privileged database functions bypass row-level security by design.** Each one must prove its
own authorization. See [rpc-reference.md](rpc-reference.md).

**A native dependency is patched, extensively.** The media library carries a large local patch
implementing clip-relative presentation, native track skipping, and background auto-advance.
Upgrading it is a major undertaking, not a version bump. See [playback.md](playback.md).

**Media is served as whole files from public buckets.** There is no adaptive streaming, no
transcoding ladder, and no signed URLs. This is a real architectural limitation with known
consequences — documented honestly in [media-pipeline.md](media-pipeline.md).

**The platform defers work while backgrounded.** View commands and prop changes do not apply
reliably when the app is not foregrounded, which is why certain behavior had to move into
native code. This surprises people. See [playback.md](playback.md).

---

## What this document is not

It is not a tutorial, an API reference, or a rationale. It has a **200-line cap** and is
routing infrastructure. If you were about to add explanation here, it belongs in a domain
document instead.
