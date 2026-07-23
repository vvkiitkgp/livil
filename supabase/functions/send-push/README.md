# send-push — deploy & review checklist (LIV-9)

**Status: PROPOSAL — not yet deployed.** `list_edge_functions` returns `[]` in production,
which is why every push in Livil silently does nothing. This directory is the missing
server half; the client half (`device_tokens`, data-only FCM, notifee rendering) already
ships. This must be **security-reviewed and deployed by a human** — it is an outward-facing
prod change and its authorization model is the whole point of the review.

## Why it can't be an agent-autonomous change

- `supabase/functions/**` is not in the agent-writable scope (`.claude/autonomy-config.yml`),
  and `src/services/pushDispatch.ts` is `propose_only`. CI's `enforce-agent-scope.mjs` will
  flag this PR — that is the gate working, not a mistake.
- Deploying to prod and holding the FCM service-account secret are human responsibilities.

## What the security review must confirm (see the SECURITY MODEL header in `index.ts`)

1. **Auth**: actor is derived from the JWT, never the body; anon is rejected.
2. **Authorization** (`authorize()`): deny-by-default, one relationship gate per `kind`.
   Tighten the kinds marked `REVIEW` — `new_fan` is currently denied pending the stars
   schema, and the `activity_*` / `message` gates are weaker than ideal because the client
   args don't include the originating row id (this is the D-45 argument for server-side
   dispatch).
3. **Content**: `title`/`body` are clamped and only ever placed in the notification body.
4. **Rate limit**: `checkRateLimit` is in-memory and therefore advisory only — replace with
   a shared store before relying on it (D-12).
5. **Residual (D-45)**: this makes push work safely-enough; it does not make client-dispatched
   push unforgeable. The durable fix is moving dispatch into the SECURITY DEFINER functions
   that already authorize the event. Do not close D-45 on the back of this.

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
