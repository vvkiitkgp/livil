---
tier: 4
owner: chief-architect
consumers: [CA, TR, ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0009, 0008, 0004]
---

# PROP-0004 — Harden the existing Stories draft before any ship decision

| | |
|---|---|
| **Status** | **Draft — awaiting human ratification** |
| **Date** | 2026-07-24 |
| **Domain** | data / security (with client) |
| **Addresses** | ADR-0009, and the client-settable-`expires_at` defect it records |
| **Jira** | LIV-NN *(added on ratification)* |

---

## Problem

Stories is **already built and wired end to end** (migration `20260530000001_repost_and_stories.sql`, `src/services/stories.ts`, `StoryViewerScreen`, the `HomeScreen` ring, `RepostScreen` composer) but was never boarded. Reviewed under ADR-0009, it carries one genuine, ship-relevant authorization defect plus smaller items:

- **A permanent story is mintable today.** `stories_insert` is `with check (author_id = auth.uid())` only (`:71`). A raw PostgREST client can set `expires_at` to a far-future value (the DEFAULT at `:33` fires only when the column is omitted), and `stories_select` gates visibility on `expires_at > now()` (`:49`) — so the row stays visible forever. The client can also forge `track_id`/`original_post_id` with no linkage or `kind='upload'` check; `createStory()` validates those client-side only (`stories.ts:105-121`). This defeats the read perimeter and is the D-53 "client validation is not RLS" shape.
- **`list_active_stories()` has no `LIMIT`** — an unbounded list by default (P22), even though the social graph currently bounds it.
- **Two low-severity client bugs** in the viewer: a dual-clock double-advance that can *skip* a story (`StoryViewerScreen.tsx:144` and `:155` both call `advance()`), and a top scrim that renders nothing (`backgroundColor:'transparent'` × `opacity:0.45`, `:331-341`).

## Why now

The security defect is live: while the feature is only in closed testing, `expires_at` is client-settable in production data, and the fix is small and adds **no privileged surface**. Fixing it is also the precondition ADR-0009 places on any ship decision. It is cheap and it unblocks the human's call.

