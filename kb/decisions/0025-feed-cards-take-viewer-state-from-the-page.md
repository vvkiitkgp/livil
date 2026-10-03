---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-03
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0001]
---

# ADR-0025 — Feed cards take viewer state from the page, not from per-card network calls

| | |
|---|---|
| **Status** | **Proposed — awaiting human ratification.** Not Accepted: see *Protocol deviation*. Steps 4–5 **Deferred** until measured. The question of whether a blocked user may appear in "Liked by" is **Escalated** to the product owner (P63). |
| **Date** | 2026-10-03 |
| **Domain** | client + data |
| **Decided by** | Board review, **degraded protocol**. principal-client, principal-data, principal-security, principal-platform and adversarial-critic positions were all written in one context by the Chief Architect, because no dispatch tool was available. Same deviation as ADR-0022/0023. |

---

## Protocol deviation

Round 1 requires positions written **independently and in parallel**. Here they were written one
after another by one author. Convergence below is therefore **not** evidence of independent
agreement. It is one reasoner's view, checked against code. The critic round was still run and is
recorded honestly. Ratify with that discount applied.

## Triage

- **Debate warranted:** yes. It crosses domains (client render + query shape + migration) and the
  release-latency constraint (`operations/deployment.md` § Time to reach users) makes ordering
  matter.
- **Routed:** principal-data (mandatory, `feed | query performance`), principal-client (escalate,
  same rule), principal-security (mandatory escalation, because step 2 is a migration:
  `supabase/migrations/** → principal-security ALWAYS`), principal-platform (device-specific
  symptom, Samsung/120 Hz, Android vs iOS release channels). That makes 4, the maximum.
- **Not routed:** principal-playback. `PlaybackContext` re-render fan-out is a suspect, but changing
  it is **split out** of this decision (it would make 5 domains and trigger reject-and-split).
  principal-realtime: no subscription is involved.
- **Question:** *Which changes, in what order, remove the per-card network work that a fast feed
  fling triggers, without breaking installed app versions?*
- **Routing-table defect:** no rule covers client-side render or jank performance, and no rule
  brings in release-channel latency. The `feed | query performance` rule fit only by luck.

## Context — verified facts

Verified means read in this repository or in the locked dependency source. Nothing here was
reproduced on a device.

