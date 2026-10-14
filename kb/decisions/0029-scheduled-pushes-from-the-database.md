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
   records that), so a digest is only news. Names: friends, then people the viewer stars,
   then others.
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
- At today's size one hand-off sends a whole slot. Past a few thousand recipients, claim in
  batches and let `push_maintain` hand off the remainder.
