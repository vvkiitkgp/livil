---
tier: 4
owner: principal-realtime
consumers: [ALL]
last_verified: 2026-07-22
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004]
---

# ADR-0008 — Notification recipients are derived server-side, never supplied by the client

| | |
|---|---|
| **Status** | **Accepted** — authorization model only. Delivery mechanism **Deferred** pending evidence (see Decision). |
| **Date** | 2026-07-22 |
| **Domain** | realtime (with data and security) |
| **Decided by** | board debate — principal-realtime, principal-data, principal-security, adversarial-critic; moderated by chief-architect. Ticket LIV-9. |

---

## Context

`src/services/pushDispatch.ts:29` calls `supabase.functions.invoke('send-push', {body: args})`. **That edge function has never existed.** Verified: `list_edge_functions` returns `[]` for the live Mumbai project (fqzrmqnlgjeuxzinbqvs) and the parked Sydney project (itmtmeobsclhyczidjct); `get_edge_function('send-push')` returns NotFoundException; `git log --all --diff-filter=A -- 'supabase/functions*'` is empty; `ls -R supabase/` shows only `migrations`, `tests`, and two seed files.

The failure is silent three times over: (1) `functions.invoke` catches internally and RETURNS `{data:null, error, response}` rather than throwing (verified in `node_modules/@supabase/functions-js/dist/main/FunctionsClient.js:161-171`), so the `try/catch` at `pushDispatch.ts:28-32` is unreachable dead code; (2) the returned `error` is discarded; (3) most callers use `void sendPush(...)`.

Correction to the ticket's own numbers, verified during the debate: **5** services import `sendPush`, not 6 (`messages.ts`, `activity.ts`, `relationships.ts`, `posts.ts`, `jamRooms.ts`). Of 14 declared `PushKind` values, only **11** are ever dispatched — `new_follower`, `jam_started`, `jam_join` are dead union members. And 3 of 8 call sites are not `void`: `messages.ts:49,79` sit inside `await Promise.all(...)` and `messages.ts:335` is a bare `await` (all wrapped in try/catch, so the effect is the same, but the stated mechanism was wrong for the message path).

`PushArgs` is `{recipientUserId, kind, title?, body?, data?: {route, params}}` — recipient, displayed text, and tap destination are all caller-supplied.

Dead since at least 2026-07-07 (the Mumbai migration); possibly never worked.

`src/services/pushNotifications.ts:121-125` — `handleNotificationData` does `if (!data?.route) return; const {route, ...rest} = data; navigateWhenReady(route as keyof RootStackParamList, rest)`. The cast is a compile-time assertion that erases at runtime. Reached from six entry points including `index.js:18`'s background handler. Verified that notifee's bundled Fresco fetches `largeIcon`/`person.icon` during `displayNotification` (strings `Timeout occurred whilst trying to retrieve a largeIcon image:` and `... a person icon:` extracted from the core AAR), so rendering — not tapping — issues a request to a payload-supplied URL.

**Why this survived for months:** `kb/architecture/backend.md:131`, `ADR-0004:36`, `kb/architecture/realtime.md:29,118,138,155`, `kb/operations/infrastructure.md:141`, `kb/operations/runbooks/incident-response.md:80`, and code comments at `pushNotifications.ts:175,293` all describe the edge function's behaviour confidently. `infrastructure.md:141` ranks its source as a top disaster-recovery loss risk. The documentation described a system that never existed clearly enough that no reader questioned it.

## Decision

