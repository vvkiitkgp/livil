---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-16
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0027]
---

# ADR-0031 — GIFs in comments: searched through our own edge function, stored by id only

| | |
|---|---|
| **Status** | **Accepted** — owner-directed 2026-10-16; built on `feat/comment-songs` (migration `20261030000000`, edge function `gifs`) |
| **Date** | 2026-10-16 |
| **Domain** | client + data (with security) |
| **Decided by** | owner, choosing GIFs over a Livil-made sticker pack (the sticker pack is a separate design exploration) |

---

## Context

After songs in comments (migration `20261029000000`), GIFs are the other thing people reach
for in a comment. Facts that shaped the design, as of 2026-10-16:

- **Tenor's API is gone.** Google shut it down on 30 June 2026. Every app that called it from
  the phone broke until its users updated. Livil has several app versions in production at
  once, and a store update takes a week or more (CLAUDE.md, *Production compatibility*).
- **GIPHY** is the remaining large provider. A **beta** key is free and capped at **100 calls
  an hour for the whole app**. A production key is a **paid upgrade**, priced by GIPHY after
  an application. Its terms require "Powered by GIPHY" wherever the API is used, and forbid
  storing, caching, proxying or rewriting its media URLs (query string included).
- **KLIPY** (founded by ex-Tenor staff; WhatsApp moved to it) is reported to offer a free API
  funded by optional ads. It has not been evaluated here.
- React Native's `Image` animates GIFs on iOS. On Android it shows only the first frame
  unless the build includes Fresco's `animated-gif` module (Fresco `3.6.0` with RN 0.85.3).
- A second `<Video>` is ruled out by the single-engine rule, so MP4 renditions are not an
  option even though GIPHY recommends them.

## Decision

1. **Search and lookup go through our edge function `gifs`**, never from the app to GIPHY.
   The key lives there. The app sees only an enumerated `Gif` shape (`id`, `provider`, `title`,
   `width`, `height`, `url`, `previewUrl`), so **a provider switch is a deploy, live for every
   installed app at once**.
2. **A comment stores the GIF's provider, id and size, never a media URL**
   (`post_comments.gif_provider / gif_id / gif_width / gif_height`). The app fetches fresh
   URLs by id, in one `lookup` per comment sheet (`prefetchGifs` as soon as the comments
   arrive), and holds them in memory for the app session only, as it does the first trending
   page for five minutes. The size reserves the GIF's box before the lookup answers.
3. **The content rating is enforced in the edge function, on the way out, for every action.**
   Only G, PG and PG-13 are returned; anything higher, or unrated, is dropped. This matters
   most for `lookup`: a comment row can be written straight through the API by any signed-in
   user, so the picker's filter is not the only way in. A refused id reads as "GIF
   unavailable" in the comment.
4. **Only media URLs on GIPHY's own CDN are returned**, exactly as GIPHY sent them, and the
   function never fetches a URL the caller supplied (same rule as `spotify`).
5. **Old apps** read only `body`, so the app writes the fixed label `🎞 GIF` as the body's last
   line. The new app strips exactly that line. The label must never change.
6. **One attachment per comment:** a song or a GIF, enforced by
   `post_comments_one_attachment` on insert and on the author's own update.
7. **Fail-safe client:** no GIF button until `status` answers `enabled: true`, nor once the
   backend has shown it has no GIF columns. A failed search says "GIFs aren't available
   right now", never "No GIFs". A failed lookup is not cached and leaves the comment's box
   empty ("could not ask"), distinct from "GIF unavailable" (removed or refused). A GIF
   comment against a backend without the GIF columns is refused with a message rather than
   posted as a bare `🎞 GIF`.
8. **Hourly budgets in the edge function**: 30 upstream calls per user per hour, and an
   app-wide 90 per hour (secret `GIFS_CALLS_PER_HOUR`, raised without a deploy when a
   production key arrives). A per-minute budget, as `spotify` has, would let one account
   spend the beta key's whole hour in minutes. Both are per isolate, so advisory; "More GIFs"
   stops at five pages.
9. **Android animation needs the `animated-gif` dependency in `android/app/build.gradle`.**
   That file is closed to agents (signing configuration), so the owner adds the line. Until
   a build has it, Android shows the first frame.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Call GIPHY from the app (or GIPHY's SDK) | The key ships in the binary, and a provider change becomes a store release. This is exactly what broke every Tenor-from-the-phone app on 30 June 2026. |
| Store the media URL in the comment | Against GIPHY's terms (no storing or caching media URLs). It would also let a client store any URL at all, which an id check cannot. |
| Build URLs from the id (`media.giphy.com/media/<id>/200w.gif`) | Saves the lookup call, but GIPHY's terms forbid rewriting URLs, and it skips the rating check at display time. |
| Cache lookups in the edge function | Would save quota, but GIPHY's terms forbid caching media URLs without its written approval. Revisit if approved. |
| MP4 renditions (smaller, GIPHY's recommendation) | Needs a `<Video>` per comment, which the single-engine rule forbids. |
| Animated WebP | Smaller, but needs two more Fresco modules on Android, and iOS support is less certain than GIF. Not worth the risk for the first version. |
| A Livil-made sticker pack instead | No third-party risk and on-brand, but no search. Being explored separately; it can join later as another attachment kind. |

## Consequences

- **Quota is the binding constraint.** On a beta key, every picker open (trending), every
  debounced search, every "More GIFs" and every comment sheet containing a GIF spends one of
  100 calls an hour, shared by everyone. That is enough for testing, **not for launch**.
  Launch needs GIPHY's paid production key or a different provider. The `gif_provider`
  column and the provider-neutral `Gif` shape keep a switch to a backend change. Existing
  GIPHY comments stay GIPHY-routed.
- A 429 from GIPHY trips a circuit breaker (Retry-After, else 60 s). While it is open,
  search says "not available" and comments show the reserved box, empty.
- The budgets do not hold across isolates. A durable cap would be a ledger table (the
  `copyright_scan_attempts` pattern), which would give this function a database credential
  it deliberately lacks. Worth it only with a production key.
- **Open question (security review, 2026-10-16):** `lookup` will return any GIPHY id, not
  just ones from search. If GIPHY rates a freshly uploaded, unreviewed GIF G or PG, an
  attacker could upload their own GIF and write its id into a comment. Settle by uploading
  a test GIF and calling `/v1/gifs?ids=<id>` with Livil's key at once.
- Authors can swap or remove the GIF on their own comment through the API
  (`post_comments_update_self` allows any column). This is not new — `body` has the same
  property — and the swapped-in GIF still passes the rating filter. No client edits
  comments.
- The privacy policy names GIPHY: viewers' devices load GIFs from GIPHY's CDN, so GIPHY
  sees their IP address.
- No GIPHY pingback analytics are sent. GIPHY "highly recommends" them but does not require
  them; a production-key review may ask for them.
- The attribution is text ("Powered by GIPHY"), not GIPHY's logo artwork. A production-key
  review may require the official mark.
- Moderation is unchanged: a GIF comment is reportable like any other comment. A report shows
  ops the body (`🎞 GIF`), not the GIF itself. That is a gap in the ops view.

## Dissent

*None recorded.*

## Revisit when

- GIPHY quotes a production price, or KLIPY's terms are evaluated: choose the launch provider.
- GIPHY approves media caching for Livil: add a short-lived lookup cache in the edge function.
- The sticker-pack exploration is accepted: add it as a third attachment kind (same
  one-attachment rule, same label-line pattern).
- Ops needs to see reported GIFs: render `gif_id` through `lookup` in the ops view.
