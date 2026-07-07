# LiViL — Content Backlog

> **The source of truth for all LiViL public content.**
> A living inventory of every story worth telling, grounded in this repository. When a new
> Instagram post is requested, **consult this file first** — pick the highest-priority `Ready`
> item, don't rediscover stories from scratch.

**Version 1.0** · Companion to [`CREATIVE_DIRECTOR.md`](./CREATIVE_DIRECTOR.md),
[`CONTENT_PILLARS.md`](./CONTENT_PILLARS.md), [`FEATURE_STORYTELLING.md`](./FEATURE_STORYTELLING.md),
[`POST_FRAMEWORKS.md`](./POST_FRAMEWORKS.md), [`CAROUSEL_TECHNIQUES.md`](./CAROUSEL_TECHNIQUES.md),
[`INSTAGRAM_STYLE.md`](./INSTAGRAM_STYLE.md), [`BRAND_GUIDE.md`](./BRAND_GUIDE.md)

---

## How to use this document

1. **Requesting a post?** Scan the [Master Priority Queue](#master-priority-queue). Take the top
   `Ready` item whose pillar keeps the [content mix](./CONTENT_PILLARS.md#content-mix) balanced
   (don't ship three Engineering posts in a row).
2. **Read the item's row**, then build with the referenced framework + carousel technique.
3. **If Status = `Needs Assets`**, the story is approved but screenshots/graphics are missing —
   the item lists exactly what to capture. Capture, flip to `Ready`, then build.
4. **After publishing**, set Status = `Published`, add the date + link in the
   [Changelog](#changelog), and log any follow-up spin-off stories.

## Maintenance protocol (this file is alive)

- **On every new feature / PR / bug fix**, add or update the relevant item here in the same pass —
  grounded in the actual diff, never aspirational.
- **Never invent.** Every item cites a PR, file, migration, or `.ai`/memory doc. If it isn't in the
  repo, it isn't in the backlog.
- **Re-prioritize** when the mix drifts or a feature matures (e.g. Jam Rooms once real sessions exist).
- **Retire** items to `Published` — never delete; the history is the build-in-public record.

## Legends

**Pillars** (from [`CONTENT_PILLARS.md`](./CONTENT_PILLARS.md)): `Product` 35% · `Engineering` 20% ·
`Design` 15% · `Founder` 10% · `Music` 10% · `Community` 5% · `Experiments` 5%.

**Priority:** ★★★★★ brand-defining, visual, teachable, unique → ★ filler, only if the calendar needs it.

**Difficulty:** how much work to produce — `Easy` (copy + 1 screenshot) · `Medium` (carousel + several
captures) · `Hard` (diagrams, code cards, or assets that don't exist yet).

**Status:** `Idea` (not yet greenlit) · `Ready` (approved, assets exist) · `Needs Assets` (approved,
capture required) · `Published`.

**Formats & techniques** reference [`POST_FRAMEWORKS.md`](./POST_FRAMEWORKS.md) and
[`CAROUSEL_TECHNIQUES.md`](./CAROUSEL_TECHNIQUES.md).

---

## Master Priority Queue

The current recommended running order. Balances impact with pillar rotation.

| # | Item | Pillar | Priority | Status |
|---|---|---|---|---|
| 1 | [The waveform that listens](#11-the-waveform-that-listens) | Engineering / Music | ★★★★★ | Needs Assets |
| 2 | [The full-screen player](#41-the-full-screen-player) | Design | ★★★★★ | Needs Assets |
| 3 | [One engine plays everything](#21-one-engine-plays-every-song) | Engineering | ★★★★★ | Needs Assets |
| 4 | [Music is better together (Jam Rooms)](#31-jam-rooms--listen-together) | Product / Music | ★★★★★ | Needs Assets |
| 5 | [The clip is the song](#22-the-clip-is-the-song) | Engineering / Product | ★★★★★ | Needs Assets |
| 6 | [The app died with no logs (OOM bug)](#12-the-app-that-died-with-no-logs) | Engineering | ★★★★ | Ready |
| 7 | [Building this alone](#81-building-this-alone) | Founder | ★★★★ | Ready |
| 8 | [The keyboard that wouldn't stay](#71-the-keyboard-that-wouldnt-stay) | Engineering | ★★★★ | Ready |
| 9 | [Discovery through people, not algorithms](#91-discovery-through-people) | Music / Product | ★★★★ | Ready |
| 10 | [Emoji cover art](#43-emoji-cover-art) | Design | ★★★★ | Needs Assets |

> Rotate pillars: after an Engineering post, prefer a Design / Music / Founder item next.

---

# Group 1 — Playback & The Single Engine
*The crown jewels. LiViL's hardest, most differentiated engineering. Source: PRs #41, #43, #44, #45,
#47, #55, `patches/react-native-video+6.19.2.patch`, `CLAUDE.md` Playback section.*

### 1.1 The waveform that listens
- **Summary:** The floating player's wave isn't decorative — it rides the song's real loudness, punches on every kick, and scrolls faster when the vocal climbs.
- **Pillar:** Engineering (primary) + Music
- **Angle:** The detail nobody asked for — a small musical touch that was genuinely hard and honestly limited.
- **Format:** Engineering Deep Dive carousel, 6 slides
- **Carousel technique:** Progressive Reveal + one traveling purple glow (Continuous Canvas)
- **Required screenshots:** Floating mini-player pill on an audio track, three states — mid-kick (hero), resting swell, paused/flat. Close-up / naked-screenshot treatment (the wave is ~30px tall).
- **Required assets:** Code card from `src/services/waveform.ts` (6 lines, one highlighted); a "ruled-out paths" diagram card (server decode ✗ / live audio tap ✗ / on-device ✓).
- **Difficulty:** Hard (code card + diagram)
- **Priority:** ★★★★★
- **Status:** Needs Assets *(full creative direction already written — see session)*
- **Related features:** `WaveVisualizer.tsx`, `waveform.ts`, `tracks.waveform_peaks`, single engine
- **Why someone would care:** Most apps fake this. Ours does real on-device FFT without touching the playback engine — engineers respect it, musicians feel it.

### 1.2 The app that died with no logs
- **Summary:** Decoding a video's audio for the waveform pulled the whole file into memory → `OutOfMemoryError` → the OS killed the process with no JS log and the debugger just dropped.
- **Pillar:** Engineering
- **Angle:** Bug story / shared 2am debugging pain — the scariest bug is the one that leaves no trace.
- **Format:** Bug Story carousel, 5 slides
- **Carousel technique:** Progressive Reveal (symptom → hunt → reveal → fix → lesson); error-tint on slide 1 resolving to purple by the fix
- **Required screenshots:** Optional — a log/logcat snippet showing signal 9; the audio-only gate code line.
- **Required assets:** Simple "mp3 = few MB vs video = hundreds of MB → OOM" diagram card.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Ready (story fully documented in `CLAUDE.md` + memory; no hero screenshot needed)
- **Related features:** [1.1](#11-the-waveform-that-listens), `waveform.ts` audio-only gate
- **Why someone would care:** Every RN engineer has hit a silent native crash. The "whole file into memory via `ResponseBody.bytes()`" root cause is a genuinely useful lesson.

### 1.3 The lock screen is native on purpose
- **Summary:** Fabric defers view commands while the app is backgrounded, so auto-advance and clip-end had to be driven from native Kotlin, not JS.
- **Pillar:** Engineering
- **Angle:** Technical achievement — the constraint (New Architecture defers `seek()` in the background) forced an elegant native solution.
- **Format:** Technical Achievement carousel, 4–5 slides
- **Carousel technique:** Progressive Reveal (multi-slide architecture diagram)
- **Required screenshots:** A real lock-screen media notification (playing state, art + controls).
- **Required assets:** Architecture diagram — JS queue ↔ native `VideoPlaybackService.kt` watcher/`naturalEndListener`; `mediaQueueJson` + `nativeSkip` seam.
- **Difficulty:** Hard (diagram + accurate native explanation)
- **Priority:** ★★★★
- **Status:** Needs Assets
- **Related features:** [2.1](#21-one-engine-plays-every-song), [2.2](#22-the-clip-is-the-song), the RNV patch
- **Why someone would care:** "Why is the lock screen so hard on React Native New Arch?" is a real, under-documented question. This answers it with substance.

---

# Group 2 — Playback Architecture Decisions
*The thinking behind the engine. Source: PRs #28, #29, #41, #44, #45, `CLAUDE.md` Do-not-break table.*

### 2.1 One engine plays every song
- **Summary:** A single `<Video>` owns the audio of every post — audio and video alike — and is the sole lock-screen owner, so the OS never shows a duplicate "carousel" notification.
- **Pillar:** Engineering
- **Angle:** Product decision — why one engine beat the obvious two-engine design (audio player + video player).
- **Format:** Engineering Deep Dive / Product Decision carousel, 5–6 slides
- **Carousel technique:** Progressive Reveal + Layered Devices (a phone crossing the seam)
- **Required screenshots:** Feed (`HomeScreen`) with a post playing; the single lock-screen notification.
- **Required assets:** Before/after diagram — two MediaSessions (carousel bug) vs one; the `audioUrl ?? videoUrl` source rule.
- **Difficulty:** Hard
- **Priority:** ★★★★★
- **Status:** Needs Assets
- **Related features:** `GlobalAudioPlayer.tsx`, `FullScreenPlayer.tsx`, `PlaybackContext.tsx`
- **Why someone would care:** The two-engine "carousel" bug is a trap many media apps fall into. The single-engine principle is a clean, quotable architecture lesson.

### 2.2 The clip is the song
- **Summary:** You post a clip of a track, and the lock screen shows the *clip's* timeline, not the full track — the offset is translated natively so background auto-advance still works.
- **Pillar:** Engineering + Product
- **Angle:** Product decision made real by hard engineering — "in-app is absolute full-track seconds; only the notification is clip-relative."
- **Format:** Technical Achievement carousel, 5 slides
- **Carousel technique:** Zoom Storytelling (full track → the clip window → the lock-screen timeline)
- **Required screenshots:** `ClipRangeSlider` mid-edit; the lock screen showing the clip-relative scrubber.
- **Required assets:** Coordinate-translation diagram (`ClipForwardingPlayer`: `position − clipStart`).
- **Difficulty:** Hard
- **Priority:** ★★★★★
- **Status:** Needs Assets
- **Related features:** `ClipRangeSlider.tsx`, `nowPlayingMetadata.ts`, RNV patch, [2.1](#21-one-engine-plays-every-song)
- **Why someone would care:** "The clip is the song" is an elegant product idea most people never think about — and the native translation is a real flex.

### 2.3 The music didn't stop when the car did
- **Summary:** Next/prev, shuffle, and loop now sync correctly over Bluetooth car head units (AVRCP), matching the lock screen.
- **Pillar:** Engineering
- **Angle:** The invisible detail — playback that behaves everywhere, not just in-app.
- **Format:** Feature Spotlight, single post or 3-slide
- **Carousel technique:** n/a (single) or Progressive Reveal
- **Required screenshots:** Hard to capture in-car — use the lock-screen controls as proxy + a described scenario.
- **Required assets:** Small AVRCP command-flow diagram (optional).
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PR #55, `VideoPlaybackService.kt`, queue system
- **Why someone would care:** Anyone who's had an app mishandle car controls knows the frustration; getting it right signals craft.

### 2.4 We ruled out the popular library
- **Summary:** `react-native-track-player` was ruled out — V4 launch-crashes on RN 0.85 + New Arch, and paid V5 adds a video A/V-sync risk — so we built on patched `react-native-video` instead.
- **Pillar:** Engineering
- **Angle:** Comparison / product decision — choosing the harder-looking path for the right reason (never attack the library; explain the constraint).
- **Format:** Comparison carousel, 4–5 slides
- **Carousel technique:** Story Progression (options → constraint → the call)
- **Required screenshots:** None — text + a small options diagram.
- **Required assets:** Two `surface` option cards; the chosen one in purple.
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** [2.1](#21-one-engine-plays-every-song), RNV patch, `CLAUDE.md`
- **Why someone would care:** RN devs constantly ask "which audio library?" A grounded, honest teardown is genuinely useful — and shows how LiViL makes decisions.

### 2.5 Rebuilding the queue on an index
- **Summary:** The playback queue was overhauled to an index-based model with an animated queue UI that stays in lock-step with Jam sync and native skip.
- **Pillar:** Engineering
- **Angle:** A rewritten component — the story of replacing a fragile model with a simple one.
- **Format:** Engineering Deep Dive, 4–5 slides
- **Carousel technique:** Before/After + Animated Feeling (the queue reordering)
- **Required screenshots:** `QueueList` with the animated reorder; the up-next state.
- **Required assets:** Small state diagram (index → source → native queue JSON).
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PR #28, `QueueList.tsx`, `PlaybackContext.tsx`
- **Why someone would care:** "Index-based vs object-based queue" is a real design fork; the animated UI is also a nice showcase.

---

# Group 3 — Jam Rooms & Social Listening
*The brand thesis, made literal. Source: PRs #11, #32, #35, #9/#10 chat, `project_chat_jam_feature` memory.*

### 3.1 Jam Rooms — listen together
- **Summary:** Start a room and listen to the same track in sync with friends, with presence and a shared queue — music as a shared moment, not a solo session.
- **Pillar:** Product + Music
- **Angle:** Product story that *is* the mission ("make music social again"), made visible.
- **Format:** Feature Spotlight / Community carousel, 5–6 slides
- **Carousel technique:** Split Screenshots (shared player → presence avatars → group chat across slides)
- **Required screenshots:** `JamRoomScreen` — the shared player, presence avatars, Chat/Queue tabs; the `JamBanner` overlay.
- **Required assets:** Optional sync diagram (host clock → members).
- **Difficulty:** Medium
- **Priority:** ★★★★★
- **Status:** Needs Assets
- **Related features:** `JamRoomScreen.tsx`, `JamContext`, `jamRealtime.ts`, `jam_rooms` tables
- **Why someone would care:** Synchronized listening is the emotional core of LiViL — the single clearest "why this exists" post.

### 3.2 Keeping a Jam in sync
- **Summary:** Synchronized playback, auto-ending stale jams, and auto-leaving when the host ends — the invisible plumbing that makes "listen together" actually reliable.
- **Pillar:** Engineering
- **Angle:** Engineering story behind [3.1](#31-jam-rooms--listen-together) — realtime sync is harder than it looks.
- **Format:** Engineering Deep Dive, 4–5 slides
- **Carousel technique:** Progressive Reveal (architecture diagram)
- **Required screenshots:** Jam with system message bubbles ("host ended the jam").
- **Required assets:** Realtime broadcast diagram (Supabase `channel()` + `jam_broadcast_rpc`).
- **Difficulty:** Hard
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PRs #32, #35, `jamRooms.ts`, `create_jam_room_auto_end_stale` migration
- **Why someone would care:** "How do you sync audio across devices in real time?" is a rich technical topic.

### 3.3 Three tiers of who controls the room
- **Summary:** Jam permissions come in three tiers — co-host (full control), active listener (suggest only), view-only — so a shared room doesn't become chaos.
- **Pillar:** Product / Design
- **Angle:** Product decision — designing for social dynamics, not just features.
- **Format:** Product Decision, single or 3-slide
- **Carousel technique:** Story Progression
- **Required screenshots:** `GroupInfoScreen` / Jam member roles UI.
- **Required assets:** A 3-tier permission table card.
- **Difficulty:** Easy
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** `project_chat_jam_feature` memory, `jam_room_members`
- **Why someone would care:** Anyone who's designed multiplayer/social UX appreciates permission modeling.

---

# Group 4 — Design & UI Craft
*Where LiViL earns "these people care about details." Source: PRs #48, #52, #53, #56, `EmojiCoverArt.tsx`.*

### 4.1 The full-screen player
- **Summary:** Blurred cover art, gradient scrims, the live wave, pinch-to-zoom — the single most premium screen in the app, built to disappear around the music.
- **Pillar:** Design
- **Angle:** UI showcase — let a beautiful screen sell itself, no explanation.
- **Format:** UI Showcase, single post or 2–3 slide duo
- **Carousel technique:** Zoom Storytelling (full screen → the wave → the scrim detail)
- **Required screenshots:** `FullScreenPlayer` on a track with great cover art; clean state, real content, immaculate.
- **Required assets:** None (real UI leads); optional ambient purple-glow background.
- **Difficulty:** Easy (once the screenshot is captured)
- **Priority:** ★★★★★
- **Status:** Needs Assets
- **Related features:** `FullScreenPlayer.tsx`, `WaveVisualizer`, PR #48
- **Why someone would care:** Pure craft. It's the "that's a beautifully made product" first impression the brand is built on.

### 4.2 Cover art from an emoji and two colors
- **Summary:** Playlists and albums without artwork get a generated cover — an emoji over a two-color gradient — reused identically across the library, profile grid, and detail hero.
- **Pillar:** Design
- **Angle:** Design system detail — one component, no duplicated gradient math, no new dependency.
- **Format:** Design Breakdown, 4–5 slides
- **Carousel technique:** Zoom Storytelling + swatch chips
- **Required screenshots:** A grid of emoji covers (library list, profile grid, detail hero) showing the same art at three sizes.
- **Required assets:** Gradient swatch chips; a tiny "one component, three surfaces" diagram.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Needs Assets
- **Related features:** `EmojiCoverArt.tsx`, `playlist_emoji_cover` + `playlist_cover_gradient` migrations
- **Why someone would care:** Generated-cover systems are quietly clever; designers love a well-reasoned "no new dependency" call.

### 4.3 Emoji cover art
> Alias — merged into [4.2](#42-cover-art-from-an-emoji-and-two-colors). Kept in the queue as a shorthand entry.

### 4.4 Adopting a real icon system
- **Summary:** Every UI glyph moved to one `Icon` component backed by Phosphor (plus one Lucide drum), pure-JS SVG on the existing `react-native-svg` — no native rebuild.
- **Pillar:** Design + Engineering
- **Angle:** Design system maturation — replacing ad-hoc emoji/glyphs with a single, semantic import surface.
- **Format:** Design Breakdown / Before vs After, 4 slides
- **Carousel technique:** Before/After (emoji-as-icon → Phosphor)
- **Required screenshots:** Before (emoji glyphs) vs after (Phosphor icons) on the same screen.
- **Required assets:** The `REGISTRY` mapping shown as a small code card.
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** `Icon.tsx`, PR #53
- **Why someone would care:** "Why a single icon component?" is a maintainability lesson every frontend team relates to.

### 4.5 No OS dialogs, ever
- **Summary:** LiViL never uses `Alert.alert` — confirmations go through a themed `ConfirmActionModal`, errors/status through a custom toast — so nothing breaks the dark theme.
- **Pillar:** Design
- **Angle:** Product decision — a small rule that protects the premium feel.
- **Format:** Design Breakdown / Product Decision, 3–4 slides
- **Carousel technique:** Before/After (jarring OS dialog vs themed modal)
- **Required screenshots:** `ConfirmActionModal` + a toast (`success`/`error`).
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** `ConfirmActionModal.tsx`, `ToastContext.tsx`, PR #37
- **Why someone would care:** The gap between "looks native" and "looks intentional" is exactly this kind of rule.

### 4.6 The polish pass
- **Summary:** Profile loading skeletons, feed polish, an activity bubble, end-of-list cards, and player clearance — the unglamorous refinements that make the app feel finished.
- **Pillar:** Design
- **Angle:** Behind the scenes — the "last 10%" that separates a demo from a product.
- **Format:** Behind the Scenes / Progress Update, 4–5 slides
- **Carousel technique:** Split Screenshots / grid
- **Required screenshots:** `PostCardSkeleton`, `ActivityBubble`, `FeedEndMessage`.
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PRs #52, #54
- **Why someone would care:** Designers appreciate that someone sweats loading states and empty states.

### 4.7 Albums, and who gets to see them
- **Summary:** Albums plus per-playlist visibility (public/private), profile pills, and car-friendly album metadata — organizing music with control over its audience.
- **Pillar:** Product / Design
- **Angle:** Feature spotlight — giving creators structure and privacy.
- **Format:** Feature Spotlight, 4–5 slides
- **Carousel technique:** Progressive Reveal
- **Required screenshots:** `AlbumDetailScreen`, `VisibilitySelector`, profile pills.
- **Required assets:** None.
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PR #56, `albums_and_playlist_visibility` migration
- **Why someone would care:** Visibility control is a trust feature; it shows LiViL respects the creator's intent.

---

# Group 5 — Upload & Media Pipeline
*Source: PRs #1, #46, `project_media_upload` memory.*

### 5.1 Uploading without blowing up memory
- **Summary:** Large video uploads kept failing as "Network request failed" — the fix was to stream the file off disk via multipart instead of buffering it into JS memory.
- **Pillar:** Engineering
- **Angle:** Bug story + decision — the fix *and* why resumable uploads were deliberately deferred to a future web uploader.
- **Format:** Bug Story / Engineering Deep Dive, 5 slides
- **Carousel technique:** Progressive Reveal (symptom → cause → fix → the deferred decision)
- **Required screenshots:** The friendly over-limit message in `UploadScreen`.
- **Required assets:** "arrayBuffer (OOM) vs multipart stream" diagram card.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Idea
- **Related features:** `uploads.ts`, `UploadScreen.tsx`, PR #46
- **Why someone would care:** The `fetch(uri).arrayBuffer()` OOM trap is a common RN upload mistake; the streaming fix is directly reusable.

### 5.2 Why the app caps uploads at 500 MB
- **Summary:** Mobile uploads are capped at 500 MB with no resume — a deliberate call, because every RN resumable-upload option either OOMs or isn't New-Arch safe; 4K masters are deferred to a future desktop uploader.
- **Pillar:** Engineering / Product
- **Angle:** Product decision — choosing an honest limit over a fragile feature.
- **Format:** Product Decision, 3–4 slides
- **Carousel technique:** Story Progression
- **Required screenshots:** None — text-forward.
- **Required assets:** A "Now: phone video / Later: web 4K" roadmap card.
- **Difficulty:** Easy
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** [5.1](#51-uploading-without-blowing-up-memory), `project_media_upload` memory
- **Why someone would care:** "Ship an honest limit instead of a flaky feature" is a mature product lesson.

### 5.3 Tagging collaborators on a track
- **Summary:** Music upload supports tagging collaborators, crediting everyone who made the track — from the very first PR.
- **Pillar:** Music / Community
- **Angle:** Music story — credit and collaboration built in from day one.
- **Format:** Feature Spotlight, single or 3-slide
- **Carousel technique:** n/a
- **Required screenshots:** `CollaboratorPickerScreen`, upload flow.
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PR #1, `UploadScreen.tsx`
- **Why someone would care:** Independent artists care deeply about credit; it signals LiViL is built for creators.

---

# Group 6 — Chat, Notifications & Social Graph
*Source: PRs #9/#10, #13, #17, #33, #34, #39, #40, `feedback_chat_ux` memory.*

### 6.1 Chat that feels like the ones you love
- **Summary:** DMs with swipe-to-reply gestures, read receipts, live updates, and reactions — Instagram-grade chat feel, built on Supabase Realtime with no extra dependency.
- **Pillar:** Product
- **Angle:** Feature spotlight + a design-detail reward (the swipe/centering craft).
- **Format:** Feature Spotlight carousel, 5 slides
- **Carousel technique:** Split Screenshots (a chat revealed progressively) + Animated Feeling (swipe gesture)
- **Required screenshots:** `ConversationScreen` — a swipe-reply mid-gesture, read receipts, reaction chips.
- **Required assets:** None.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Needs Assets
- **Related features:** PRs #40, #9, `messages.ts`, `feedback_chat_ux` memory
- **Why someone would care:** Everyone has opinions on chat UX; the swipe + inverted-list centering craft is a great design-nerd reward.

### 6.2 The centering trick behind the chat
- **Summary:** The newest message sits optically centered via an inverted FlatList with a measured `paddingTop`, and the send bar floats absolutely above the keyboard — a hard-won layout recipe.
- **Pillar:** Engineering / Design
- **Angle:** Design breakdown — the invisible math that makes a chat feel right.
- **Format:** Design Breakdown, 4 slides
- **Carousel technique:** Zoom Storytelling + annotations
- **Required screenshots:** Annotated `ConversationScreen` showing the padding/centering.
- **Required assets:** Redline annotation overlay.
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** `feedback_chat_ux` memory, `ConversationScreen.tsx`
- **Why someone would care:** "Why does this chat feel better than mine?" — the inverted-list + absolute-bar recipe is reusable.

### 6.3 Your notifications are a conversation
- **Summary:** Activity notifications live in-app as a "livil Bot" chat thread — likes, comments, new fans, jam ends — instead of a separate notification list.
- **Pillar:** Product
- **Angle:** Product decision — reframing "notifications" as a familiar chat surface.
- **Format:** Product Decision / Feature Spotlight, 4 slides
- **Carousel technique:** Progressive Reveal
- **Required screenshots:** `ActivityCenterScreen` (the livil Bot thread).
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★★★
- **Status:** Idea
- **Related features:** PR #39, `activity.ts`, `activity_notifications` migration
- **Why someone would care:** Reusing the chat metaphor for notifications is a genuinely fresh product idea worth discussing.

### 6.4 Push notifications, end to end
- **Summary:** FCM push for friend requests, DMs, reactions, jam ends, and new fans — the full realtime nervous system that brings people back to the music.
- **Pillar:** Engineering
- **Angle:** Technical achievement — wiring reliable cross-device push on a solo stack.
- **Format:** Technical Achievement, 3–4 slides
- **Carousel technique:** Progressive Reveal (dispatch diagram)
- **Required screenshots:** A real push notification on the lock screen.
- **Required assets:** Dispatch-flow diagram (`pushDispatch.ts` → FCM → device).
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PRs #33, #34, `pushNotifications.ts`, `pushDispatch.ts`
- **Why someone would care:** Push on RN is fiddly; a clean end-to-end account is useful and shows reliability.

### 6.5 Friends and Stars
- **Summary:** A two-mode social graph — mutual "Friends" for close connections and one-way "Stars" for following artists — so the network models both intimacy and discovery.
- **Pillar:** Product
- **Angle:** Product decision — why two relationship types instead of one follow button.
- **Format:** Product Decision, 4 slides
- **Carousel technique:** Story Progression + a relationship diagram
- **Required screenshots:** `UserProfileScreen` with Friend/Star actions; `FriendRequestsScreen`.
- **Required assets:** A two-axis relationship diagram.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Idea
- **Related features:** PR #13/#14, `relationships.ts`, `relationships` migration
- **Why someone would care:** The follow-vs-friend distinction is a meaningful social-design choice most apps flatten.

### 6.6 Repost as a post or a story
- **Summary:** Reshare a track as a permanent post or an ephemeral story, with a clip window chosen on the `ClipRangeSlider` — one action, two intents.
- **Pillar:** Product
- **Angle:** Feature spotlight — flexible resharing that respects how people actually share music.
- **Format:** Feature Spotlight, 4 slides
- **Carousel technique:** Progressive Reveal
- **Required screenshots:** `RepostScreen`, `ClipRangeSlider`, `StoryViewerScreen`.
- **Required assets:** None.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Idea
- **Related features:** PR #17, `stories.ts`, `repost_and_stories` migration, [2.2](#22-the-clip-is-the-song)
- **Why someone would care:** Post-vs-story intent is a familiar mental model; clipping the exact moment is the music-specific twist.

---

# Group 7 — Platform & The Hard-Won Fixes
*The Android/RN battles. Source: PRs #22, #26, #27, `CLAUDE.md`, `FormInput.tsx`.*

### 7.1 The keyboard that wouldn't stay
- **Summary:** On Android 15 + Fabric, lifting a text input's focus state remounted the field and instantly dismissed the keyboard — the fix was `FormInput`, which keeps focus state local.
- **Pillar:** Engineering
- **Angle:** Bug story — a maddening, platform-specific bug with a one-component fix.
- **Format:** Bug Story, 4–5 slides
- **Carousel technique:** Progressive Reveal (symptom → cause → the rule)
- **Required screenshots:** Optional — a screen recording still of the dismiss; the `FormInput` usage.
- **Required assets:** A "focus state lifted → remount → dismiss" diagram.
- **Difficulty:** Medium
- **Priority:** ★★★★
- **Status:** Ready (fully documented; no hero screenshot required)
- **Related features:** `FormInput.tsx`, PRs #22, #27, `CLAUDE.md`
- **Why someone would care:** This exact Android 15 + Fabric bug bites many RN teams; the "never lift focus state" rule is immediately actionable.

### 7.2 Upgrading to React Native 0.85
- **Summary:** Moved to RN 0.85 + New Architecture, replaced KeyboardAvoidingView with keyboard-controller, and had to initialize the Reanimated mapper registry before keyboard events fired.
- **Pillar:** Engineering
- **Angle:** Behind the scenes — the reality of staying on the frontier (New Arch) as a solo dev.
- **Format:** Engineering Deep Dive / Founder, 4–5 slides
- **Carousel technique:** Story Progression
- **Required screenshots:** None — code cards + a version stat.
- **Required assets:** Small "what broke / what fixed it" list card.
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** PRs #26, #27, `CLAUDE.md` stack table
- **Why someone would care:** Teams weighing the New Architecture upgrade want honest field notes, not release-note optimism.

### 7.3 Patching react-native-video
- **Summary:** The lock-screen media controls required patching `react-native-video` itself (pinned exact `6.19.2`), re-captured via patch-package after every native edit.
- **Pillar:** Engineering
- **Angle:** Technical achievement / behind the scenes — when the library can't do it, you patch the library.
- **Format:** Engineering Deep Dive, 4 slides
- **Carousel technique:** Progressive Reveal
- **Required screenshots:** A diff excerpt from the patch.
- **Required assets:** None.
- **Difficulty:** Hard (requires careful, accurate framing)
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** `patches/react-native-video+6.19.2.patch`, [1.3](#13-the-lock-screen-is-native-on-purpose)
- **Why someone would care:** patch-package as a legitimate strategy (not a hack) is a mindset shift many devs benefit from.

---

# Group 8 — Founder Journey
*Source: git history, `CLAUDE.md` Play Store section, child-safety commit, `project_*` memories.*

### 8.1 Building this alone
- **Summary:** LiViL is a solo build — the audio engine, the realtime chat, the design system, the Play Store release — one founder across the whole stack.
- **Pillar:** Founder
- **Angle:** Founder update — honest, specific, not humble-brag; what building the whole stack alone actually feels like.
- **Format:** Founder Update, single text-forward post or 3–4 slide
- **Carousel technique:** Large Headlines (spanning type)
- **Required screenshots:** None (words-first); optional one small device.
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★★★
- **Status:** Ready
- **Related features:** Whole repo; every group above
- **Why someone would care:** Solo founders and builders follow the *journey*; this is the human thread that makes the engineering posts land.

### 8.2 The cold start nobody notices
- **Summary:** A four-phase Instagram/YouTube-style startup splash — native hold, JS-driven hide, a React crossfade — engineered so there's never a white or black flash on launch.
- **Pillar:** Engineering / Design
- **Angle:** The detail nobody notices (until it's wrong) — plus the debug-vs-release gotcha that faked a 6-second hang.
- **Format:** Engineering Deep Dive / Design Breakdown, 4–5 slides
- **Carousel technique:** Progressive Reveal (the four phases as a timeline)
- **Required screenshots:** The splash (the waveform mark on obsidian); the crossfade into the app.
- **Required assets:** A four-phase timeline card.
- **Difficulty:** Medium
- **Priority:** ★★★
- **Status:** Needs Assets
- **Related features:** `project_app_startup_splash` memory, `RootNavigator.tsx`, native splash module
- **Why someone would care:** Perfect cold-start is a craft signal; "the 6s hang was Metro, not my code" is a relatable debugging lesson.

### 8.3 Closed testing on the Play Store
- **Summary:** LiViL reached Closed Testing on the Play Store (package `com.livil`) — the first real milestone of shipping to actual devices.
- **Pillar:** Founder
- **Angle:** Milestone — quiet, grateful, forward-looking (don't inflate it).
- **Format:** Milestone, single celebratory frame
- **Carousel technique:** n/a (single) — Launch/Announcement card
- **Required screenshots:** Play Console listing / the app on a real device.
- **Required assets:** Hero-gradient announcement card + wordmark.
- **Difficulty:** Easy
- **Priority:** ★★★
- **Status:** Idea
- **Related features:** `CLAUDE.md` Play Store section, commit 1174165
- **Why someone would care:** Shipping milestones invite people to root for the journey — the reason build-in-public works.

### 8.4 Safety before scale
- **Summary:** A child-safety policy was written and committed before chasing growth — taking responsibility seriously on a social platform from the start.
- **Pillar:** Founder
- **Angle:** Values / transparency — a quiet signal that LiViL takes duty of care seriously.
- **Format:** Founder Update, single post
- **Carousel technique:** n/a
- **Required screenshots:** None.
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★
- **Status:** Idea
- **Related features:** Commit 8fb1d3e (child safety policy)
- **Why someone would care:** Trust content. Handling safety before scale is rare and reassuring — but only post if it can stay genuine, not performative.

---

# Group 9 — Music & Product Insight
*The soul. Source: `BRAND_GUIDE.md`, `CONTENT_PILLARS.md`, the discovery/social architecture.*

### 9.1 Discovery through people
- **Summary:** LiViL surfaces music through the people you follow and jam with — friend activity, reposts, shared playlists — instead of an opaque recommendation algorithm.
- **Pillar:** Music + Product
- **Angle:** Music industry insight — the thesis that streaming made music available but lonelier.
- **Format:** Music Industry Insight, single statement or 3–4 slide
- **Carousel technique:** Large Headlines / Continuous Timeline (Discovery → Playlist → Jam → Conversation → Friendship)
- **Required screenshots:** Optional — friend activity / feed as mood.
- **Required assets:** The five-stop journey timeline (the brand thesis, made visual).
- **Difficulty:** Easy
- **Priority:** ★★★★
- **Status:** Ready
- **Related features:** `friendActivity.ts`, `HomeScreen.tsx`, reposts, the whole social graph
- **Why someone would care:** It reframes how people think about discovery — a thinking post that positions LiViL as a voice, not just an app.

### 9.2 The whole journey in one line
- **Summary:** LiViL's product thesis as a single visual arc — Discovery → Playlist → Jam Room → Conversation → Friendship — one screen per stop.
- **Pillar:** Product / Music
- **Angle:** Future vision / brand thesis — the shape of the whole product in one swipe.
- **Format:** Future Vision / brand carousel, 5–6 slides
- **Carousel technique:** Continuous Timeline (a purple connector line crossing every seam)
- **Required screenshots:** One real screen per stop (feed, playlist, jam, chat, profile).
- **Required assets:** The connector-line master canvas.
- **Difficulty:** Hard (continuous master-canvas execution)
- **Priority:** ★★★★
- **Status:** Needs Assets
- **Related features:** Groups 1–6 combined
- **Why someone would care:** It's the single post that explains *why LiViL exists* — the anchor for the whole account.

### 9.3 Search that reaches people and tracks
- **Summary:** Search spans both users and tracks from the Search tab — finding the person is as first-class as finding the song.
- **Pillar:** Product
- **Angle:** Feature spotlight — small, but reinforces "people-first" discovery.
- **Format:** Feature Spotlight, single or 3-slide
- **Carousel technique:** n/a
- **Required screenshots:** `SearchScreen` with user + track results.
- **Required assets:** None.
- **Difficulty:** Easy
- **Priority:** ★★
- **Status:** Idea
- **Related features:** PR #19, `SearchScreen.tsx`
- **Why someone would care:** Reinforces the thesis in a concrete, everyday interaction.

---

# Changelog

*Log every published post here: date · item · pillar · link. This is the build-in-public record.*

| Date | Item | Pillar | Link |
|---|---|---|---|
| _(none yet)_ | | | |

---

# Backlog Health

- **Items:** 34 across 9 groups.
- **Pillar coverage:** Engineering-heavy (the repo's strength) — deliberately balance published output toward Design / Music / Founder so the *feed* stays mixed even though the *backlog* skews technical.
- **Immediate `Ready` items** (can ship without new captures): [1.2](#12-the-app-that-died-with-no-logs),
  [7.1](#71-the-keyboard-that-wouldnt-stay), [8.1](#81-building-this-alone), [9.1](#91-discovery-through-people).
- **Biggest asset gaps:** high-quality device screenshots of the Full-Screen Player, Jam Room, and the
  waveform pill; architecture/code cards for the playback deep dives.
- **Next maintenance trigger:** on the next feature PR, add its item here before writing any post about it.

---

_Consult this backlog first. Ground every story in the repo. Rotate pillars. Keep it alive._
