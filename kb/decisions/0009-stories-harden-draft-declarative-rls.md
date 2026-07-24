---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0008]
---

# ADR-0009 — Harden the existing Stories draft in place; keep story-creation authorization declarative

| | |
|---|---|
| **Status** | **Accepted** — the security hardening and the architectural rejections below. The **ship / kill / harden** decision and the **moderation (report + block) gate** are **Escalated** to the human (P63). |
| **Date** | 2026-07-24 |
| **Domain** | data / security (with client, playback) |
| **Decided by** | board debate — chief-architect (moderator), principal-data, principal-security, principal-client, principal-playback, adversarial-critic. principal-realtime not routed (see Context). Proposal: PROP-0004. |

---

## Context

The human asked the org to "work on a Stories feature." Triage found the feature is **not greenfield — it already exists and is wired end to end**, and appears never to have been through the board:

- **Database** — `supabase/migrations/20260530000001_repost_and_stories.sql` creates `stories` and `story_views`, their RLS, and `list_active_stories()`. Dated 2026-05-30.
- **Service** — `src/services/stories.ts` (`listActiveStories`, `createStory`, `markStorySeen`).
- **UI** — `src/screens/main/StoryViewerScreen.tsx` (full-screen viewer), `src/contexts/StoriesContext.tsx`, the story ring on `src/screens/main/HomeScreen.tsx` (~L170–220, load at ~L590–640), and the composer path in `src/screens/main/RepostScreen.tsx` (`createStory`, L233).
- **Wiring** — `StoriesProvider` wraps the app (`src/navigation/RootNavigator.tsx:422`), the `StoryViewer` route is registered (`:454`), and `PlaybackContext`/`FloatingPlayer` already coordinate via `isStoryViewerOpen`.

So the honest question was not "how should we build Stories" but **"is the already-built Stories implementation safe to ship as-is, and if not, what is the minimum change across data lifecycle, authorization, and query bounding."** The behaviour the code already encodes — 24 h expiry, clip ≤ 10 s, visible to self + accepted friends + star-followers, repost-of-upload only, no push, no viewer list, no moderation — are **product decisions the human has never ratified** (`kb/product/*` are unwritten, INDEX ✍️), and the board may not invent them (P63).

**Why principal-realtime was not routed.** The only realtime hook is "push followers on a new story." That is a distinct, product-gated decision, and under ADR-0008 a push must derive its recipient server-side from a legitimate row — it would need a new story-emission path, not a change to this feature. It is out of scope here and left for a future decision. Presence overlap is negligible. Routing it would have put the debate at five principals — over the charter's ceiling of four — for a question that isn't this one.

**Facts established during the debate (verified against the migrations):**

1. **`stories_insert` is `with check (author_id = auth.uid())` only** (`20260530000001:71`). It does not constrain `expires_at`, `track_id`, or `original_post_id`. The `expires_at` DEFAULT (`:33`) fires only when the column is *omitted*; a raw PostgREST client may send `expires_at: '2099-01-01'`. Since `stories_select` gates visibility on `expires_at > now()` (`:49`), that yields a **permanently visible story**. The linkage and `kind = 'upload'` checks in `createStory()` (`stories.ts:105-121`) are **client-side only** and bypassed by hitting PostgREST directly. This is the D-53 "client validation is not RLS" shape.
2. **`posts_select_authenticated` is `using (true)`** (`00000000000000_baseline_schema.sql:304-305`; also recorded ADR-0008:628). Every authenticated user can read every post today. This is the fact the DEFINER-vs-INVOKER fork turns on.
3. **The friendships-forgeability bug that `stories_select` depended on is already fixed** — `20260722000000_liv10_authorization_guards.sql:273-289` drops the bad write policies and pins inserts to `status='pending'`, with an apply-time drift check (`:806-822`). The friendship branch of `stories_select` is sound.
4. **`showNotificationControls` exists only in `GlobalAudioPlayer`** (verified by grep). `MediaPlayer` (the story viewer's player, and the app's normal per-card feed player) does not set it, and `StoryViewerScreen` pauses the engine on mount (`:80-81`). There is no second MediaSession.
5. **There is no reaper** — grep for `pg_cron` / `delete from public.stories` / scheduled expiry returns nothing. Expiry is enforced only at read time. **`pg_cron`/`pg_net` availability on this project is unverified** (ADR-0008:44,97 — zero references anywhere).
6. **`post_reports.post_id` references `posts.id`** (`20260607000007:10`). A story has no `posts` row of its own; its UGC is its `comment` (`20260530000001:29`) and clip window.