| # | Fact | Evidence |
|---|---|---|
| F1 | Every `PostCard` calls `supabase.auth.getUser()` on mount and then sets state with the result | `src/components/PostCard.tsx:115-122` |
| F2 | Every `LikedByLine` (one per card) calls `getUser()` on mount, and also calls `listPostLikers(postId,{limit:1})` whenever `likesCount > 0` | `src/components/LikedByLine.tsx:31-50` |
| F3 | In supabase-js/auth-js **2.99.3** (lockfile), React Native gets `lockNoOp`, because `isBrowser()` needs `document`. `_acquireLock` **still serialises** calls through its `lockAcquired`/`pendingInLock` FIFO chain, and that chain has **no timeout**. `getUser()` holds it for a full `GET /auth/v1/user` round trip | `auth-js dist/main/GoTrueClient.js:129-143, 1279-1330, 1425-1437`; `helpers.js:43` |
| F4 | Every PostgREST/RPC call goes through `_getAccessToken → auth.getSession()`, which waits in the same chain and also reads AsyncStorage | `supabase-js dist/index.cjs:492-497`; `GoTrueClient.js:1267-1273, 1361` |
| F5 | Consequence of F1–F4: after a fling, pagination (`fetch_home_feed`), likes, impressions and comments **wait behind** N serial `/user` round trips. Each round trip resolves into a full `PostCard` re-render | inference from F1–F4 |
| F6 | The Home feed is **not** hydrated by `hydrateRawPostRows` (`posts.ts:259`). It uses the `fetch_home_feed` RPC (`posts.ts:380-433`), which already returns `author.id` and `viewer_has_liked` in one call | `supabase/migrations/20260816030000_home_feed_candidates.sql:196-460` |
| F7 | `fetch_home_feed` is `SECURITY INVOKER`. `post_likes` SELECT is `using (true)` for authenticated users. Profiles are readable by authenticated users | `…candidates.sql:212`; `00000000000000_baseline_schema.sql:318-319, 279` |
| F8 | Blocking (`blocked_users`, 2026-08-08) cuts off **contact**, but **deliberately does not hide content**. There are no private accounts | `20260808100000_blocked_users.sql:10-25` |
| F9 | `post_likes` has PK `(post_id, user_id)` and an index `(user_id, created_at desc)`. There is **no** `(post_id, created_at desc)` index, so "latest liker" sorts all of that post's likes | `baseline_schema.sql:136, 246` |
| F10 | A viewer id already exists app-wide: `RelationshipContext.meId`, resolved once and kept current through `onAuthStateChange` | `src/contexts/RelationshipContext.tsx:66-80, 103-110` |
| F11 | `PostCard` keeps `liked`/`likesCount` in **local** state seeded from props, and never reports a toggle upward. After unmount and remount the card **reverts** to the like state from fetch time. It also seeds `NowPlayingInfo` from `post.viewerHasLiked`, not from local state, so the full-screen player can disagree with the card | `PostCard.tsx:172-173, 226-230, 316-320, 445-466` |
| F12 | Cover art and video thumbnails picked on mobile are cropped to **1024 px JPEG q0.85**, but only since **2026-09-25** (`#227`). Web uses 1024 px. Mobile uploads from before that date are original size | `src/services/mediaPicks.ts:12-20`; `git log` of that file; `web/src/components/CoverCropper.tsx:30` |
| F13 | Feed images use RN core `Image` (Fresco on Android) through `ProgressiveImage`, with no `resizeMethod` | `src/components/ProgressiveImage.tsx` |
| F14 | `PostCard` is `React.memo`, but calls `usePlayback()`. A context change bypasses memo, so any change to the 55-dependency value (for example `isBuffering`, `isReadyForDisplay`) re-renders **every mounted card** | `PlaybackContext.tsx:874-1010`; `kb/architecture/client.md` § god context |
| F15 | `PostCard` is rendered only by Home, ProfileScreen, UserProfileScreen and PostDetailScreen. Conversation, StoryViewer, CommentsSheet and SharePostSheet do **not** render it | `grep "<PostCard"` |
| F16 | HomeScreen FlatList: default `windowSize` (21), `removeClippedSubviews={false}`, `FEED_PAGE_SIZE=12`, `PREFETCH_FROM_END=5` | `HomeScreen.tsx:69-71, 882-929` |

**Not established.** That F5 is what freezes the *scroll*. F5 explains data stalls, such as a
feed that stops loading and likes that land late. A scroll that responds 1–2 s late points at a
saturated JS or UI thread. Candidates for that are: the re-render trickle from F1/F2/F5, mount cost
(several SVG `GradientBorder`s and a `WaveformScrubber` per card), full-size legacy bitmaps
(F12/F13), and F14 during playback. None of these has been measured (P21).

## Decision

Ordered. Each step is tagged by channel. Android ≈ 1 day; iOS ≈ 1 week; server ≈ immediate.

0. **Measure before and after (owner, no code).** Repro on a Samsung device and on an iPhone. See
   *Verification*. This is what turns steps 4–5 from Deferred into decided.
1. **Client: remove every per-card `getUser()`.** `PostCard` and `LikedByLine` read the viewer id
   from one place: `RelationshipContext.meId` (F10), or a prop passed down from the screen. No
   per-card auth call remains. Owner check stays `meId === post.author.id`. **No `viewer_is_owner`
   field is added to any payload**, because the client already has both ids.
2. **Server then client: latest likers ride in the page.** An additive migration adds
   `latest_likers` to the `fetch_home_feed` jsonb. It is up to **2** entries, `{id, username,
   display_name}`, newest first. Two entries, so that when the viewer un-likes and was the newest,
   the card still has the next name without a fetch. Add index `post_likes (post_id, created_at
   desc)`. The function **stays `SECURITY INVOKER`**. The client uses `latest_likers` when the key
   is present and **falls back to today's `listPostLikers` fetch when it is absent**, so either
   side can ship first. Profile and detail screens get the same field through their PostgREST
   select later. Their per-page cost today is one `getUser` and one `post_likes` query per page,
   not per card, so they are lower priority.
