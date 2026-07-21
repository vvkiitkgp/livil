---
tier: 3
owner: principal-realtime
consumers: [P-RT, BE, P-DA, QA]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Realtime & Event Flows

Four distinct mechanisms carry events in this app. They are easy to confuse, and choosing the
wrong one produces bugs that only appear under multi-device or backgrounded conditions.

**There is no socket.io.** It appears in older documentation as a plan; it was never built.

---

## The four mechanisms

| Mechanism | Carries | Delivery |
|---|---|---|
| **Postgres changes** | Row inserts/updates/deletes | Supabase Realtime, gated by row-level security |
| **Broadcast** | Jam playback state | Supabase Realtime channels, **sent server-side** |
| **Presence** | Who is in a Jam Room right now | Supabase Realtime presence |
| **Push (FCM + notifee)** | Out-of-app notifications | Firebase, fanned out by an edge function |

Plus a local `DeviceEventEmitter` bus for one in-app screen handoff. That one is not networked
and is not a realtime mechanism — it just shares the vocabulary.

---

## Postgres changes

Roughly ten modules subscribe to row changes: conversation messages and reactions, post
comments and comment likes, friendships, activity notifications, read receipts, inbox and home
badges, and jam chat.

Two rules that are easy to get wrong:

**1. Realtime is gated by the same row-level security as ordinary reads.** A table published to
`supabase_realtime` streams its changes only to subscribers whose policies allow the row. A
table with no policy is not "private by default" here — check
[../security/rls-policies.md](../security/rls-policies.md).

**2. The JWT must be pushed to the realtime client.** `supabase.realtime.setAuth(token)` is
called on session load and again on every auth state change. **Without it, row-level-security-gated
subscriptions are dropped silently** — no error, no events, the feature simply appears dead.
This is the single most common realtime failure mode here.

Every subscription cleans up with `supabase.removeChannel()` in its effect teardown. A missed
teardown leaks a channel per mount and eventually exhausts the connection.

Tables must also be added to the publication with `REPLICA IDENTITY FULL` for updates and
deletes to carry usable payloads.

---

## Jam Rooms

A Jam Room is a synchronised listening session attached to a conversation. One **host**
controls playback; **listeners** follow. Roles carry explicit permission sets.

### Playback state is broadcast server-side, not from the client

This is the non-obvious part and it is deliberate.

Client-side `channel.send({ type: 'broadcast' })` **returned `ok` and the messages never
arrived.** The working approach is a database function that calls the server-side realtime
send. The client calls the RPC; the server broadcasts.

The function is `SECURITY DEFINER` with an explicit host check inside its body, which
substitutes for per-jam authorization on the realtime messages table.

**Do not "simplify" this back to a client-side send.** It looks like an unnecessary hop. It is
the only thing that works.

### Sync model

The host broadcasts playback state on a short heartbeat. Listeners apply it against their own
engine. Mirror refs hold the host/now-playing state so the channel subscription is not torn
down and rebuilt on every render — the subscription effect keys only on the jam room id.

Every listener broadcast currently sets React state, so all consumers re-render on the
heartbeat interval. That is a known cost, recorded in the debt register.

---

## Presence

Two different things share the word:

- **Realtime presence** — Jam Room membership, ephemeral, dies with the connection
- **Heartbeat presence** — a periodic write of `last_seen_at` while the app is foregrounded,
  used for friends' activity

The heartbeat is a **write per foregrounded user per interval** against a single table. It is
fine at current scale and has an obvious ceiling; the number is in
[../operations/scaling-assumptions.md](../operations/scaling-assumptions.md).

A **listen session** is the durable record of what someone played, and is what friends'
activity is built from. It is distinct from presence.

---

## Push notifications

**Firebase Cloud Messaging for transport, notifee for display.** The split matters: the edge
function sends **data-only** messages so the operating system does not auto-display them, and
notifee renders them so the app controls channel, grouping, and layout.

Flow:

```
user action → service calls sendPush → edge function → FCM → device
   → data-only message → notifee renders → tap → deep link → navigate
```

Details that exist for specific reasons:

- **Tokens are upserted per `(user, device)`.** The token-refresh listener is rebound per
  sign-in so a stale closure cannot write a token under the wrong user.
- **Android 13+ notification permission is requested manually.** Firebase's own permission
  request is a no-op there.
- A **pre-prompt modal** gates the OS prompt behind a stored state machine, so the OS prompt is
  only spent when the user is likely to accept.
- **Three Android channels** allow per-category muting; chat notifications use a messaging
  style, others a large-icon layout.
- Cold-start taps are recovered from both the FCM and notifee initial-notification paths, then
  routed through a navigation-ready queue — the navigator may not exist yet when the tap
  arrives.
- **Push dispatch is fail-safe.** A failed notification must never break the message or like
  that triggered it.

The edge function's source is **not in this repository**. See [backend.md](backend.md).

---

## Choosing a mechanism

| If you need... | Use |
|---|---|
| React to a row changing | Postgres changes |
| Ephemeral "who is here" | Realtime presence |
| High-frequency state to a room | Broadcast, **sent server-side** |
| To reach a user who is not in the app | Push |
| To hand off between screens in-process | The local event emitter |

## Related

- [../security/rls-policies.md](../security/rls-policies.md) — what gates subscriptions
- [backend.md](backend.md) — services and the edge function
- [playback.md](playback.md) — the engine jam sync drives