## Decision

**On the parts that are the board's to decide:**

1. **Harden story creation declaratively — do not add a `SECURITY DEFINER` `create_story` RPC.** The defect is real; the fix stays inside the caller's own privilege level:
   - A `BEFORE INSERT/UPDATE` trigger that **overwrites** `NEW.expires_at := now() + interval '24 hours'`, removing client control entirely. Preferred over a `CHECK (expires_at <= …)` because `now()` in a `CHECK` is a non-immutable footgun and a bound still lets the client pick any value inside the window.
   - Tighten `stories_insert`'s `WITH CHECK` with `exists (select 1 from public.posts where id = original_post_id and track_id = stories.track_id and kind = 'upload')`. Under `SECURITY INVOKER` this subquery is evaluated as the caller and inherits `posts`' RLS automatically.
   - The migration must `drop policy if exists "stories_insert"` first and carry the same abort-on-unrecognised-write-policy drift check as `20260722000000:806-822`, so a leftover permissive policy cannot OR the hole back open.
2. **Reject the `pg_cron` reaper.** Proposing a mechanism nobody has confirmed exists repeats ADR-0008's named failure. Expired rows are already invisible (filtered at read), rows are tiny, and the user base is closed-testing — this is premature (P23), not a P22 cliff. **Once `expires_at` is server-pinned (Decision 1), the only lever for unbounded visible growth is closed.** A physical-cleanup job is revisited only against a row-count projection showing the Micro instance under real pressure.
3. **Add a `LIMIT` to `list_active_stories()`.** Cheap, harmless, and the correct default (P22), even though the result set is already bounded by the social graph. Belt-and-suspenders, not a fix.
4. **The story viewer's second `<Video>` is not a single-engine violation.** No second `showNotificationControls`, engine paused on mount, and `MediaPlayer` is the app's existing per-card pattern. No playback change is required for the invariant. (Two low-severity *client* bugs in the viewer are recorded below and in PROP-0004, independent of this.)

**On the parts that are not the board's to decide (Escalated, P63):**

5. **Whether to ship, kill, or harden-then-hold Stories** is the human's call. The board's recommendation: **do not distribute Stories to production** until Decision 1 lands and the moderation gate (Decision 6) is resolved. Shipping ephemeral UGC to real users is far less reversible than the code (P4).
6. **Moderation is an app-wide production gate, not a Stories decision.** Google Play's UGC policy requires in-app content reporting *and* user blocking for production distribution of a social app (principal-security, marked INFERRED from policy knowledge, not cited from a KB file). Block/mute exists nowhere and was **already escalated to the human at ADR-0008:83** as a P63 call; this ADR does not re-litigate it. If Stories ship any report affordance, it must write to a **new `story_reports` table** (keyed `story_id → stories.id`, mirroring `post_reports`), never through `post_reports` — routing it to `original_post_id` would mis-attribute the report to the innocent original uploader.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **`SECURITY DEFINER create_story` RPC** (the Round 1 lean of both data and security) | Refuted in Round 2; both principals reversed. DEFINER's only legitimate power is to read past the caller's visibility — and there is nothing to read past, because `posts_select` is `using (true)` (fact 2). It would add a 5th privileged function to a codebase ADR-0008 already catalogued as carrying auth bugs in its four (P17), and it would **bypass** `posts`' RLS, forcing post-visibility to be re-derived by hand the moment that RLS is ever tightened — the exact authenticate-vs-authorize error of ADR-0008. INVOKER RLS + a trigger provides every capability needed here (single-row insert, no cross-user read, no atomic multi-table write). |
| **`WITH CHECK (expires_at <= now() + '24h' and expires_at > now())`** instead of a trigger | Weaker: still lets the client choose any value inside the window, and puts a non-immutable `now()` inside a `CHECK`. Overwriting the value in a trigger removes client control entirely. |
| **`pg_cron` reaper for expired rows** | Unverified mechanism (ADR-0008:44,97); premature at closed-testing scale (P23); and internally inconsistent with a client-settable `expires_at` — the critic's catch — which Decision 1 resolves at the source instead. |
| **Route story reports through `post_reports`** | `post_reports.post_id → posts.id`; a story has no post row. Reporting a story would key to `original_post_id`, mis-attributing it to the original uploader (fact 6). A story report needs its own target. |
| **Treat report/block as a Stories ship-gate** | Re-litigates a call the board already handed to the human (ADR-0008:83). It is an app-wide *production* UGC obligation, not a Stories-feature or closed-testing gate; principal-security withdrew the closed-testing framing as asserted-not-cited. |
| **Route story audio through the single GAP engine with a clip window** | Considered for invariant safety; unnecessary. The viewer does not create a second MediaSession and the engine is paused during viewing (fact 4). A rewrite would add risk to the patched engine for no invariant benefit (P25). |
| **Ship Stories as-is** | Rejected: fact 1 defeats the read perimeter today (a raw client can mint a permanent story), and the product/moderation posture is unratified. |

