---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-29
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0001, 0008, 0014, 0023]
---

# ADR-0022 — Store jam suggestions in their own table, keyed by post, delivered by row changes

| | |
|---|---|
| **Status** | **Proposed — technical design.** Product questions **Escalated** (§ Open questions). Not Accepted: see *Protocol deviation*. |
| **Date** | 2026-09-29 |
| **Domain** | data + security + realtime (with client) |
| **Decided by** | Board review, **degraded protocol** — Chief Architect moderating; positions for principal-data, principal-security, principal-realtime, principal-client and the adversarial critic were written in ONE context, not dispatched independently. Awaiting human ratification. |

---

## Protocol deviation — read first

The Chief Architect session that produced this had **no agent-dispatch tool**. Round 1 was therefore
not blind and not parallel: every position below was written by one author, reading the code
through each principal's lens. The convergence recorded here is **not** independent convergence
and must not be weighted as such (Constitution P10). The *Dissent* section records positions the
author could construct against the design, not positions a principal actually held.

**Recommendation:** before ratifying, re-run Rounds 1–3 with dispatched principals, or ratify with
that caveat stated. The code facts below were verified by reading the repository; nothing was run
against production.

## Triage (Round 0)

The owner's request (listener taps become suggestions; a Suggests tab; unread badge; search)
touches five domains: data (schema), security (RLS, mandatory on any migration), realtime (jam),
client (screens), and playback (`PlaybackContext`, where a listener's tap would be intercepted).
That is over the four-domain ceiling, so it was **split**:

| Decision | Principals | Record |
|---|---|---|
| Where suggestions live, who may write/read them, how they reach devices, Suggests tab | data, security, realtime, client | **this ADR** |
| What a listener's tap does anywhere in the app while in a jam | playback, client | [ADR-0023](0023-listener-tap-routing-in-a-jam.md) |

**Not routed:** principal-platform. Nothing here touches `android/`, `ios/`, native deps, or CI.
principal-playback is routed to ADR-0023 only; this ADR must not touch the engine.

**Framed question:** *Where should a jam suggestion be stored, and what authorization and delivery
mechanism should it use?*

## Context — verified facts

1. **`jam_queue` exists and is effectively dead.** Columns `jam_room_id, track_id, suggested_by,
   position, upvotes, added_at` (`20260528000000_chat_jam.sql:91`). The only writer in use is
   `bulkAddToQueue` at jam start (`ConversationScreen`); `getJamQueue`, `addToQueue` and
   `upvoteQueue` have no callers. `upvoteQueue` calls an RPC `upvote_queue_item` that **does not
   exist** (D-31; `supabase/tests/rls/rpc-contracts.test.sql:126`). The Jam Queue tab reads each
   device's local `PlaybackContext` queue instead (`JamRoomScreen.tsx:489`), so rows written at jam
   start are read by nothing.
2. **`jam_queue` references `track_id`, not `post_id`.** Playback needs a post: clip window,
   media URLs, author (`feedPostToNowPlaying`, `handlePlayShared`). A track has many posts
   (uploads and clipped reposts).
3. **`jam_queue` RLS** (`jq_select/insert/delete`): read and insert require a `jam_room_members`
   row; delete is suggester or host; **no update policy**. Insert does not check that the jam is
   active or that `can_suggest` is true.
4. **`can_suggest` is data, not enforcement.** It sits in `jam_room_members.permissions` (jsonb),
   default `true`, and is read only by the client.
5. **Pre-existing authorization gap on `jam_room_members` (new finding, unverified against
   production).** A member can alter fields of their own membership row that they should not be
   able to alter. Detail is withheld from this public document (PROP-0005 precedent) and was
   reported to the maintainer. **It matters here:** any policy that gates on `permissions` —
   including a `can_suggest` check — is only as strong as that row. The generated doc
   `kb/private/security/rls-policies.md:196` truncates the relevant `USING` clause, which is
   probably why it was missed.
6. **Chat messages send a push.** `sendMessage` → `dispatchMessagePush`
   (`src/services/messages.ts:300`) notifies every other member. Updating a message's state is
   the boundary [ADR-0014](0014-reject-widening-msg-update-for-orphaned-messages.md) refused to
   widen, and the `messages` write boundary has open defects (PROP-0005).
7. **Takedowns and blocks work by making rows unreadable** (`20260923060000_blocked_tracks_invisible.sql`):
   *"The queue cannot contain what the client cannot fetch."* Takedowns delete posts.
8. **Realtime conventions** (`kb/architecture/realtime.md`): row changes are RLS-gated and suit
   durable, low-frequency data; broadcast is for high-frequency state and must be sent server-side.
   Jam chat already subscribes `postgres_changes` on `messages` in a `jam:chat:{id}` channel that
   lives **only while `JamRoomScreen` is mounted**.
9. **Account deletion** had to rework `jam_queue.suggested_by` and `track_id` foreign keys
   (`20260722200000_account_deletion.sql:87,123`). Any new FK to `profiles` or `posts` is on that
   path.

## Decision

1. **New table `jam_suggestions`.** Do not reuse `jam_queue`, and do not use `messages`.
   Shape: `id`, `jam_room_id → jam_rooms ON DELETE CASCADE`, `post_id → posts ON DELETE CASCADE`,
   `suggested_by → profiles ON DELETE CASCADE`, `created_at`.
   `UNIQUE (jam_room_id, post_id, suggested_by)`.
   - **Dedupe:** one row per person per song. "Suggested by 3 people" is a `count` over rows for
     the same `post_id`, not a stored counter. No `upvotes` column, no upvote RPC.
   - **No stored title/cover/artist.** The card joins `posts` at read time so takedowns and blocks
     hide a suggestion automatically (fact 7).
   - **No status column and no UPDATE policy.** Host actions (Play now / Add to queue / Dismiss)
     **delete** the row. The smallest write surface is no update path at all (fact 6, ADR-0014).
2. **RLS:**
   - `select`: caller has a `jam_room_members` row for the jam (same shape as `jq_select`).
   - `insert`: `suggested_by = auth.uid()`; the jam's `status = 'active'`; caller is a member;
     caller's `can_suggest` is true; the post is readable by the caller (RLS on `posts` applies
     inside the check).
   - `delete`: the suggester (Undo) or the jam's host.
   - **Prerequisite:** close the fact-5 gap in the **same or an earlier migration**. Without it,
     the `can_suggest` check is decorative.
