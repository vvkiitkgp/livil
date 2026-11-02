# chat-media

The link to a disappearing chat photo or video (20 minutes), and the sweep that deletes it (PROP-0011,
`kb/debt/proposals/0011-disappearing-media-in-chat.md`). The file sits in the **private**
`chat-media` bucket (`20261118000000_chat_media.sql`): clients may upload into their chat's
folder but never read it. This function is the only way to the bytes.

| Action | Caller | Body | Returns |
|---|---|---|---|
| `status` | signed-in user | — | `{ enabled }` — whether the app offers sending |
| `link` | signed-in member of the chat | `{ message_id }` | `{ url, expires_at, now }` — a signed URL valid for the time left (`now` = server time, for the app's countdown); `404` not visible, `410` expired/deleted, `400` no media |
| `sweep` | anyone (pg_cron, with the anon key) | — | `{ deleted }` — removes every object older than 20 minutes |

- **Membership** is decided by reading the message *as the caller*, so the `messages` RLS
  is the authority, not a copy of it.
- **The window** is `messages.created_at + 20 min`, server-stamped. The signed URL's lifetime
  is the time left (floored), so no link outlives it even before the sweep runs.
- **The object** must sit in the message's own conversation folder; otherwise a sender could
  point a message at another chat's file.
- **The sweep** can only delete files already past their 20 minutes, so it needs no user. It
  runs at most every 20 s per isolate; pg_cron calls it each minute only when something has
  expired (`chat_media_sweep_dispatch()`).

## Secrets

| Name | Effect |
|---|---|
| `CHAT_MEDIA_ENABLED` | `true` turns the camera button on in the app. Unset → `status` says `enabled: false` and the app hides it. Links and the sweep work either way. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

## Deploy

Apply `20261118000000_chat_media.sql` first (bucket, policies, sweep schedule), then:

```bash
supabase functions deploy chat-media --project-ref fqzrmqnlgjeuxzinbqvs
```

## Test

```bash
deno test --no-config supabase/functions/chat-media/index.test.ts
```