**This proposal deliberately does not include** the ship/kill decision, moderation (report + block), a reaper, or any playback change — see Scope boundaries and Open product questions. Bundling them would be "five decisions wearing one title" (the critic's finding; charter §Participant selection).

## Proposal

A single migration hardens creation declaratively (ADR-0009 Decision 1), plus a cheap `LIMIT` and two optional client fixes.

### 1. Pin `expires_at` server-side (migration)
`BEFORE INSERT OR UPDATE` trigger on `stories` whose function overwrites `NEW.expires_at := now() + interval '24 hours'` and returns `NEW`. Fires for every writer regardless of role; needs no privilege (touches only `NEW`). Removes client control entirely — stronger than a `CHECK` bound, and avoids a non-immutable `now()` inside a constraint.

### 2. Validate the repost linkage in RLS (migration)
`drop policy if exists "stories_insert"` then recreate with:
```
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.posts p
    where p.id = original_post_id
      and p.track_id = stories.track_id
      and p.kind = 'upload'
  )
)
```
`SECURITY INVOKER` (the default for policies) means the `posts` subquery is filtered by `posts`' own RLS for the caller — enforcing post-visibility for free if/when `posts_select` is ever tightened from its current `using (true)`. Carry the abort-on-unrecognised-write-policy drift check from `20260722000000:806-822` so a leftover permissive policy cannot re-open the hole.

### 3. Bound `list_active_stories()` (migration)
Add `LIMIT` (recommend 200 — well above any realistic ring, far below a runaway). `create or replace function` in a new migration; the RPC contract test (`supabase/tests/rls/rpc-contracts.test.sql:117`) already asserts it exists.

### 4. (Optional, client debt — not ship-gating) Fix the viewer bugs
- Guard `advance()` so only one clock drives it (drop the `handleProgress` clip-end call, or make `advance` idempotent per index).
- Replace the no-op top scrim with a real gradient using the house gradient component (`GradientBorder`/`GradientFill` family; do not hand-roll — design-system rule), or remove it.

## Implementation plan

Each step maps to a domain and to its autonomy scope (`.claude/autonomy-config.yml`). Ratification does not by itself grant an agent write access — an untested path stays human-implemented until it earns `writable` by bringing tests (the PROP-0003 rule).

| # | Step | Domain | Path | Scope | Who implements |
|---|---|---|---|---|---|
| 1 | `expires_at` pin trigger | data / security | `supabase/migrations/**` | **writable**, `requires_review: security-reviewer` (MANDATORY) | agent may write **with** an RLS test proving a client-supplied `expires_at` is overwritten |
| 2 | Tighten `stories_insert` linkage `WITH CHECK` + drift check | data / security | `supabase/migrations/**` | **writable**, security-reviewer MANDATORY | agent, with RLS tests (below) |
| 3 | `LIMIT` on `list_active_stories()` | data | `supabase/migrations/**` | **writable**, security-reviewer MANDATORY | agent, with an RPC-contract assertion |
| 4 | Remove now-redundant client validation in `createStory()` (server now authoritative); keep only UX-level guards | data | `src/services/stories.ts` | **propose_only** (21/22 services untested) | human — *or* this step pulls `stories.ts` toward `writable` by bringing its own unit tests, per PROP-0003's step-3 pattern |
| 5 | Viewer double-advance + scrim fixes | client | `src/screens/main/StoryViewerScreen.tsx` | **propose_only** (`src/screens/**`, zero tests) | human |

Steps 1–3 are the ratifiable core and are independently verifiable at the database layer. Steps 4–5 are debt cleanup and may be deferred or split off without weakening 1–3.

## Open product questions for the human (P63)

The feature already encodes these choices in code. Recommended default = keep the coded behaviour, **flagged provisional** — the board designs against it but does not ratify it.

| # | Question | Coded today | Recommended default | Note |
|---|---|---|---|---|
| A | **Ship, kill, or harden-then-hold Stories?** | fully wired, unshipped | **harden (this proposal), then hold** — do not distribute to production until B is resolved | The gating question. Shipping ephemeral UGC is hard to reverse (P4). |
| B | **Moderation posture** | none | **Blocked on the app-wide report + block gate already escalated (ADR-0008:83).** If a report affordance ships, it must target a **new `story_reports`** table, never `post_reports` | Google Play UGC policy requires report + block for *production* social apps (INFERRED, not cited). Not a Stories-only gate. |
| C | **Who sees a story** | self + accepted friends + **star-followers** | keep, but **confirm the star-follower branch is intended** | `20260530000001:60-65` — a story is visible to anyone who stars the author. Not a bug; a visibility choice. |
| D | **Expiry window** | 24 h | keep (now server-pinned by step 1) | — |
| E | **Push on a new story** | none | **defer** — separate decision under ADR-0008's server-side recipient model; needs a story-emission path | Realtime not routed for this reason. |
| F | **Viewer list to author ("seen by")** | author cannot see viewers (`story_views_select_self`) | leave out for v1 | Product call. |
| G | **What a story contains** | ≤10 s clip of an existing upload + optional text `comment` (no length cap) | keep; **consider a `comment` length cap** | post comments truncate at 280; `stories.comment` does not. |

## Scope boundaries

**Explicitly not included:**
- **The ship/kill decision** (question A) — the human's, per ADR-0009 Decision 5.
- **Moderation: `story_reports`, block/mute** — question B; block/mute is app-wide and already escalated (ADR-0008:83). If A + B say "ship," `story_reports` becomes its own small proposal.
- **A physical reaper / `pg_cron`** — rejected by ADR-0009 Decision 2 (premature P23; unverified mechanism). Step 1 closes the only unbounded-*visibility* lever; physical cleanup waits for a real row-count projection.
- **Any playback change** — the viewer's second `<Video>` is not a single-engine violation (ADR-0009 Decision 4). No touch to `GlobalAudioPlayer`, `PlaybackContext`, or the patch.
- **Push on new story** (question E) — separate realtime decision.
- **A viewer-list feature** (question F).

## Risk

- **Migration touches the perimeter.** A bad outcome is a permissive-duplicate `stories_insert` policy silently OR-ing the hole back open — the exact trap `20260722000000` guards. Mitigated by `drop policy if exists` first and the drift check; detected by the RLS tests below and mandatory security-reviewer sign-off.
- **The `expires_at` trigger must not break the real client.** `createStory()` omits `expires_at` (`stories.ts:119-126`), so overwriting it server-side is transparent. Verified by reading the service.
- **The linkage subquery is a cross-table RLS reference.** Fine while `posts_select` is `using (true)`; flagged in ADR-0009 as a note-to-future for whoever tightens `posts` RLS. Reversible — it is one policy definition.
- **Reversibility:** high. All of steps 1–3 are declarative migrations; step 1's trigger and step 2's policy can be dropped/replaced. Steps 4–5 are UI/service and independently revertible.

## Verification

- **Step 1:** an RLS test inserts a `stories` row with `expires_at = now() + interval '10 years'` as an ordinary authenticated user and asserts the stored value is `≈ now() + 24h`, not the supplied value. (This is the test that lets the migration path stay `writable`.)
- **Step 2:** RLS tests — (a) an insert whose `track_id` does **not** match `original_post_id`'s `track_id` is rejected; (b) an insert whose `original_post_id.kind <> 'upload'` is rejected; (c) a legitimate `createStory()` shape still succeeds. Run against the deployed policy (`supabase/tests/rls/`).
- **Step 3:** `rpc-contracts.test.sql` asserts `list_active_stories` exists and returns ≤ the `LIMIT`.
- **Step 4:** unit test with a mocked client — the service no longer relies on client-side linkage validation for safety (server is authoritative), and still surfaces a friendly error on a rejected insert.
- **Step 5:** by hand — a two-story sequence never skips the middle story at clip end; the top of the viewer shows a real gradient (or nothing), not a flat wash.
- **Not "it compiles."** The load-bearing assertions are the three RLS tests; a green build proves nothing about the perimeter (P8, P32).

## Alternatives

| Alternative | Why set aside |
|---|---|
| `SECURITY DEFINER create_story` RPC | ADR-0009 — adds a 5th privileged function and bypasses `posts`' RLS, buying no authorization power because `posts_select` is `using (true)`. Both owning principals reversed to the declarative fix. |
| `CHECK (expires_at <= now() + '24h')` instead of a trigger | Still lets the client pick a value in-window, and puts non-immutable `now()` in a constraint. |
| `pg_cron` reaper | ADR-0009 Decision 2 — premature and depends on an unverified extension (ADR-0008). |
| Route reports through `post_reports` | Mis-attributes to the original uploader; a story has no post row (ADR-0009 fact 6). |
| Ship as-is | Leaves a mintable permanent story and an unratified product/moderation posture. |

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
>
> **WIP cap: 8 unratified proposals.** Open after this: PROP-0001, PROP-0002, PROP-0004 (three).
