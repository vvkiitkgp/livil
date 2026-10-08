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
credential; nothing is written.

## Secrets

| Name | Effect |
|---|---|
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | From the Spotify developer dashboard. Without them: no search, and card metadata falls back to oEmbed (title + artwork, no artist). |

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
