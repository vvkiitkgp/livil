# gifs

GIF search and lookup for GIFs in comments (ADR-0031). The app never talks to GIPHY
directly: the key lives here, and so does the choice of provider.

| Action | Body | Returns |
|---|---|---|
| `status` | — | `{ enabled }` — whether a key is configured |
| `trending` | `{ offset? }` | `{ enabled, gifs: Gif[], next }` (≤ 18 per page) |
| `search` | `{ q, offset? }` (q ≤ 50 chars) | `{ enabled, gifs: Gif[], next }` |
| `lookup` | `{ ids: string[] }` (≤ 50) | `{ gifs: { [id]: Gif \| null } }` — only answered ids; `null` = removed or rated above PG-13 |

Signed-in Livil users only (the access token is checked against GoTrue). No database
credential; nothing is written. Every GIF returned, from every action, is rated G, PG or
PG-13, and every media URL is on GIPHY's own CDN, passed through exactly as GIPHY sent it.

## Secrets

| Name | Effect |
|---|---|
| `GIPHY_API_KEY` | From [developers.giphy.com](https://developers.giphy.com) (an **API** key, not SDK). Without it, `status` says `enabled: false` and the app hides the GIF button. |
| `GIFS_CALLS_PER_HOUR` | Optional. The app-wide hourly budget per isolate (default 90, under the beta key's 100). Raise it with a production key. Each user also has 30 calls an hour. |

A **beta** key allows 100 calls an hour for the whole app — enough to build and test, not
to launch. Production needs GIPHY's paid upgrade, or a switch of provider (ADR-0031).

## Deploy

```bash
supabase functions deploy gifs --project-ref fqzrmqnlgjeuxzinbqvs
```

Apply migration `20261030000000_comment_gifs.sql` **before** deploying: once the function
answers `enabled: true`, the app shows the GIF button and inserts the new columns.

## Test

```bash
deno test --no-config supabase/functions/gifs/index.test.ts
```