1. **The recipient is never a parameter.** `recipientUserId`, `title`, and `body` are deleted from the dispatch contract rather than authorized. The only check that would make a caller-supplied recipient safe is re-deriving it server-side, which makes the parameter redundant and leaves a permanent input to distrust (P15).
2. **Notification emission is server-side, in the database, in the same transaction as the write that causes it.** Client-after-the-fact dispatch is rejected.
3. **The delivery mechanism is DEFERRED**, not chosen. Two candidate designs remain live (both recorded under Alternatives). The design family depends on `pg_net`/`pg_cron`, which **no participant verified exists on this project** — grep finds zero references to `pg_net`, `pg_cron`, or `net.http_post` anywhere in the repo, and no agent had database access. Naming a mechanism nobody confirmed exists would repeat, one layer up and in the same document family, the exact failure that produced this outage.
4. **Nothing may hold a `service_role` key.** It is not a table grant; it is a bearer JWT bypassing RLS on every table, unreachable by the CI harness at `.github/workflows/ci.yml:186-208`, and unrevokable in isolation.
5. **The forbidden order is transport-first.** No delivery may be deployed before the authorization defects listed in Consequences are fixed.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Fix `send-push` in place, client-called with caller-supplied recipient | Keeps D-46 structurally. To be safe it must re-derive authorization for 11 kinds — conversation membership, jam membership, post authorship, friendship state — in TypeScript, outside RLS, with `service_role`. That is precisely the duplicated cross-tier validation ADR-0004 bought its way out of, and a worse copy: the original is enforced by the database, the copy by code review. Also keeps client-side fan-out — `messages.ts:76-98` does `Promise.all(recipients.map(sendPush))`, one HTTPS request per group member from a phone (P22). |
| Client-invoked edge function taking a REFERENCE (`{kind, refId}`), not a userId | The strongest runner-up, argued by the adversarial critic and NOT eliminated. Kills recipient and body forgery: the function reads the referenced row as the caller through PostgREST so RLS still applies, then derives recipient and composes copy server-side. Costs one artifact, one secret, one privileged `device_tokens` read — no outbox, no pg_net, no pg_cron, no reaper, no retention policy, no triggers. Rejected by the three principals as still *lossy* (the row commits, then the client can be killed, backgrounded, or lose network before invoking). The critic priced that honestly: `activity_notifications` is in `supabase_realtime` with `replica identity full`, so a dropped dispatch costs one OS banner, not a lost event. **This alternative is deferred alongside the outbox design, not rejected.** |
| Trigger-emission into a deny-all `push_outbox`, drained to a relay holding only the FCM credential | The three principals' preferred design, also deferred. Triggers beat RPCs because they catch direct PostgREST writes (the D-53 lesson): verified that `sendMessage` is a plain RLS insert (`messages.ts:270-274`) and `toggleLike` likewise (`posts.ts:601-604`), so several kinds have no owning RPC. Not adopted because its mechanism is unverified and because the critic showed its rationale contradicts itself — see Consequences. |
| pg_net calling FCM directly, key in Vault | Architecturally cleanest (the perimeter never leaves the database) and rejected on blast radius rather than feasibility: it puts an FCM RSA private key inside the database, reachable by any future SECURITY DEFINER bug. This debate measured that base rate at four such functions. principal-security had rejected it on an unverified claim that pgcrypto lacks general RSA signing, then withdrew that as moot once the blast-radius argument settled it independently. |
| Supabase Database Webhooks (dashboard-configured) | Same pg_net underneath, but the configuration is unversioned production state: the exact disease that produced this outage (P51). |
| Third-party push (OneSignal / Expo) | Same authorization problem (their APIs also take recipient + body), a new vendor, RN 0.85 + New Arch compatibility risk, and it discards a debugged receive path: data-only FCM so the OS does not auto-display, notifee rendering, three channels, and two separate cold-start recovery paths (`pushNotifications.ts:299-311`). |
| plpgsql FCM JWT signing | Same private-key-in-database objection. |
| Postgres LISTEN/NOTIFY to a worker | Requires a long-lived process. An API tier by another name; ADR-0004's cost analysis applies unchanged. |
| "Use realtime instead" | Category error. Postgres-changes and broadcast reach a *connected* client. Reaching a user who is not in the app is the entire job. |
| Inline `net.http_post` with no outbox | No retry, and responses land in `net._http_response` which auto-vacuums (~6h default), so failure would again be observable by nobody. |

## Consequences

**What this settles:**
- The dispatch contract shrinks to something a client cannot abuse. Recipient forgery and body forgery are made unrepresentable rather than checked.
- Emission inherits whatever authorization gates event *creation*, so "can this person buzz your phone" becomes exactly "can this person act on you."

**What it does NOT settle, and this is the load-bearing cost:**

