# send-push — deploy & review checklist (LIV-9)

**Status: deployed** (the `edge-function-parity` CI job asserts it exists in production).
This directory is the server half; the client half (`device_tokens`, data-only FCM,
notifee rendering) ships in the app. Every change here must be **security-reviewed and
deployed by a human** — it is an outward-facing prod change, it takes effect for every
installed app version at once, and its authorization model is the whole point of the
review.

## Why it can't be an agent-autonomous change

- `supabase/functions/**` is not in the agent-writable scope (`.claude/autonomy-config.yml`),
  and `src/services/pushDispatch.ts` is `propose_only`. CI's `enforce-agent-scope.mjs` will
  flag this PR — that is the gate working, not a mistake.
- Deploying to prod and holding the FCM service-account secret are human responsibilities.

> Structure: `index.ts` is a thin entrypoint (`Deno.serve(handler)`); all logic + the
> SECURITY MODEL header live in `app.ts`; `index.test.ts` imports from `app.ts`.

## What the security review must confirm (see the SECURITY MODEL header in `app.ts`)

1. **Auth**: actor is derived from the JWT, never the body; anon is rejected.
2. **Authorization** (`authorize()` → a `Grant` or `null`): deny-by-default, one gate per
   `kind`, all against verified schema. Where an event leaves a row behind, the gate finds
   THAT row; a relationship alone is not enough.
   - `message` / `reaction` → both people are members of **the conversation named in
     `params.conversationId`** (every shipped build sends it). `jam_invite_dm` additionally
     needs `params.jamRoomId` to be a jam room of that conversation.
   - `friend_accepted` / `jam_*` → an accepted (mutual) friendship exists.
   - `new_follower` / `new_fan` → a one-way star edge `actor → recipient` exists.
   - `activity_like` / `activity_comment` / `activity_repost` → the `activity_notifications`
     row `activity_notify_post` wrote in the last 10 minutes for this recipient and actor
     (that RPC already proved the like/comment/repost is real; a like matched only through
     `payload.notified` must also still stand in `post_likes`). Replaces the old coarse
     "recipient has ever posted" gate (accepted for launch 2026-07-23, closed 2026-10-08).
   - `activity_milestone` → a recent `play_milestone` row for the recipient's post AND the
     actor's own `post_views` row within 1 s of it — the play that crossed the threshold
     (the RPC writes both in one transaction). (Previously only self-targeted milestones
     passed, which the RPC never produces — no milestone push had ever been delivered.)
   - `friend_request` → a **pending** request from actor → recipient must exist.
   - `badge_granted` → actor is in `ops_users` and the recipient holds a live badge.
   - Self-targeting is refused for every kind except `badge_granted`.
3. **Blocks**: any person-to-person kind is dropped when either side has blocked the
   other (`blocked_users`, both directions, fails closed) — **except pushes posted into a
   group conversation**, matching the database's rule that a block bars the DM but never
   a group (`dm_blocked_for_sender`). The caller gets the same `{ ok: true }` as a
   delivered push — every 200 is identical, including an FCM auth failure, so the response
   body never reveals a block, a muted category, or whether the recipient has a phone.
   (Response TIME still differs: only a real send pays for the FCM round-trip.)
4. **Content is server-derived** (`buildPush`): caller `title` is ignored for every kind;
   caller `body` is read only as a chat `message` preview (titled with the sender's name or
   the group's, prefixed with the sender's handle in a group) and for a `reaction`'s emoji
   (validated, never copied). `data.params` are claims to verify, never keys to copy; the
   tap `route` is allowlisted per kind (`KIND_ROUTES`) and its params come only from the
   Grant.
   - **Song names** (like / comment / repost): after authorization, `describePost` reads the
     activity row's post — its track's title, or for a Spotify repost its 22-char id — and
     the copy names it (title "Riya", body "liked your repost of “Blinding Lights”" — the
     person is the title for like / comment / repost, so a collapsed Android card, which
     shows the title and one body line, still shows the song). A Spotify title is
     asked of the project's own `spotify` function **on the caller's session** (no Spotify
     credential here; that function's budget and breaker apply), bounded by
     `SPOTIFY_LOOKUP_MS`, and never stored (ADR-0027). Any failure keeps the old wording,
     "your post".
   - **Photo** (like / comment / repost only): `actorAvatarUrl` is set from the actor's
     `profiles.avatar_url` **only when `isAllowedAvatarUrl` accepts it** — this project's
     public `avatars` bucket or `lh3.googleusercontent.com`. Android fetches it unprompted,
     so an arbitrary URL would turn every push into a request to a server the actor chose.
     iOS ignores it (an image would need a Notification Service Extension).
5. **Token pruning**: only on FCM `UNREGISTERED`, `SENDER_ID_MISMATCH`, or an
   `INVALID_ARGUMENT` about `message.token` (`shouldPruneToken`). A malformed payload, an
   APNs credential error, quota or a 5xx never deletes a device token. **Before rotating
   the `FCM_*` secrets, check `FCM_PROJECT_ID`**: pointed at another Firebase project,
   every token reads as `SENDER_ID_MISMATCH` and is deleted on that user's next push
   (recoverable — the app re-registers on launch — but dormant users go dark).
6. **Rate limit**: `checkRateLimit` is in-memory and therefore advisory only — replace with
   a shared store before relying on it (D-12).
7. **Residual (D-45)**: a conversation member can still push a `message` preview that was
   never actually sent, to people already in that conversation with them, attributed to
   themselves. Do not close D-45 on the back of this.
8. **Residual (repeats)**: inside the 10-minute window the same evidence can be presented
   again, so one real like/comment/milestone can be re-announced — always with
   server-written, true text naming the real actor — up to the advisory rate limit. A
   durable once-per-event guard needs state (D-12's shared store).

## Deploy (human)

```bash
# 1. Create a Firebase service account (Project settings → Service accounts) and set secrets:
supabase secrets set FCM_PROJECT_ID=... FCM_CLIENT_EMAIL=... FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
# 2. Deploy:
supabase functions deploy send-push --project-ref fqzrmqnlgjeuxzinbqvs
# 3. Verify auth is enforced (should be 401, NOT 200):
curl -s -X POST "$SUPABASE_URL/functions/v1/send-push" -d '{"recipientUserId":"...","kind":"message"}'
```

## Smoke check so this can't silently regress (proposed)

Push broke for months because nothing noticed the function was absent. Add a check to the
existing **schema-parity** CI job (it already authenticates to prod): assert
`list_edge_functions` contains `send-push`, and fail if not. Track alongside the schema-parity
gate rather than as a one-off script needing its own secret. Wiring left to the human who
holds the management-API token.