3. **Limits (bounded by default, P22), enforced by a BEFORE INSERT trigger, not the client:**
   at most **N pending suggestions per person per jam** (proposed 10) and **M per jam** (proposed 50).
   Numbers are provisional and product-owned. A cap on *pending* rows is also the rate limit:
   the host deleting rows frees capacity, and a spammer stalls at N.
4. **Delivery: `postgres_changes` on `jam_suggestions`, filtered by `jam_room_id`.** Add it to
   the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. The subscription lives in a
   provider keyed on `activeJam.jamRoomId`, not in `JamRoomScreen`, so the badge works while the
   host browses the feed. Late joiners load the current list with one bounded select.
   **No push notification per suggestion.**
5. **Unread badge = per-device, in memory.** Count of rows with `created_at` later than the last
   time *this device* opened the Suggests tab, excluding your own. No server-side read state; a
   jam is a session, not an inbox (P25). Shown on the Suggests tab and on the jam pill of
   `FloatingPlayer` when you are outside the room.
6. **Search inside Suggests reuses the existing post search.** It must return **posts**, since that
   is what a suggestion references.
7. **`track_share` chat cards stay as they are.** A share is a deliberate chat message; a
   suggestion is a jam action. They are two records of two acts and are not merged.
8. **`jam_queue` is left untouched in this change.** It is recorded as a deletion candidate
   (P5): unread rows, uncalled functions, a missing RPC.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Reuse `jam_queue` as the suggestions table** | Keyed on `track_id` (a track is not playable without a post's clip window); host rows from `bulkAddToQueue` would appear as suggestions unless a discriminator is added; drags in `upvotes` and the non-existent `upvote_queue_item` RPC (D-31). Adding `post_id`, a kind column and fixing the RPC costs more than a new table and leaves two meanings in one table. |
| **Suggestions as a new `messages.kind`** (or reuse `track_share`) | Every tap would **push-notify every member** (fact 6) — the spam risk made systemic. State changes (played/dismissed) need a `messages` UPDATE path, which ADR-0014 refused to widen. Suggestions would outlive the jam in permanent chat history, and the `messages` boundary has open defects (PROP-0005). |
| **Broadcast-only (no table)** | Late joiners and reconnecting devices would miss everything sent before they arrived; client broadcast is documented as not delivering here (`realtime.md`); server-side broadcast needs a new `SECURITY DEFINER` function (P17) for data that is neither high-frequency nor ephemeral. |
| **Stored `upvotes` counter** | Counters drift and need a privileged RPC to increment safely. Row-per-person gives the same number from `count`, and Undo is a plain delete. |
| **Status column (`pending/queued/played/dismissed`) + host UPDATE policy** | Buys a history view nobody asked for, at the cost of an UPDATE policy and a `WITH CHECK` that must pin every other column. Revisit if "recently played suggestions" becomes a product need. |
| **Denormalized title/cover on the row** | A snapshot survives takedown and block, so it would show content the host is not allowed to see (fact 7). `track_share` messages already do this; that is a pre-existing gap, not a precedent. |
| **Server-side unread state (`last_seen_at` per member)** | A table, a policy and a write per tab-open, for a counter that only matters for the length of a session. Local count is wrong only after reinstall or on a second device, both acceptable for a jam. |
| **Subscribe inside `JamRoomScreen` (reuse `jam:chat` channel)** | Cheaper (no new channel), but the badge would not work outside the room — which is exactly where the host is when picking songs. |

## Consequences

**Easy:** a single authoritative list both host and listeners see; takedowns and blocks handled by
existing RLS; Undo is a delete; badge needs no server state; the engine is untouched by this ADR.

**Hard / costs:**
- One more RLS-gated realtime subscription per jam member for the jam's duration.
- **Delete events are not RLS-filtered by Supabase Realtime** and carry only the primary key
  (per Supabase documentation — *inferred, not verified here*). Every subscriber to the table may
  receive the bare `id` of deletions in other jams. Leaks a UUID, not content; accepted, but
  principal-security should confirm on a branch.
- A new migration on the authorization perimeter → mandatory security-reviewer (autonomy config).
- Account deletion gains another FK on its path (fact 9); `ON DELETE CASCADE` is chosen so it
  does not block.
- Group blocks are not checked for suggestions, matching chat (`can_write_to_conversation`
  returns `true` for groups). If the owner wants blocks to apply, that is new policy.
- The host's "Add to queue" adds to the **host's local queue**; listeners' Queue tab still shows
  their own local queue. This ADR does not make the queue shared — that is a separate question.

**Forecloses:** per-song voting as a stored score. Ordering "most suggested first" remains
possible via `count`.

## Dissent

*Constructed, not independently argued — see Protocol deviation.*

- **For messages-as-storage (client lens):** "One place for host actions. Chat already has
  realtime, rendering, and now `track_share` cards; a second list splits attention." Not adopted
  because of the push fan-out and the ADR-0014 update boundary; recorded because it is the
  option most likely to be proposed again.
- **For no `can_suggest` gate at all (security lens, minimalist):** "Membership is the authority;
  a permission read from a self-editable row is worse than none because it looks like a control."
  Adopted only conditionally: the gate ships **with** the fact-5 fix or not at all.
- **Adversarial critic:** *Not proven* that listeners want this. The current "tap does nothing"
  premise was wrong (see ADR-0023), so the owner has never observed listener taps in real
  sessions. A cap-based design is cheap to reverse; that is the main reason this is acceptable
  to build ahead of evidence.

## Open questions for the product owner (Escalated, P63)

1. Pending caps: 10 per person, 50 per jam — acceptable?
2. Do listeners see each other's suggestions and a badge, or is the list host-only?
3. Should a block between two members of a group hide one's suggestions from the other?
4. Ordering: newest first, or most-suggested first?
5. When the jam ends: silently keep rows (they are unreadable once members leave), or purge?

## Revisit when

- A "history of what the room played" feature is requested (would justify a status column).
- Suggestions need to persist beyond a jam (would change the storage question).
- Realtime connection count per user becomes a constraint on the Micro tier.
- The `jam_queue` deletion is proposed — confirm nothing here depends on it.
- The shared-queue question is taken up: suggestions and queue may converge then.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`.