- **Deriving the recipient makes the notification faithful to the row. It does not make the row legitimate.** The debate's central refutation. Three principals designed a faithful-notification architecture without checking whether the originating row is forgeable. It is. Six authorization defects were found and independently verified by the moderator by reading the policy and function bodies:
  1. **`conversation_members` self-admin chain (P1).** `members_insert`'s first clause `user_id = auth.uid()` places no constraint on `role` (`20260528000000_chat_jam.sql:238`), and `conv_insert` only checks `created_by = auth.uid()` (:211). So: create a conversation, insert yourself as `role='admin'` (passes clause 1), then insert any victim (passes clause 2). `msg_insert` then passes and `list_my_conversations()` (:374) filters on membership with no friendship join. `get_or_create_dm`'s `assert_friendship` is bypassed by never calling the RPC. **This is D-53's exact shape, and migration `20260721120000` fixed the `jam_room_members` instance of this bug without fixing the `conversation_members` one.**
  2. **`friendships.status` unconstrained (P1).** `friendships_update` (`20260530000000_relationships.sql:28`) is a bare `USING (user_a_id = auth.uid() or user_b_id = auth.uid())` with **no `WITH CHECK`**; `friendships_insert` constrains `requested_by`, participation and self-edge but **not `status`**, which `friendships_status_check` permits to be `'accepted'`. One POST manufactures a mutual friendship, defeating `accept_friend_request`'s guard by not calling it, and unlocking `assert_friendship`, `stories_select`, `playlists_select`, `playlist_posts_select`, `listen_sessions_select_circle`.
  3. **`activity_notify_post`** (live body in `20260608000002_activity_comment_text.sql`) — guards are only: actor authenticated, `p_type in ('like','comment','repost')`, author exists and is not the actor. **No check that the caller liked, commented on, or reposted the post.** `p_comment_text` is attacker-supplied, truncated to 280 chars, stored to `payload.comment_text`, and rendered inline in the victim's activity center (`src/services/activity.ts:157-160`).
  4. **`activity_notify_new_fan(p_target)`** — the entire guard is `if v_me is null or p_target = v_me then return null; end if;`. No check the caller starred the target.
  5. **`activity_notify_friend_outcome(p_other_user, p_accepted)`** — same shape. No check a pending request exists. Forge "X accepted your friend request" to anyone.
  6. **`activity_record_play(p_post_id)`** — DEFINER insert into `post_views` with no guard beyond `auth.uid() is not null` and deliberately no dedup. `posts.views_count` is a term in the feed ranking score (`20260707000000_home_feed_single_call.sql:92`), so any authenticated user can rank any post to the top of discovery and fire arbitrary milestone notifications at any author.
  Additionally: **no `revoke execute` exists anywhere in 37 migrations** (`grep -rn "revoke" supabase/migrations/` returns 0 hits), so these run on the PostgreSQL default `EXECUTE TO PUBLIC`.
- **The severity is narrower than "phishing" in some respects and wider in others.** `actor_id` is forced to `auth.uid()` in all three notify functions, so there is no third-party impersonation — the victim always sees the attacker's real name. Rendered as React Native `<Text>`, so no injection primitive. The two harms that do justify urgency: **moderation evasion** (a forged `comment` delivers 280 attacker-chosen characters with no `post_comments` row to report, delete, or attribute — the victim cannot act on it) and **unbounded write amplification** (`new_fan`, `comment`, `repost` all leave `agg_key` null, so the partial unique index `activity_notifications_agg_uq ... where agg_key is not null` does not apply, and a loop inserts unlimited rows into another user's row space on a Micro instance).
- **D-45's stated remedy is falsified.** The register says moving notifications "into the owning SECURITY DEFINER function fixes both [forgeable and lossy]." These three *are* in DEFINER functions and are still forgeable. Server-side emission fixes lossiness and does nothing for forgeability. Recording this so LIV-9 is not read as closing D-45.
- **ADR-0004 is factually wrong and is NOT superseded.** Its decision — clients talk to Postgres directly, no API tier — stands and was reaffirmed. Two corrections are required: line 36's "There is one edge function, for push fan-out" is false and must be struck; and its consequence "Authorization cannot be bypassed by a privileged middle tier, because there isn't one" must be marked as ceasing to hold once any transport is deployed. `kb/private/architecture/rpc-reference.md:58-59` marks `activity_notify_friend_outcome` and `activity_notify_new_fan` as SELF-SCOPED, "the caller can only act as themselves" — true of the actor, false of the recipient.
- **A privileged component will exist.** ADR-0004's cleanest claim dies whichever mechanism is chosen. The board's aim is to make it minimal and unreachable, not to pretend it is absent.
- **Push amplifies the missing block/mute capability.** Push turns "an abusive user can message you" into "an abusive user can wake your phone," with no user-side remedy. Escalated to the human as a product-risk call (P63) rather than decided here.