## Consequences

**What this settles:**
- The one genuine, ship-relevant security defect has a fix that adds **no privileged surface** — it lives entirely in declarative RLS + a trigger, which under ADR-0004's direct-to-Postgres model *is* the API contract.
- The board does not manufacture product intent. The ship decision and the moderation posture are named, framed, and handed to the human with a recommendation, per P47/P63.

**What it costs / does not settle:**
- **A permanent story is possible in production right now.** Until PROP-0004's migration is applied, `expires_at` is client-settable and the read perimeter is defeatable. This is the reason the feature must not reach production first.
- **The INVOKER linkage check is currently inheriting a no-op.** Because `posts_select` is `using (true)`, the "caller may see the original post" benefit is vacuous today; the subquery enforces existence + linkage + `kind='upload'`, not visibility. This is still the right shape — it starts enforcing visibility for free the day `posts` RLS is tightened — but whoever later tightens `posts`' SELECT policy must check this cross-table policy does not become a recursion/permission snag (a note-to-future, recorded here so it is not a surprise).
- **`stories_select` has a star-follower branch** (`20260530000001:60-65`): anyone who `follows … kind='star'` the author sees the story. That is not forgery (the viewer opts in), but whether authors intend stories visible to any star-follower is a **visibility-semantics product question** the human should confirm.
- **Two low-severity client bugs remain in the viewer** (recorded, not ship-gating): a dual-clock double-advance skip (`StoryViewerScreen.tsx:144` and `:155` both call `advance()`), and a top scrim that renders nothing (`backgroundColor:'transparent'` × `opacity:0.45`, `:331-341`).
- **No push, no viewer-list, no comment length limit** (post comments truncate at 280; `stories.comment` does not) — all left as product calls.

## Dissent

- **adversarial-critic — the meta-frame.** Argued the single most important thing the board was getting wrong: all four principals assumed *ship* and set about hardening a draft whose product intent the human never set, thereby making ship/product calls that are not the board's (P63). The synthesis adopts this — the ship decision and moderation gate are Escalated, not decided. The critic's residual position is that even a scoped hardening proposal risks being read as the board endorsing "ship it"; mitigated by making Decision 5 explicit.
- **principal-data and principal-security — recorded reversals.** Both entered Round 1 leaning toward a `SECURITY DEFINER create_story` RPC and, on cross-examination against the `posts_select = using(true)` fact, conceded fully that INVOKER RLS + an `expires_at` trigger is both sufficient and the smaller perimeter. Security tied its reversal to its own prior one at ADR-0008:93 ("I described the DEFINER layer as authorizing when it only authenticates"). Recorded because a reversal under evidence is the debate working, not a weakness.
- **principal-security — partial withdrawal on moderation.** Withdrew the Round 1 "report/block is a closed-testing ship-gate" framing as asserted-not-cited; re-anchored the real obligation as the app-wide production UGC gate already escalated at ADR-0008:83. Held that *if* a report affordance ships it must target a new `story_reports` table, and that the ship/gate question itself is the human's.
- **No principal dissented from the final synthesis.** The disagreement was resolved by evidence in Round 2, not carried (P62).

## Revisit when

- `posts_select` RLS is tightened from `using (true)` — at that point re-verify the `stories_insert` linkage subquery does not create a recursion/permission snag, and confirm it now enforces post-visibility as intended.
- A row-count projection at realistic DAU shows expired-story storage pressuring the Micro instance — then reconsider a physical reaper, gated on first running the `pg_available_extensions` query from ADR-0008:97.
- The human decides to ship Stories to production — then the app-wide report + block gate (ADR-0008:83) and the `story_reports` target become live work, and "push on new story" becomes a separate realtime decision under the ADR-0008 recipient-derivation model.
- A block/mute capability ships app-wide — it changes the moderation calculus for every UGC surface, Stories included.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
