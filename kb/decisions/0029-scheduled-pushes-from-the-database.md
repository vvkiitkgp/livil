---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-14
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0028]
---

# ADR-0029 — Scheduled pushes are decided in the database and worded from ops

| | |
|---|---|
| **Status** | **Accepted** — owner-directed 2026-10-14; migration `20261025000000_scheduled_pushes.sql`, `send-push` `flushScheduled`, `/studio/ops` → Notifications |
| **Date** | 2026-10-14 |
| **Domain** | data + realtime (push) + web (ops) |
| **Decided by** | owner |

---

## Context

Until now every push was caused by one person doing something to another (a like, a message)
and was dispatched by the actor's app through `send-push`. The owner wanted Livil's own
notifications on a timetable — mood nudges at 08:00 and 20:00 IST and a repost digest at
11:00 and 18:00 IST — with ten hand-picked mood lines rotating, digests that name the people
who reposted, and the ability to change any wording, pause any slot, and see what each line
did (sent / opened / came back) from the ops dashboard, without a deploy or an app release.

Nobody's phone is involved at the moment such a push is due, so it cannot be dispatched the
existing way; something on the server has to wake up, decide who gets what, and send it.

## Decision

1. **The database decides; `send-push` only delivers.** pg_cron runs `push_run_slot(slot)` at
   the slot's time. It picks the next active line, works out recipients and — for digests —
   the final text, and queues one `push_deliveries` row per recipient. It then hands the send
   to `send-push` with `net.http_post` (pg_net) and `{"scheduledSendId": …}`. `send-push`
   recognises that body before resolving a user, claims the queued rows (`queued → sending`,
   one UPDATE), and sends them through the same FCM, APNs and token-pruning code as every
   other push. `push_maintain()` (every 15 min) retries rows still queued, expires them after
   an hour, fills `came_back`, and purges past retention.
2. **Digest visibility is the posts policy's own predicate.** `push_digest_for(viewer, …)`
   counts reposts under exactly `posts_select_authenticated`'s rule (not blocked either way;
   reposter public or a friend; never the viewer's own), so a friends-only repost is never
   counted or named to a stranger — and skips any repost the viewer already has a
   `post_impressions` row for (it was on their screen in the Home feed; every shipped build
   records that), so a digest is only news. **Only friends and people the viewer stars are
   named** (friends first); everyone else is counted ("and 10 others", or "12 people" when
   nobody known reposted), and the photo is only ever a named person's. A stranger's display
   name is free text, and naming the last stranger to repost would let anyone put e.g.
   "Livil Security: account locked…" atop most people's notification twice a day (security
   review of #279). Control and direction-override characters in names become spaces.
   Rendered text is blanked after 7 days, so a deleted account's name does not linger in
   other people's delivery rows.
3. **Wording is data.** `push_messages` (ops-only by RLS, no DELETE — lines are switched off,
   so stats keep their meaning) holds every line; digests may use `{names}`, `{songs}`,
   `{since}` and nothing else (CHECK constraint, mirrored in the ops form). `push_slots`
   holds the four switches; ops may update `enabled` only (column grant).
4. **Everything starts off.** Applying the migration sends nothing; ops turns slots on. Mood
   slots stay off until the app release that adds the "Mood reminders" switch
   (`notification_preferences.reminders`), because App Store guideline 4.5.4 requires an
   in-app opt-out for this kind of message. Digests follow the existing Activity switch.
5. **India time for everyone** (cron in UTC, IST has no DST) until a release sends each
   device's time zone.
6. **Measurement.** `opened` = a tap reported with the push's `pushId` via
   `push_record_open` (recipient-only) by builds that know the key; `came_back` = the
   recipient's `user_last_seen` stamp within the hour after the send (every build stamps it
   while foregrounded; someone already in the app counts too).

## Alternatives considered

- **A separate edge function on a cron trigger, deciding recipients in TypeScript.** Rejected:
  the visibility rule would be re-implemented outside SQL and drift from the posts policy,
  and the FCM code would be duplicated or split into a shared module that every deploy of
  both functions must carry.
- **Supabase scheduled functions calling `send-push` with the service-role key.** Rejected: it
  needs the service-role key in Vault and a human to place it there. The hand-off instead
  uses the public anon key to pass the gateway, and the body is harmless on its own: it can
  only release rows the database queued, once.
- **Sending from SQL directly to FCM.** Not possible: FCM v1 needs an RS256-signed OAuth
  token, which Postgres cannot mint.
- **Hard-coded wording in `send-push`.** Rejected by the owner's requirement to change copy
  from ops without a deploy.

## Consequences

- `send-push` has a second entry that runs without a user. It is bounded to delivering rows
  from deny-all tables written by `push_run_slot` / `ops_push_test`; reviewed as such.
- Requires pg_net. The migration creates it when the platform offers it, and fails loudly
  otherwise; CI stands it in with a recording stub (`net.stub_requests`).
- The app release must add the Mood reminders switch, tap reporting (`pushId`), and
  `collapseId` handling for `mood` / `digest` on Android before mood slots are switched on.
  All three live in `src/services/pushNotifications.ts`: a `reminders` entry in
  `NOTIFICATION_CHANNELS` (the settings row and its own Android channel, which the display
  path also creates on demand, since an updated-but-unopened app has never run `initPush`);
  `handleNotificationData` calling `push_record_open` on every tap path, and landing a
  digest on the Home tab; and `cardIdFor` mapping `mood` / `digest` to one replacing card
  each. Builds before that release show mood nudges on the Activity channel and cannot
  report opens, so their recipients count only toward "came back".
- At today's size one hand-off sends a whole slot (lookups and status writes go 100 ids per
  request). Past a few thousand recipients, claim in batches and let `push_maintain` hand off
  the remainder.
- Ops access now means a broadcast to every user (edit a line, switch a slot on). `is_ops()`
  is plain `ops_users` membership; requiring an MFA session (`aal2`) for these writes is a
  recorded follow-up. Slots stamp `updated_by` so a switch is attributable.

## Amendment — New music (2026-10-14, `20261027000000_new_music_pushes.sql`)

Two more sends on the same machinery, both created **off** and gated on
`notification_preferences.new_music` (the "New music" switch the app release with ADR-0030
adds):

- **`new_drop`** — `push_run_new_drops()` every 5 minutes announces each upload (posted since
  the switch went on, within 2 hours, at least 2 minutes old) to the uploader's friends and
  starrers: not blocked either way, at most one new drop per person per 24 hours, once per
  upload (`push_sends.post_id`, unique for the slot). Naming the uploader and the song is
  safe here because only people who chose the uploader receive it.
- **`originals_weekly`** — `push_run_originals()` on Sundays 19:00 IST counts unseen uploads
  from the past week (`push_originals_for`, the digest's naming rule: friends and starred
  named, the rest counted). A stranger's upload counts only when its latest copyright scan is
  complete with no match — a broadcast in Livil's voice must not promote unchecked music —
  so a stranger's video (never scanned) never counts.

The CHECKs on `push_messages.pool`, `push_slots.slot/pool` and `push_sends.slot/kind` were
widened (nothing removed); `ops_push_test` gained the two preview branches with its existing
ones unchanged; `push_run_slot` and `push_digest_for` were not touched.