## Dissent

- **adversarial-critic — on status and venue.** Argued the entire output should be **Deferred** and written to `kb/debt/proposals/`, not `kb/decisions/`, because the central mechanism is unverified. The board adopted this for the delivery mechanism but not for the authorization decision, which has no dependency on `pg_net`. The critic's position is that this split still risks the ADR being read as blessing the outbox design.
- **adversarial-critic — the transport rationale contradicts itself.** The principals killed pg_net-direct because a future DEFINER bug could reach an FCM key in the database. Their chosen design still uses pg_net, and if the relay holds only the FCM credential it cannot read `device_tokens` — so the database must hand it the tokens in the request body, placing every recipient's registration token and up to 200 characters of DM plaintext (`messages.ts:65-72`) into `net.http_request_queue`/`net._http_response` for ~6h. The same DEFINER-bug threat then reaches private message content instead of an RSA key. **Either that trade is argued explicitly, or the relay holds a privileged DB credential and "nothing holds service_role" is false. The summary asserted both.** Unresolved.
- **adversarial-critic — "emitters first, no transport, measure a week" is theatre.** Every source table already carries a timestamp (`messages.created_at`, `post_likes.created_at`, `follows.created_at`, `friendships.created_at`, `jam_rooms.started_at`), so one `GROUP BY date_trunc('hour', ...)` yields the same distribution across months, retroactively, with zero deployed artifacts. Deploying triggers on the hottest write path to collect data already held is strictly dominated. Defensible as rollout staging; not as measurement.
- **principal-realtime vs principal-data — push-to-relay vs pull-worker.** UNRESOLVED. realtime: data's push model breaks token invalidation, because FCM `UNREGISTERED` arrives per-token in a response the relay cannot write back with, so results must be reaped from `net._http_response` before it auto-vacuums, and a missed window loses the invalidation permanently. data: storing the pg_net request id on the outbox row solves the join, and the pull model forces a bidirectional long-lived credential. Moot until `pg_net` is verified.
- **principal-security vs principal-realtime — exception handling in the emission trigger.** realtime: a failed notification must never break the message (3 of 8 call sites are in the message-send path). security: swallowing exceptions in-transaction reconstructs precisely the silent-loss property that produced this outage; the never-break guarantee belongs to the drain, not the emission. The critic proposed a resolution neither stated: the trigger's only job is one INSERT into a table with no FK to anything volatile, no unique index and no policies, so the set of errors it can raise is nearly empty by construction — it should raise, and the guarantee comes from making failure impossible rather than from catching it.
- **principal-data — correction to realtime, adopted.** Do NOT delete device tokens on FCM `INVALID_ARGUMENT`: v1 returns 400 for a malformed *message* as well as a malformed token, so one bad payload would truncate `device_tokens` for every user in the batch — an unrecoverable self-inflicted outage. Delete on 404 `UNREGISTERED` and 403 `SENDER_ID_MISMATCH` only.
- **Two principals reversed position under cross-examination, recorded because the reversals were the debate's most useful moments.** principal-security read the DEFINER layer as sound in Round 1, then re-read and conceded fully: "I described the DEFINER layer as authorizing when it only authenticates — the exact error I claim to police." It also withdrew its position that a `service_role` bypass was unavoidable. principal-realtime corrected its own Round 1 claim that the activity kinds could reuse their existing DEFINER functions, having found that 5 of 11 kinds are notification side-cars decoupled from the resource write.

## Revisit when

- The `pg_net` / `pg_cron` availability query has been run. One statement settles the whole design family: `select name, default_version, installed_version from pg_available_extensions where name in ('pg_net','pg_cron');`
- The six authorization defects above are fixed and property-tested, at which point trigger-based emission rests on a legitimate row.
- Push volume makes the reference-only design's lossiness measurable in banners per week — the delta the outbox design must justify.
- A block/mute capability ships, or the human rules that push may precede it.
- Scale outgrows one FCM POST per device token.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
