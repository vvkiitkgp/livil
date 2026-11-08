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
| **Broadcast** | Jam playback state, typing signals | Supabase Realtime channels, **sent server-side** |
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

### The socket while the app is backgrounded

**Never call `supabase.realtime.disconnect()` to pause realtime.** In realtime-js 2.99
`disconnect()` runs `channel.teardown()` on every channel: state `closed`, join push destroyed,
`bindings = {}`. `connect()` afterwards opens a socket with nothing joined, and every
subscription stays dead until its component re-runs its effect. An *unplanned* drop (network
blip, heartbeat timeout) is different: the library errors the channels and rejoins them with
their listeners. Both behaviours are pinned against the real library in
`RealtimeConnectionGate.test.tsx`.

`RealtimeConnectionGate` therefore closes the socket in the background **on iOS only**, where
`background` means really leaving the app and every count refetches on return. Refetching
does not revive a listener, so a subscriber that stays mounted across an app switch (a tab, a
context) puts `useRealtimeEpoch()` (`src/utils/realtimeEpoch.ts`) in its effect's dependencies
and in its channel's topic; the gate bumps it after reconnecting. Without it the socket reads
"open", the channel "closed", and the screen goes quiet until the app restarts: moving
Messages into a tab did exactly that. **On Android
it never closes it**: Android reports `background` on every pause of the activity (the
notification-tap trampoline, the share sheet, a permission dialog), so the teardown killed
Home's unread count and every other mounted subscription after the first one (fixed
2026-10-24). The cost is the heartbeat during a background listen, as during a jam.

Because the Android socket stays open, **a handler must not write seen-state from an event
that arrives while backgrounded** — ask `seenMustWait()` (`src/utils/seenWhileAway.ts`) and
mark on return. `ConversationScreen` (mark read, clear the chat's cards) and
`ActivityCenterScreen` (`markActivityRead`) do; every other subscriber only reads.

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
- **Heartbeat presence** — `touch_last_seen()` every 5 minutes while the app is
  foregrounded, into `user_last_seen` (RLS on, zero policies — **no user can read it**).
  Only the ops users overview ("last active") reads it. `profiles.last_seen_at` is kept
  but always NULL: a trigger redirects the Play Store build's direct write
  (`20260925010000_last_seen_is_ops_only`).

**Whether someone has the app open is never indicated to other users** — a product rule, not
an omission. The chat indicator is "listening now" only (below). The one exception is the
typing indicator: it tells the people in a chat that someone is typing to them, as they do it,
and nobody else. `list_my_conversations`
still returns a column named `other_user_online`, but since `20260925000000_listening_now`
it means "listening now"; it is kept only for builds already on the Play Store.

### Listening now (chat indicator)

`listen_sessions` holds one row per user: `playing`, the track, and the `post_id` a
friend's **Listen** opens.

- **Write:** `ListeningStatusReporter` publishes play/pause/track-change from the playback
  state (`activePostId === nowPlaying.postId`; stories and jams are not reported).
  `GlobalAudioPlayer`'s progress callback drives a **60s re-stamp** via `listeningTick` —
  progress events keep firing on the lock screen, where JS timers do not reliably run.
  `updated_at` is stamped by a trigger (server clock).
- **Liveness:** live = `playing and updated_at > now() - 150s`. A pause is an UPDATE to
  `playing = false` (never a DELETE — realtime delivers DELETE payloads without an RLS
  check). A process that dies mid-song drops out within 150s with no write at all.
  The trigger **scrubs a paused row** (title/artist blanked, `post_id` null, `updated_at`
  = epoch): the audience can still SELECT it, and it must not become a "last listened at"
  record.
- **Read:** `list_listening_now(uuid[])` (invoker) returns live rows plus `expires_in`, so
  viewers expire entries without trusting their own clock. `useListeningNow` subscribes to
  postgres changes on the row and applies heartbeats **locally**; it refetches only on a
  track change (for the cover art).
- **Audience:** `can_see_listening(owner)` — the owner, or **accepted friends only**, and
  only while the owner's `show_activity` (Privacy → "Show what I'm listening to") is on. Stars are excluded on
  purpose: a star needs no approval, so it would let any stranger watch.
  Enforced by the select policy (and therefore by realtime delivery) and inside the
  DEFINER `list_my_conversations`.

A **listen session** is this row. It is distinct from presence.

---

## Typing indicator

Shown in the chat list (`typing…`, or `Riya is typing…` in a group) and as three dots under the
newest message. Migration `20261120000000`, one-to-one chats and groups up to 50.

- **Send:** `useTypingSignal` (`src/utils/chatTyping.ts`) follows keystrokes: a signal on the
  first key, one every 3 s while keys keep coming, and one stop after 5 s without a key, or at
  once when the box is emptied, the message sent, the chat left or covered, or the app put in the
  background. Owner's rule (2026-11-08): a draft sitting in the box is not typing, so a pause
  costs nothing and a forgotten draft never reads as "typing…". `sendTyping` runs one call at a
  time, newest wins, so "stopped" cannot land before "typing".
- **Who hears it:** `send_typing` (definer) requires membership and
  `can_write_to_conversation`, skips anyone blocked either way, then calls `realtime.send` once
  per other member, on that member's own topic.
- **Receive:** one channel per signed-in person, `typing:<their id>`, opened by
  `ChatTypingListener` above the navigator. One topic per recipient because the chat list needs
  every chat at once.
- **Private, unlike the jam's topic.** User ids are public, so a public topic would let anyone
  watch who writes to whom. The `typing_own_topic_select` policy on `realtime.messages` lets you
  join only your own topic. There is no insert policy, so a client cannot send on it directly.
- **Expiry:** the receiving phone clears a person 7 s after their last signal. That is only for a
  sender who vanishes (app killed, no network), never the normal end of typing, which is an
  explicit stop.
- **Redraws:** the store is keyed per chat and a repeat signal notifies nobody. `RowPreview` and
  `TypingBubble` read it themselves, so a signal redraws one line, never a list. Keep it that way:
  `MessageRow`'s memo exists because re-rendering every bubble held the JS thread for seconds.
- **The channel cannot follow the realtime epoch's usual rule.** The server addresses this exact
  topic, so it cannot change per connection. Reusing a topic has two traps in realtime-js: a channel
  still leaving drops whatever is listed under that topic when it closes (`_remove` matches by
  topic), and after the iOS gate's `disconnect()` the dead channel stays listed. So
  `listenForTyping` waits for the old leave, then removes any leftover from
  `supabase.realtime.channels` before joining. Pinned against the real library in
  `src/services/__tests__/chatTyping.test.ts`; re-check it on any realtime-js upgrade.
- **Not stored as chat data, but not nothing:** `realtime.send` writes a row to
  `realtime.messages` (who, which chat, never the text), which Supabase clears by itself. A signal
  therefore costs a small database write per recipient, hence the group cap and a server-side
  limit (`typing_signal_limits`: one per second per person, "typing" and "stopped" apart), since a
  client can call the function directly and skip the app's 3 s.
- **A message beats a signal:** a person's message arriving clears them on the chat and the chat
  list at once, so a stop that was dropped or is still on its way never leaves dots up.

The seen time is not realtime's concern beyond the existing `conv-read` subscription:
`conversation_members.read_receipt_at` is set by a trigger, only when the reader's `last_read_at`
passes a new message from the other person. `last_read_at` itself moves on every chat open, so it
must not be used as "when they saw it". The same trigger caps `last_read_at` at the server's clock.

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
  only spent when the user is likely to accept. A new account is asked once, on the first-run
  guide's last card instead ("Turn on notifications", 2026-10-19 — the phone's own dialog,
  then registration in the background); the modal shows only once the person is in the app.