3. **Client: one engagement overlay keyed by post id.** Liked state, like count and comment count
   for posts the viewer has acted on live in a small app-level store. Generalise the existing
   `useCommentsCountDeltas.withDelta` pattern. Cards, the full-screen player and other screens read
   *page data + overlay*. This fixes F11: likes no longer revert on remount, and the full-screen
   player and the card stop disagreeing. It is **not** a normalised cache of whole posts.
4. **Client, Deferred until step 0:** FlatList tuning (`windowSize`, `maxToRenderPerBatch`,
   `updateCellsBatchingPeriod`). **Only after steps 1–3.** A smaller window means *more* remounts,
   which today means *more* network work. `removeClippedSubviews` stays `false` unless measured on
   Fabric/Android.
5. **Client (Android) or ops, Deferred until step 0:** image sizing for pre-2026-09-25 covers. Try
   the cheapest option first: `resizeMethod="resize"` on feed images (Android only). A re-encode
   backfill comes only if memory profiling shows bitmaps dominate.

**Release bundling.** Ship steps 1 + 3 + the client half of step 2 as **one** iOS submission. Use
the 1-day Play channel first, with step 1 alone if useful, as the measurement probe. Do not submit
to iOS until the Android build has been measured. A wrong iOS guess costs a week. The migration in
step 2 may ship any time before the client. It is invisible to installed versions, because
`mapRpcFeedPost` builds named fields and ignores unknown keys (`posts.ts:302-320`).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Keep per-card fetches, add a module-level memo of `getUser()`** | Removes the round trips, but keeps a hidden global that has to be invalidated on sign-out. `meId` already handles sign-out (F10). This is two truths for one fact (P3). |
| **Use `getSession()` per card instead of `getUser()`** | No network call, but it still waits in the auth FIFO and reads AsyncStorage once per card (F4). It is cheaper, but the per-card shape stays. |
| **Feed-level normalised cache (every post by id, every screen reads from it)** | Solves staleness in general, but adds the abstraction before the third occurrence (P25). Only like and comment state actually goes stale between surfaces (F11), and the overlay in step 3 covers that at a fraction of the surface. Revisit if a third mutable field appears. |
| **Each screen passes complete data, no shared store** | Already the model for read-only fields, and it stays. It cannot fix F11, because mutations happen *after* the data was passed. |
| **One RPC returning everything, including `viewer_is_owner`** | `viewer_is_owner` is derivable on the client from `author.id` and `meId`. A server copy is a second truth, plus payload, for no gain. |
| **Return only the single latest liker** | The viewer's own un-like then needs a refetch to find the next name. Two entries cost about 100 bytes more per post. |
| **FlatList tuning first ("cheapest change")** | It could make things worse until remounts are cheap (step 4 note). It is also unmeasured. |
| **Server-only fix to avoid the iOS week** | None exists. Every per-card call starts in client code, and the server cannot stop a client from calling `/auth/v1/user`. Said plainly rather than invented. |
| **Supabase image transformations for thumbnails** | Plan availability on Micro is unverified, and it adds a vendor dependency (P13). Kept as a step-5 option only. |

## Consequences

- **Easier:** feed remounts become free of network work, so scroll-back cost becomes pure render
  cost and can be profiled on its own. Likes stop reverting.
- **Costs:** about 150–250 bytes per post (roughly 2–3 KB per page of 12). One more index to
  maintain on `post_likes`, with write amplification on every like (negligible at current scale,
  which is unmeasured, see `scaling-assumptions.md`). On the server side, 12 index lookups move
  inside one statement. That is the same database work as today minus 12 HTTP requests, but it
  lengthens the feed RPC slightly. **`fetch_home_feed` page latency is the number to watch**
  (performance-budgets: about 1.0 s today).
- **Staleness:** "Liked by" is a snapshot from fetch time until refresh. Today it refetches on
  every remount, so it can be fresher. Accepted: the bold name is decoration and the count already
  works the same way.
- **Forecloses nothing.** Everything is additive and reversible. The fallback path in step 2 means
  removing the field later breaks nothing.
- **iOS:** users on the current App Store build keep the per-card calls for about a week after
  Android is fixed.

## Dissent

