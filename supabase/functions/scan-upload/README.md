# scan-upload — deploy & review checklist

**Status: PROPOSAL — not deployed.** The client half calls it through
`shared/services/copyrightScan.ts`; that call is fail-safe, so until this is deployed
every upload records a `failed` scan and publishes normally. Nothing breaks while this
is absent — but nothing is checked either, and the `failed` rows are the evidence of
that rather than a silence.

## Why this can't be an agent-autonomous change

- `supabase/functions/**` is in **no** list in `.claude/autonomy-config.yml` — not
  writable, not propose-only. `scripts/enforce-agent-scope.mjs` will fail this PR for
  every file in this directory. **That is the gate working, not a mistake**, and it is
  the same position `send-push` is in.
- Holding the provider credential and deploying to production are human
  responsibilities.

> Structure mirrors `send-push`: `index.ts` is a thin entrypoint (`Deno.serve(handler)`),
> all logic and the security model live in `app.ts`, and `index.test.ts` imports the pure
> helpers from `app.ts`.

## What the security review must confirm

1. **Auth** — the actor is derived from the JWT, never the body; anon is rejected (401).
2. **Authorization** — the track is read *as the caller*, and `uploader_id` is then
   compared to the actor explicitly. The explicit check is load-bearing:
   `tracks_select_authenticated` lets any signed-in user read any track, so the read
   authenticates without authorizing. Do not delete it on the grounds that RLS "already
   handled it" — that is the exact error ADR-0008 records the board making.
3. **The privileged write, and the ADR-0008 §4 tension.** This function reads
   `SUPABASE_SERVICE_ROLE_KEY` to write the verdict, because a verdict any client could
   write is not evidence. ADR-0008 §4 says nothing may hold that key; `send-push/app.ts`
   already does. **This migration does not resolve that contradiction and must not be
   read as ratifying it.** Rule on it explicitly.
4. **No media bytes ever transit this function.** It sends the provider a URL. The
   provider fetches. This is what keeps ADR-0003's out-of-memory failure mode — which is
   about the *device* — irrelevant here, and it is also why video needs no conversion.
5. **`status` vs `match_found` must stay separate.** A failed or skipped scan writes
   `match_found = null`. If these ever collapse, a provider outage silently issues a
   clean bill of health to every upload made during it. The unit tests pin this; do not
   relax them.
6. **CORS preflight is answered.** The web dashboard calls this from a browser. An
   unanswered `OPTIONS` means the POST is never sent — a failure this project has
   already paid for once (`20260914` / PR #216).
7. **Spend is capped, but only here.** `SCANS_PER_USER_PER_DAY` (50) is checked BEFORE
   the billable call, and a failed count returns 503 rather than becoming a free pass.
   That is the only bound: there is still no per-user upload quota anywhere in Livil and
   no rate limit in front of this function. Note the enterprise path bills per unit of
   AUDIO DURATION, not per request, so one long file is one request and a large bill —
   keep `AUDD_ENTERPRISE_ENABLED` unset until you are comfortable with that.
8. **The uploader chooses what gets scanned — check both defences are present.** A
   security review killed the first draft over this: `tracks_update_own` constrains which
   rows, never which columns, so an uploader could scan a harmless file and then swap in
   a commercial rip. Two things now stop it, and BOTH must survive review:
   `trg_tracks_freeze_media` (migration §0) makes a track's media immutable once real,
   and `isOwnPublicMedia()` refuses any URL outside the caller's own folder of
   `tracks-media` — which also stops the provider being pointed at arbitrary URLs on
   Livil's bill. `scanned_media_url` records what was actually examined, because a
   verdict that cannot be tied to a file is not evidence.

## Deploy (human)

```bash
# 1. Create an AudD account (https://dashboard.audd.io/signup) and set the secret:
supabase secrets set AUDD_API_TOKEN=...
# Optional — only once the vendor has CONFIRMED the enterprise endpoint accepts a video
# container and extracts the audio itself. Until then, leave unset: video records
# `skipped`, which is the honest answer.
supabase secrets set AUDD_ENTERPRISE_ENABLED=true

# 2. Deploy:
supabase functions deploy scan-upload --project-ref fqzrmqnlgjeuxzinbqvs

# 3. Verify auth is enforced (must be 401, NOT 200):
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$SUPABASE_URL/functions/v1/scan-upload" -d '{"trackId":"11111111-2222-3333-4444-555555555555"}'
```

## Before deploying, confirm with the vendor

The public documentation does **not** state whether the API accepts a URL to an MP4/MOV
and extracts the audio server-side. AudD's docs list "short-form videos" among supported
content for the enterprise endpoint but never say it outright. **Ask
`api@audd.io` directly**, and only then set `AUDD_ENTERPRISE_ENABLED`. Guessing here
would produce `complete` rows for requests that never really examined the audio.

## Regression guard

`scripts/check-edge-functions.mjs` matches deployed functions **by slug only, never by
content** — so a broken or stale deploy of this function is indistinguishable from a
working one. That matters more here than anywhere else, **because this function's
failure mode is reporting "clear" when it never ran**. Pin the Management API's per-slug
`version` integer (the script already fetches it) and assert equality before relying on
this in any decision.