- **Three Android channels** allow per-category muting; chat notifications use a messaging
  style, others a large-icon layout.
- Cold-start taps are recovered from both the FCM and notifee initial-notification paths, then
  routed through a navigation-ready queue — the navigator may not exist yet when the tap
  arrives.
- **On Android, a tap on a backgrounded (alive) app reaches only `notifee.onBackgroundEvent`**
  in `index.js` — notifee's tap activity runs before ours resumes — and
  `getInitialNotification` is read once per process. So that handler routes the tap, through
  `handleNotificationPress`, which also drops the cold-start duplicate, skips a chat already on
  screen, and drops the push's `kind` (`message`) so `ConversationScreen` looks up dm/group
  itself. iOS taps arrive through FCM's `onNotificationOpenedApp` and are unchanged.
- **Push dispatch is fail-safe.** A failed notification must never break the message or like
  that triggered it.
- **The caller names who and what kind; the server decides what it says.** The edge function
  (`supabase/functions/send-push/`) authorizes each kind against the row the event left
  behind (the Activity row, the conversation, the jam room), then builds the title, body and
  tap target itself. Caller text is read only for a chat message preview and a reaction's
  emoji; `data.params` are ids to verify, never keys to copy. A block stops every
  person-to-person push, silently. The full gate list is in that directory's README.
- **Livil's own scheduled pushes are decided in the database** (ADR-0029). pg_cron runs
  `push_run_slot` at 08:00 / 11:00 / 18:00 / 20:00 IST; it queues `push_deliveries` with the
  final text (digest visibility = the posts policy's predicate, minus reposts already seen
  in the feed; only friends and starred people are named) and hands the send to
  `send-push` (`flushScheduled`) over pg_net. Wording and per-slot switches are edited in
  `/studio/ops` → Notifications; every slot starts off.
- **Likes on one post are one notification card.** Each like replaces the post's card
  (iOS `apns-collapse-id`, Android notification id `livil:like:<postId>`), and only the
  first like in 15 minutes makes a sound (`push_like_alerts`, claimed by send-push). Comments,
  reposts and everything else stay one card per event.

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
