# spotify

Spotify search and track metadata for Spotify reposts (ADR-0027). The app never talks to
api.spotify.com directly — the client secret lives here.

| Action | Body | Returns |
|---|---|---|
| `status` | — | `{ search }` — whether search is configured |
| `search` | `{ q, limit? }` | `{ enabled, tracks: SpotifyTrack[] }` (≤ 10) |
| `tracks` | `{ ids: string[] }` (≤ 20) | `{ tracks: { [id]: SpotifyTrack \| null } }` |
| `resolve` | `{ url }` | `{ id \| null }` — pasted link, incl. `spotify.link` short links |

Signed-in Livil users only (the access token is checked against GoTrue). No database
credential; nothing is written to the Livil database.

## Caching

Spotify allows only temporary caching, so every entry expires: six hours for full metadata,
five minutes for the oEmbed stand-in (no artist). Each isolate keeps its own copy, and — when
the Upstash secrets are set — all isolates share one Redis cache:

- `tracks` reads every miss in ONE `MGET` (plus the shared back-off key), fetches what is
  still missing from Spotify at most 4 at a time, then writes the answers in one pipeline.
- `search` NEVER touches Redis — no read, no write, not even for the same words again
  (owner, 2026-10-21). Each isolate keeps its own answers in memory for six hours (five
  minutes when nothing matched), under an HMAC of the folded text — never the words typed.
- A 429 on a card lookup writes `livil:spotify:v1:blocked-until`, so every isolate stops
  calling the Web API for Spotify's `Retry-After`, not just the one that was told. A 429 on
  a search backs off that isolate only.

Redis unset, failing or slower than 500 ms → the function behaves exactly as without it.

## Secrets

| Name | Effect |
|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | From the Spotify developer dashboard. Without them: no search, and card metadata falls back to oEmbed (title + artwork, no artist). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | The shared cache (Upstash Redis, Mumbai, REST API — the read-write token). Optional: without them each isolate caches alone. |

The on/off switch for Spotify reposts is **not** a secret here — it lives in the database
(`app_switches`, key `spotify_reposts`), where it also refuses the insert. See ADR-0027.

## Deploy

```bash
supabase functions deploy spotify --project-ref fqzrmqnlgjeuxzinbqvs
```

## Test

```bash
deno test --no-config supabase/functions/spotify/index.test.ts
```