**adversarial-critic — Partially refuted.**
- *Attacked:* the claim that steps 1–2 fix "the hang". *Checked:* auth-js 2.99.3 source (F3/F4).
  The serialisation is real. But it is network waiting, and network waiting does not block a
  thread. The specific symptom (a scroll that responds 1–2 s late) is a frame-level stall, and
  nothing in the evidence pins it on auth. **Not proven.** Steps 1–3 are justified on their own
  terms: wasted calls, blocked pagination, the F11 correctness bug. They must **not** be reported
  as "the fix for the Samsung hang" until step 0 shows the hang gone.
- *Attacked:* "Samsung-specific". Nothing found is Samsung-specific. F1–F5 and F11 are JS and run
  identically on iOS. F12/F13 (bitmap memory) are the only Android-leaning suspect, because iOS
  `RCTImageLoader` decodes near display size (inferred, not verified here). Prediction: iOS shows
  the data stalls and the like reverts, with a milder scroll symptom.
- *Attacked:* the secondary suspect "covers are not resized". **Refuted for uploads since
  2026-09-25** (F12). It survives only for older rows, and how many of those are in the feed is
  unknown.
- *Unresolved:* whether `/auth/v1/user` calls in a burst hit GoTrue rate limits. Settle it in the
  Supabase dashboard: Auth logs, count of 429s on `/user` during a repro.

**principal-client (minority on step 3 timing):** argued step 3 should be its own later release, to
keep the first iOS submission minimal. Not adopted: a second iOS round trip costs a week
(deployment.md), and F11 is a user-visible correctness bug on its own.

## Open questions for the product owner (Escalated, P63)

> **Question:** If I have blocked @sam, may "Liked by @sam and 4 others" appear on a post in my feed?
> **Position A** (principal-security): Showing it does not breach anything. Blocking is defined as
> cutting off contact, not hiding content (F8), and today's per-card fetch already shows it.
> **Position B** (principal-client): A blocker who sees the blocked person's name in bold on their
> home screen will read it as blocking having failed, which is a user-trust cost.
> **Precise point of divergence:** whether a liker's *name* counts as "content" (stays visible) or
> "contact" (gets filtered) under the 2026-08-08 blocking definition.
> **What would resolve it:** a product decision. Either way, the filter is one `NOT EXISTS` against
> `blocked_users` inside the `SECURITY INVOKER` RPC, and it can be added later without a client
> release.

## Verification

1. **Before/after on device** (release build, since dev mode distorts timing):
   - In-app Perf Monitor shows **JS fps and UI fps** during 5 fast flings down and back up.
     Whichever one drops tells you which thread is stalled.
   - Count requests: Supabase dashboard → Logs → Auth, `GET /user` per minute during the repro
     (expect about 2 per mounted card before, and 0 after step 1). Or use the Android Studio
     Network Inspector.
   - React DevTools Profiler: commits per `PostCard` during the fling, before and after.
   - `adb shell dumpsys gfxinfo com.livil` (janky frames) and Android Studio Memory Profiler
     (bitmap heap) for step 5.
   - The same repro on an iPhone, to settle the iOS question.
2. **Regression tests (P31)**: one that remounts a `PostCard` after a like and asserts the liked
   state survives (F11), and one asserting `LikedByLine` makes **zero** `listPostLikers` calls when
   `latest_likers` is provided, and one when it is absent.
3. **Migration**: `fetch_home_feed` still returns the same rows and order for a fixed seed. The
   function is still `prosecdef = false`. `EXPLAIN ANALYZE` shows the new index in use.

## Revisit when

- Step 0 shows the scroll stall persists after steps 1–3. Then reopen with F14 (PlaybackContext
  split, routed to principal-playback) and steps 4–5 as the lead suspects.
- A third mutable per-post field needs cross-screen agreement. Then reconsider the normalised
  cache.
- `fetch_home_feed` p95 regresses beyond its current baseline after step 2.

## Documentation defects found during this review

- `kb/security/model.md` § "There is no block or mute capability" is **stale**. Blocking shipped
  in `20260808100000_blocked_users.sql`.
- `kb/standards/performance-budgets.md` gives the frame budget as 16.7 ms (60 fps). On 120 Hz
  devices it is **8.3 ms**.
- The proposal WIP cap is exceeded (10 open unratified, cap 8), so **no proposal was written** for
  this ADR. It becomes a proposal once the backlog drops below the cap, or the owner may ratify
  this ADR directly into an Epic.
