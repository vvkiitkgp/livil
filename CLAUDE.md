# Livil — Claude Code Guidelines

> ## ▶ Start at [`kb/INDEX.md`](kb/INDEX.md)
>
> This file is the quick-reference. The **knowledge base** under [`kb/`](kb/) is the
> source of truth — architecture, standards, decisions, and the security model — and it
> routes you to the two or three documents a task actually needs.
>
> | Read | For |
> |---|---|
> | [`kb/INDEX.md`](kb/INDEX.md) | The routing table. Always first. |
> | [`kb/ai-org/ENGINEERING_CONSTITUTION.md`](kb/ai-org/ENGINEERING_CONSTITUTION.md) | How we work, and when to refuse |
> | [`kb/architecture/overview.md`](kb/architecture/overview.md) | What this system is |
> | [`kb/decisions/`](kb/decisions/) | Why it is that way — with the rejected alternatives |
>
> **If you are an agent:** [`.claude/autonomy-config.yml`](.claude/autonomy-config.yml)
> says where you may write. Most of `src/` is propose-only because coverage is ~1%, and
> that is enforced by CI rather than by this sentence.
>
> Anything below that contradicts `kb/` is stale — `kb/` wins, and the contradiction is
> a defect worth reporting.

## What is Livil?
Livil is a social music platform — think Spotify + Discord + SoundCloud.
Users can upload music (audio + video), listen together in real time (Jam rooms), chat with friends, build shared playlists, and follow each other's listening activity.

---

## How to explain things to me (READ THIS FIRST)

I am a **front-end developer**. I am comfortable with React, React Native, TypeScript, and
UI work. I am **not** comfortable with backend, database, native Android/iOS, or build
tooling — explain those parts as if I have never seen them before.

**This section governs how you WRITE TO ME. It does not lower the bar on the code itself,
and it does not apply to code comments, commit messages, PR bodies, or `kb/` documents —
those stay precise and technical.**

### Rules for your replies to me

1. **Lead with the plain-English answer.** First 1–3 sentences: what happened / what you
   did / what I should do, in words my non-technical friend would understand. Detail comes
   after, never before.
2. **One jargon term per reply, max — and define it inline the first time.**
   Not "Fabric defers view commands while backgrounded." →
   "When the app is in the background, Android ignores our instructions to the player
   until the app is open again (that's what 'Fabric defers view commands' means)."
3. **Use an analogy for anything backend, native, or infrastructure.** A database row is a
   spreadsheet line. RLS is "the database's own bouncer, checking who you are on every
   request." A migration is "a numbered instruction we ship once to change the database's
   shape." If you can't think of an analogy, you don't understand it well enough to
   explain it yet.
4. **Say what it means for the user of the app, not just for the code.** Always answer the
   unasked question: "so what would I actually see on my phone if this were broken?"
5. **No unexplained acronyms.** MediaSession, RLS, JNI, AAB, codegen, Fabric, jsonb, OOM,
   ADR — spell out and define on first use in every conversation, not just once ever.
6. **Structure over prose.** Short paragraphs, bullets, and a bolded takeaway line. Never
   write a 10-line paragraph of dense technical narrative.
7. **When you're proposing a change, always give me three things:**
   - **What I'll see change** (in the app, as a user)
   - **What could break** (in plain terms)
   - **Whether I need to do anything** — and if so, it goes in the ✅ **Your turn** list
     below, not buried in a paragraph.
8. **When I ask "why", answer with the reason first and the mechanism second.** I usually
   want the reason. If I want the mechanism I'll ask a follow-up.
9. **Never assume I know a file, table, or concept because it's in this document.** This
   file is my notes to *you*, not proof I remember any of it.
10. **If I can't act on it, don't say it.** Skip internal detail that changes nothing for
    me.

### ALWAYS end with my to-do list

If **anything at all** is left for me to do — because you can't do it, aren't allowed to
do it, or it needs my hands, my password, my browser, or my phone — it goes in a list at
the **very end of your reply**, in exactly this format:

```
## ✅ Your turn

- [ ] **Apply the database migration** — open the Supabase dashboard → SQL Editor, paste
      `supabase/migrations/20260816000000_foo.sql`, hit Run. *(~2 min. I can't do this:
      it changes production data.)*
- [ ] **Rebuild the Android app** — `cd android && ./gradlew assembleDebug`. *(~4 min.
      Needed because I changed native code; reloading Metro will NOT pick it up.)*
```

Rules for this list:
- **Always use the `## ✅ Your turn` heading**, exactly, so I can spot it by scrolling.
- **Checkboxes (`- [ ]`), one action per line**, in the order I should do them.
- **Bold the action**, then the exact command / click-path. Give me the literal command
  in a copy-pasteable code block if it's more than a few words.
- **Say roughly how long it takes**, and **why you couldn't do it yourself** — one short
  clause in italics. "I can't — it needs your Play Console login."
- **Blocking vs. optional:** if something must happen before the change works at all, mark
  it **`(BLOCKING)`**. If it's a nice-to-have, mark it *(optional)*.
- **If there is genuinely nothing for me to do, say one line: "✅ Your turn: nothing —
  this is done."** Don't leave me guessing whether you forgot the list.
- **Never hide a required step in prose.** If I have to do it and it isn't in this list,
  that's a bug in your reply.

Things that almost always belong here: applying a database migration, rebuilding the
native app, bumping the version and uploading to the Play Console, rotating a key or
password, clicking something in the Supabase/Google/Play dashboards, testing a gesture or
lock-screen behaviour on a real phone, and anything needing a login.

### Backend changes: show me BEFORE → AFTER with a real example

Any time you change the **database, a service, a query, an API, auth/permissions, or a
migration**, you must show me the behaviour change as a concrete before-and-after — with
real-looking data, not abstract description. Use this shape:

> **Before:** When you opened Home, the feed showed every post from everyone, newest
> first — so a stranger's 3-minute-old upload pushed your friend's post out of sight.
> **After:** The feed shows posts from people you follow first, then everyone else. Same
> posts exist; the order changed.
>
> **Concrete example — you follow @riya, you don't follow @sam:**
>
> | | Before | After |
> |---|---|---|
> | 1st post | @sam — 2 min ago | @riya — 40 min ago |
> | 2nd post | @riya — 40 min ago | @sam — 2 min ago |

Rules for this:
- **Use real-looking values** — a username, a time, a count. Never "entity A" / "field X".
- **Say explicitly if nothing visible changes.** "Before and after look identical to you;
  this only makes the feed load faster." That's a valid and useful answer.
- **If existing data is affected, say what happens to it.** Does old data get rewritten,
  left alone, or become invisible? Is it reversible?
- **Call out anything that can't be undone** in bold, before I approve it.
- This also applies to changes in **who can see or do what** (permissions/RLS). Show it as
  "Before: any logged-in user could read your drafts. After: only you can."

### Front-end is the exception

For React / React Native / TypeScript / styling / navigation work, talk to me normally as
a peer. Don't over-explain `useEffect`. The simplification above is for **backend,
database, native, and build** topics.

### Quick example

> ❌ "The clip-end watcher polls at 250ms and routes through `onVideoNextTrack → playNext`
> because Fabric defers the source prop while backgrounded."
>
> ✅ "**When a song's clip ends with the phone locked, the next song has to be started by
> the Android side, not by our JavaScript.** Android freezes our JavaScript when the
> screen is off, so if we relied on it, the music would just stop. Instead a small piece
> of Android code checks 4 times a second whether the clip is over, and starts the next
> one itself. **For you:** nothing to do — just don't move that logic back into
> JavaScript, or music will stop on the lock screen."

---

## Rules
- Always follow the confirmed dependency versions below. Never suggest upgrading or downgrading without explicit instruction.
- Always use `FormInput` (`src/components/FormInput.tsx`) for text inputs — never create raw `TextInput` with focus state lifted to parent. **Why**: on Android 15 + Fabric, lifting focus state causes re-renders that remount the `TextInput` and immediately dismiss the keyboard.
- Always use `createNativeStackNavigator` — never `createStackNavigator`.
- **Always use `Icon` (`src/components/Icon.tsx`) for UI icons — never hard-code a unicode glyph/emoji in a `<Text>` as an icon.** `Icon` is the single import surface, backed by **Phosphor** (`phosphor-react-native`, pinned `3.0.6`) plus **Lucide** (`lucide-react-native`, pinned `1.18.0`) for the one `drum` icon Phosphor lacks. Props: `<Icon name={IconName} size={number} color={string} weight={'regular'|'fill'|'bold'|…} />`. Both libs are pure-JS SVG riding the existing `react-native-svg@15.15.5` — **no native rebuild**. Add a new icon by mapping a Livil-semantic name in the `REGISTRY` in `Icon.tsx`. **Never nest `<Icon>` inside `<Text>`** (it's an SVG, not inline text — wrap it in a `<View>` row instead). **Exceptions (stay as text/emoji):** chat reaction emoji + the emoji picker, emoji inside copy strings (e.g. `🎵 ${title}`, share/push messages), single-char initials fallbacks (`name.charAt(0) || '♪'`), and `ConfirmActionModal`'s decorative `glyph` prop.
- Always keep dark theme (`#0A0A0F` background, `#8B3DFF` purple accent). No light mode.
- New screens go under `src/screens/` following the existing structure.
- When adding navigation routes, update `src/navigation/types.ts` with the new route params.
- Never install new packages without checking compatibility with RN 0.85.3 + New Architecture (Fabric) first.
- Bump `versionCode` in `android/app/build.gradle` before every Play Store release.
- Never commit `android/app/livil-release.keystore` or any passwords/credentials.
- **Never use `Alert.alert`.** For confirmations ("Are you sure?", destructive actions, decisions) use `ConfirmActionModal` (`src/components/ConfirmActionModal.tsx`) or a bespoke modal matching the `NotificationPermissionModal` / `JamExitModal` template. For errors, warnings, and short status messages use the toast — `useToast()` from `src/contexts/ToastContext.tsx` — with `kind: 'error' | 'success' | 'info'`. **Why**: `Alert.alert` renders the OS dialog which clashes with the dark theme and looks unprofessional. **How to apply**: when adding a feature that needs user feedback, reach for `ConfirmActionModal` or `useToast` first; only if neither fits, build a new modal in the same visual style.
- **Playback is a SINGLE engine.** `GlobalAudioPlayer` (`src/components/GlobalAudioPlayer.tsx`) is the ONLY `<Video>` with `showNotificationControls` — the sole MediaSession / lock-screen owner — and it plays the audio of **every** post (audio via `audioUrl`, video via `videoUrl` on a hidden 0×0 surface). `FullScreenPlayer` is a **muted, foreground-only** video frame that slaves its picture to the engine's position. **Never add a second `<Video>` with `showNotificationControls` (or a second audio engine)** — it resurrects the notification "carousel" + audio↔video desync. See **Playback & Lock-Screen Media Controls** below.
- **`react-native-video` is PATCHED** (`patches/react-native-video+6.19.2.patch`, pinned to exact `6.19.2` — do not float the `^`). After ANY edit under `node_modules/react-native-video/`, re-capture with `npx patch-package react-native-video --include '^(ios/|android/src/|src/|lib/)'` (the `--include` keeps build artifacts out of the diff) **and do a full native rebuild** (`cd android && ./gradlew …`) — a Metro reload does NOT pick up native changes.
- **Beat-synced visualizer is AUDIO-ONLY, and its decode must never touch the engine.** The floating-player wave (`src/components/WaveVisualizer.tsx`) rides a pre-computed loudness envelope stored in `tracks.waveform_peaks` (jsonb), decoded **on-device** by `react-native-audio-api`'s standalone `decodeAudioData` — a one-shot decode util (NO `AudioContext`, no playback, no MediaSession), so it never interacts with the single engine. **NEVER analyze video posts.** `decodeAudioData(videoUrl)` pulls the WHOLE file into memory through RN networking → `OutOfMemoryError` → the OS kills the process (no JS log, debugger drops). Analysis is gated to `mediaKind === 'audio'` at both call sites; video keeps the decorative wave. See **Beat-Synced Visualizer** below.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Mobile App | React Native 0.85.3, New Architecture (Fabric) ON (no Expo) |
| Language | TypeScript |
| Navigation | @react-navigation/native-stack (v7) |
| Backend/Auth | Supabase |
| Database | Supabase PostgreSQL |
| File Storage | Cloudflare R2 (planned) |
| Real-time | Socket.io (planned) |

---

## Confirmed Working Dependency Versions (DO NOT CHANGE)

```json
"react-native": "0.85.3",
"react": "19.2.3",
"react-native-video": "6.19.2",
"react-native-reanimated": "4.4.0",
"react-native-worklets": "0.9.1",
"react-native-svg": "15.15.5",
"react-native-audio-api": "0.12.2",
"react-native-gesture-handler": "2.22.0",
"react-native-safe-area-context": "5.7.0",
"react-native-screens": "4.10.0",
"@react-navigation/native": "7.2.2",
"@react-navigation/native-stack": "7.x",
"@react-navigation/stack": "7.8.11",
"@react-native-async-storage/async-storage": "1.23.1",
"@supabase/supabase-js": "^2.x"
```

> `react-native-audio-api` (Software Mansion) is used **only** for its standalone
> `decodeAudioData` (beat-synced visualizer, audio-only) — NOT as a playback/audio
> engine. It peers on `react-native-worklets >= 0.6.0` (satisfied by `0.9.1`). It
> compiles + boots on RN 0.85.3 + New Arch as-is (the RN-0.85 JNI issue #1012 did
> NOT bite on `0.12.2`; no patch needed). `react-native-svg` renders the wave
> `<Path>`. (The `reanimated`/`worklets` rows were corrected here to the actually
> installed versions — the old `4.0.3`/`0.4.2` values were stale.)

> New Architecture (Fabric) is **ON** (`newArchEnabled=true`). This matters for
> playback: Fabric **defers view commands (`videoRef.seek()`) and prop changes
> while the app is backgrounded** — the root reason lock-screen skip/advance must
> be driven natively (see below). `react-native-video` is pinned exact and
> **patched** (`patches/react-native-video+6.19.2.patch`); `patch-package` runs on
> `postinstall`.

---

## Project Structure

```
livil/
├── src/
│   ├── screens/
│   │   ├── auth/
│   │   │   ├── OnboardingScreen.tsx
│   │   │   ├── SignInScreen.tsx
│   │   │   └── SignUpScreen.tsx
│   │   └── main/
│   │       ├── HomeScreen.tsx
│   │       ├── SearchScreen.tsx
│   │       ├── LibraryScreen.tsx
│   │       └── ProfileScreen.tsx
│   ├── navigation/
│   │   ├── types.ts               ← update when adding new screens
│   │   ├── AuthNavigator.tsx
│   │   ├── AppNavigator.tsx       ← bottom tab navigator
│   │   └── RootNavigator.tsx      ← session guard (auth vs app)
│   ├── components/
│   │   ├── FormInput.tsx          ← always use this for text inputs
│   │   ├── GlobalAudioPlayer.tsx  ← THE single audio engine + MediaSession owner
│   │   ├── FullScreenPlayer.tsx   ← muted, foreground-only video frame (slaved to GAP)
│   │   └── WaveformScrubber.tsx   ← THE one scrubber (span='full' | 'clip'; needs the FULL track)
│   ├── contexts/
│   │   └── PlaybackContext.tsx    ← playback seam (handlers, refs, queue, clip)
│   ├── utils/
│   │   └── nowPlayingMetadata.ts  ← buildNowPlayingMetadata / buildMediaQueueJson / buildCurrentClipJson
│   └── theme/
│       └── colors.ts
├── lib/
│   └── supabase.ts                ← Supabase client config
├── patches/
│   └── react-native-video+6.19.2.patch ← native lock-screen controls; re-capture after node_modules edits
├── android/
│   └── app/
│       ├── build.gradle           ← bump versionCode on every release
│       └── livil-release.keystore ← DO NOT COMMIT
├── docs/
│   └── privacy-policy.html
└── index.js                       ← must import 'react-native-gesture-handler' first
```

---

## Supabase

- **Project URL**: `https://fqzrmqnlgjeuxzinbqvs.supabase.co` (Mumbai/`ap-south-1`, Micro tier; migrated 2026-07-07 from the old Sydney/Nano project `itmtmeobsclhyczidjct`, kept parked as fallback)
- **Anon key**: stored in `lib/supabase.ts`
- **Auth methods**: Email/Password + Google OAuth

### Database Tables

```sql
profiles (
  id uuid references auth.users(id) primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  followers_count integer default 0,
  following_count integer default 0,
  created_at timestamp with time zone default now()
)
```

`handle_new_user()` trigger auto-creates a profile row on signup, falling back to email prefix as username.

### Planned Tables (not yet created)
- `tracks` — uploaded music/video files
- `playlists` — user playlists
- `playlist_tracks` — many-to-many
- `follows` — user follow relationships
- `messages` — chat messages
- `jam_rooms` — listen-together sessions

---

## Design System

`src/theme/colors.ts` is the single source of truth — import `COLORS`, never hard-code a hex.

| Token | Value |
|---|---|
| Background | `#0A0A0F` |
| Surface | `#12121A` |
| **Primary accent (`purple`)** | **`#8B3DFF`** — CTAs, play button, active states, links, sent bubbles |
| Neon accent (`purpleNeon`) | `#A855F7` — glows, highlights |
| Royal / gradient mid (`purpleRoyal`) | `#6D28D9` |
| Deep violet (`purpleDeep` / `purpleDeepest`) | `#4C1D95` / `#3A1180` — gradient floor |
| Light highlight (`purpleLight`) | `#C9B6FF` — accent text on dark |
| Secondary accent | `#00BFFF` (neon blue) |
| Text primary | `#FFFFFF` |
| Text secondary | `#888888` |
| Danger | `#FF4444` |
| Success | `#00C853` |

Signature gradients: hero `#6D28D9 → #A855F7`; deep background `#0A0A0F → #4C1D95 → #8B3DFF`.

- Animated purple border on input focus
- Bottom tab bar: Home, Search, Library, Profile

### Buttons — NEVER fill a button with solid purple

**Always use `Button` (`src/components/Button.tsx`).** Do not hand-roll a
`TouchableOpacity` + local `StyleSheet` — that is how the app accumulated ~40
divergent button styles before this was centralized.

| Variant | Background | Border | Label |
|---|---|---|---|
| `primary` | transparent (black page/card) | purple **gradient glow** (`GradientBorder`) | `purpleNeon` |
| `selected` | transparent | purple gradient glow | `purpleNeon` |
| `secondary` | transparent | `COLORS.border` | `white` |
| `ghost` | none | none | `textSecondary` |
| `destructive` | **solid `COLORS.error`** | none | `white` |

Sizes `sm | md | lg`. Pass `onMedia` when the button floats over video/artwork
(swaps in an opaque scrim so the border keeps contrast). `disabled`/`busy` are
handled internally — never layer your own opacity or `*Disabled` style.

**Why:** at `#8B3DFF` a solid fill dominates the dark UI, and the Repost button
appears on every feed card. Purple now outlines and letters; it never fills.
`destructive` is the one exception — dangerous actions must stay visually heavy.

**Rules that are easy to get wrong:**
- **Label color is `purpleNeon` (`#A855F7`), never `purple`.** `#8B3DFF` on a dark
  background measures 3.4–4.0:1 and **fails WCAG AA**; `purpleNeon` is 4.3–5.0:1
  and clears the 3:1 large-text bar that bold 15px+ labels fall under.
- **Never set `elevation` on a button.** Android ignores `shadowColor` and paints
  `elevation` as a grey shadow — it reads as a smudge under a dark outlined button.
  Glow comes from `GradientBorder`, not shadows.
- **`GradientBorder`'s bloom is drawn INWARD.** Android `ViewGroup`s clip children
  by default, so an outward halo is silently cut off.
- **NEVER put `overflow: 'hidden'` on a `GradientBorder` host.** It is not needed —
  the component already draws a correctly-rounded outline inside the bounds — and
  it actively breaks the look: `overflow` clips to the *padding box* (inside
  `borderWidth`), shaving the outer edge of the glow so the border appears cut off
  along curves. Keep it only where a child genuinely needs clipping (e.g. an
  avatar image).
- **Exempt from the no-fill rule** (these stay solid): small indicators — badges,
  dots, checkboxes, progress fills, slider thumbs, story rings; chat sent bubbles
  (`bubbleMe`); destructive confirms; and decorative cover art / avatar fallbacks /
  `fallbackBlob*`. An outlined 6px dot is invisible and a hollow checkbox reads as
  unchecked. `DetailView.rowActive` also keeps its `purpleDim` wash — it is a
  now-playing row highlight, not a control.

### Progress bars — `GradientFill`, never a flat purple slab

A progress bar IS its fill, so the no-fill rule can't apply. Use
**`GradientFill`** (`src/components/GradientFill.tsx`) so it uses the same
deep→neon ramp as the borders instead of reading as a leftover flat slab.
Applied in `SeekBar` and `ClipRangeSlider`.

- **Pass the FULL track width, not the filled width**, and let the parent's
  animated width clip it (parent needs `overflow: 'hidden'` — this is the one
  place it's correct). Sizing the gradient to the fill makes the colours visibly
  stretch and shift as playback advances.
- Pass `offsetX` when the fill doesn't start at zero (e.g. `ClipRangeSlider`,
  whose fill begins at the clip start) so the gradient stays pinned to the track.
- `FloatingPlayer`'s progress ring is built from rotated View borders, not SVG, so
  it can't take a gradient without rewriting the rotation mask. It uses
  `purpleNeon` instead. Don't "fix" this casually — the hollow centre is
  deliberate so the fullscreen video shows through.

### SVG-overlay traps (hard-won — all of these shipped as bugs first)

These apply to `GradientBorder`/`GradientFill` and any future SVG overlay sized
from `onLayout`:

- **Floor the measured size to whole dp before drawing.** `onLayout` reports
  fractional dp (46dp at pixelRatio 2.75 is 126.5px) and Android rounds the SVG's
  backing view DOWN. Geometry computed against the unfloored size puts the outer
  stroke past the real edge, where it is clipped — height rounding down clips the
  BOTTOM, width rounding down clips the RIGHT. Symptom: intermittent, one-sided
  "cut off" borders that vary by content.
- **Clamp `rx` to half the SHORTER side, and set `ry` explicitly.** A pill passes
  `borderRadius: 999`; unclamped, SVG caps `rx` at width/2 but `ry` at height/2
  *independently*, rendering an ellipse instead of a stadium.
- **Keep a small inset (`EDGE_GUARD`) between the outermost stroke and the canvas
  edge** so nothing lands exactly on the viewport boundary.

### Other UI rules learned here

- **Never use `android_ripple` on a rounded control.** The ripple is drawn as a
  RECTANGLE that ignores `borderRadius`, flashing a square box over the rounded
  outline. Use `Pressable`'s `({ pressed })` style callback for opacity feedback.
- **`ListHeaderComponent` must be given an ELEMENT, not a function.** As a
  function it is treated as a component *type*, so every new `useCallback`
  identity remounts the whole header — which resets `onLayout`-measured children
  (flickering outlines) and throws away the header's subviews on every tab switch.
  Use `ListHeaderComponent={renderHeader()}`.
- **Brand mark:** use `Logo` (`src/components/Logo.tsx`) — the pulse glyph as SVG,
  same vector as the app icon (`docs/favicon.svg`). Don't add new bitmap copies of
  the mark; regenerate from that SVG so every surface stays in sync.

---

## Navigation Rules

- Use `createNativeStackNavigator` — NOT `createStackNavigator`
- Set `gestureEnabled: false` on auth screens
- `android:enableOnBackInvokedCallback="false"` in AndroidManifest.xml
- Wrap app root in `GestureHandlerRootView` in `App.tsx`
- First line of `index.js` must be `import 'react-native-gesture-handler'`

---

## Playback & Lock-Screen Media Controls

Hard-won architecture (PRs **#44** lock-screen controls + single engine, **#45** clip-relative
lock screen). Every rule below exists because we already paid for the bug it prevents. Treat them as
locked-in; if you must change one, re-read the **Do-not-break** table first.

### The single-engine model
- **`GlobalAudioPlayer` (GAP)** — the ONE audio engine + MediaSession/lock-screen owner for **every**
  post. Source = `audioUrl ?? videoUrl` (a video's audio plays through its hidden 0×0 surface). Owns the
  `PlayerHandlers` (play/pause/seek/rate, registered into `PlaybackContext`), the play-count tracker, the
  native background-skip queue, and `onError` (skip broken track). Only this `<Video>` sets
  `showNotificationControls`.
- **`FullScreenPlayer` (FS)** — a **muted, foreground-only** video FRAME (`muted`, `volume={0}`,
  `disableFocus`), gated `mediaKind==='video' && videoUrl && isFullScreenOpen && appForeground && !engineDriving`,
  `paused={activePostId !== nowPlaying.postId}`. It **slaves its picture** to GAP via `positionRef`
  (drift-correct + a `seekNonce`-driven eager seek for paused scrubs). It has **no** `showNotificationControls`,
  `playInBackground={false}`, and must **never** set `disableAudioSessionManagement` (iOS: that flag is a
  process-wide singleton — it would stop GAP from claiming the `.playback` category → audio silenced by the
  ring switch / no background audio).
- **`PlaybackContext`** (`src/contexts/PlaybackContext.tsx`) is the seam: `handlersRef` (last-writer-wins),
  `positionRef`/`durationRef`/`clipWindowRef` (refs — no re-render), `seekGuard` via `markSeekTarget`,
  the queue, `seekNonce` (paused re-seek), `clipVersion` (clip-edit push). There is **no** `fsOwnerPostIdRef`
  ownership/handoff anymore — that was deleted with the single-engine consolidation.
- **Why:** the old two-engine model (GAP audio / FS video, both with notification controls) churned the OS
  MediaSession at every audio↔video boundary → swipeable notification **"carousel"** + dropped `onNextTrack`
  events. Single engine = exactly one MediaSession, always.

### Coordinate model — ONE truth, translate only at the notification
- **In-app is ABSOLUTE full-track seconds** everywhere (`positionRef`/`durationRef`/`clipWindowRef`). The
  player **always loads the full track** — **never** `ClippingConfiguration` / `cropStart`/`cropEnd` — so the
  `ClipRangeSlider` editing UI can scrub/drag the whole track and reposts can re-clip.
- **The lock screen is CLIP-RELATIVE**, produced by **`ClipForwardingPlayer`** (in the patch) wrapping the
  engine **for the MediaSession only**: position = `absolute − clipStart`, duration = `clipEnd − clipStart`,
  scrubber seek `p → clipStart + p`. Pure pass-through when no clip. JS never sees the translation
  (`updateProgress()` polls the raw player).

### Auto-advance & clip-end = NATIVE on Android
- **Fabric defers `videoRef.seek()` and source-prop changes while backgrounded**, so JS cannot loop/advance
  on the lock screen. Native owns it in `VideoPlaybackService.kt`: the **clip-end watcher** (250 ms poll →
  loop on repeat-one, else `nativeSkip` + emit `onVideoNextTrack`) and the **`naturalEndListener`**
  (STATE_ENDED → same). JS `handleProgress` clip-end and `handleEnd` are **gated to iOS only**. **Do not
  re-enable them on Android** — you'll double-advance.
- **`mediaQueueJson` + `nativeSkip`** let notification next/prev load the target track natively (bypassing the
  background prop-deferral). The `alreadyLoaded` URI guard in `ReactExoplayerView.setSrc` suppresses the
  redundant reload when the deferred source prop lands on foreground. Advance always routes through
  `onVideoNextTrack → playNext` so the JS queue index stays in lock-step.

### Native prop seam (codegen) — easy to silently break
- New RNV native props (`mediaQueueJson`, `currentClipJson`) must be mirrored in **`src/specs/VideoNativeComponent.ts`
  + `src/types/video.ts` + `lib/types/video.d.ts`** (and re-captured into the patch). The prop reaches native
  via `{...rest}` in `Video.tsx` — no `Video.tsx` change needed. A missed mirror **silently drops the prop**.

### Do-not-break

| Trap | Rule / Why |
|---|---|
| Second MediaSession / "carousel" | Only GAP has `showNotificationControls`. Never add another. |
| Notification id | Post/cancel with the **raw player's** `hashCode` (`notifIdFor()`), NOT `session.player.hashCode()`. `ClipForwardingPlayer` changed `session.player.hashCode()` → a duplicate, uncancellable card (exact-duplicate-in-sync). |
| Live clip-edit not updating notif | media3 only republishes `PlaybackState` on a **player event** → `setCurrentClip` nudges an in-place `seekTo`, but **only when the window actually changed** (not on repeat-toggle / advance). |
| Hard-clipping the player | Never (`ClippingConfiguration`/`cropStart`). Breaks the editing slider AND desyncs JS-absolute vs native-relative. |
| Background advance | Must be native (watcher / `naturalEndListener`). JS is foreground/iOS only. |
| Swipe-dismiss on Android 15 Pixel | **Intentional Google behavior**, not our bug. `setOngoing(player.isPlaying)` pins it while playing (Samsung pins regardless). |
| Permanent foreground service (**battery**) | Upstream RNV `startForegroundService`s + binds, `startForeground`s once in `registerPlayer`, and never lets go of either — so the process was permanently above the cached tier and **never frozen**. Idling is now two-stage, armed on `onIsPlayingChanged(false)`: **30s** → `stopForeground(DETACH)` (card kept, exemption released); **5 min** → cancel the notification + `stopSelf()` (process finally cached/freezable). **Both stages are required** — dropping only foreground status leaves a STARTED service, which still pins the process above cached. |
| Removing the card is deliberate | Stage 2 makes the process reclaimable, so a card left behind would be **dead** (no engine, buttons do nothing). Never "fix" the disappearing card by skipping stage 2 or re-posting the notification without `promoteToForeground()`. The session + player are intentionally NOT released, so the next play just re-posts the card. |
| `startForeground` after stage 2 | Must re-`startForegroundService` first (`isServiceStarted`) — the service object survives `stopSelf()` only because the view holds a `BIND_AUTO_CREATE` binding, and `startForeground` on a bound-only service is not a valid FGS start. Keep both calls inside the try/catch: Android 12+ can refuse a background FGS start, and a refusal must never take playback down. |
| Stopping playback on swipe-away | The `playWhenReady=false` + `stop()` belongs in **`onTaskRemoved` only** — NOT in `cleanup()`. `cleanup()` is shared with `unregisterPlayer`, which the **story viewer** triggers on every `showNotificationControls` flip; stopping there kills the user's music whenever they open a story. |
| Card outliving a swipe-away | `NotificationManager.cancel()` is **silently ignored** for a foreground service's own notification, and `stopSelf()` does not destroy this service (the view's `BIND_AUTO_CREATE` binding keeps it alive) — so the card survived until the OS killed the process. `cleanup()` must `stopForeground(REMOVE)` **before** cancelling. Applies to every caller: `onTaskRemoved`, `onDestroy`, `unregisterPlayer`. |
| Any poll that outlives playback | Both 250ms polls are armed by `onIsPlayingChanged(true)` and cleared on `false`: the view's `progressHandler` (upstream started it on `STATE_READY` and only cleared it on release) and the service's `clipWatcherRunnable` (was armed in `registerPlayer`, which happens while PAUSED). A paused player must wake the main thread **zero** times — `updateProgress()` suppressing the JS event when the position hasn't moved hides the cost, it does not remove it. |
| Wave visualizer frame loop | `useFrameCallback(cb, false)` + `setActive(playing && !suppressed)`. `phase` is the only shared value still changing once amplitude eases to 0, so an always-on integrator rebuilt the `<Path>` every frame to redraw a straight line, on every screen, for as long as a track was loaded. The flatten still animates — `baseAmp`/`kick` ride Reanimated's own loop, not this one. |
| Android 12 notification buttons | RNV builds the pre-Tiramisu notification's actions **by hand**; `setCustomLayout` only drives the session-rendered UI on **Android 13+**. Patch BOTH branches or Android 12 keeps upstream's rewind/fast-forward — where "next" is a literal +10s seek. Same for `setOngoing`: the manual branch hardcoded `true`, leaving a paused card unswipeable. |
| RNV's PLACEHOLDER notification (id 9999) | `onStartCommand` must `startForeground` with the **real card under the raw player's hashCode** whenever a session exists, never the placeholder. `startForeground` with a DIFFERENT id makes Android cancel the previous foreground notification, and `onStartCommand` is delivered LATE — so a placeholder there silently replaces the media card AND re-promotes the service behind `isForegroundService`'s back, re-pinning the process. Cancel id 9999 in `hideAllNotifications()`/`teardownIfIdle()` too. |
| `cancelAll()` in the playback service | **Never.** It cancels every notification the *app* has posted, so tearing the player down also wiped the user's unread chat/push notifications (notifee posts from the same app). Cancel only our media ids — the raw players' `hashCode`s. |
| `react-native-track-player` | **Ruled out** — V4 launch-crashes on RN 0.85 + New Arch; paid V5 adds a video A/V-sync risk. We use patched `react-native-video` as the single engine. |

### Status / follow-ups
- **iOS lock-screen CLIP parity is NOT done.** iOS clip-end stays JS-driven; the clip-relative timeline +
  native auto-advance are **Android-only**. To finish iOS: mirror the offset in
  `NowPlayingInfoCenterManager.swift` (duration = clipDur, elapsed = `abs − clipStart`, position command
  `+ clipStart`, clip-end in the existing 250 ms time observer).
- **Intentional limitations:** repeat-**all** wrap-around at the very end of the queue while backgrounded, and
  the very first track before its queue JSON arrives, fall back to JS (foreground) — accepted.

---

## Beat-Synced Visualizer (Tier B)

The floating-player wave (`src/components/WaveVisualizer.tsx`) rides the song's **actual loudness**
at the live position — swelling in loud sections, calming in quiet ones — instead of a constant
decorative ripple (Tier A). Every decision below was made deliberately; treat them as locked-in.

### The data — ONE source of truth
- Peaks are **pre-computed once** and stored in **`tracks.waveform_peaks`** (jsonb):
  `{ version, hz, peaks: number[] }` — `peaks` normalized `0..1`, **~10 buckets/sec**, spanning the
  **FULL track** in absolute seconds (so clipped reposts index correctly by `positionRef`).
- The renderer maps position→bucket: `idx = floor(positionSec * hz)`, lerp between `peaks[idx]` and
  `peaks[idx+1]`. A JS interval (~25 Hz) reads `positionRef` and eases the Reanimated `amp` shared
  value; the `<Path>` / phase-scroll / paused-flatten are otherwise **unchanged from Tier A**.

### Decode is PRE-COMPUTED, ON-DEVICE, and a one-shot util
- **Decoder:** `react-native-audio-api`'s standalone `decodeAudioData(source, sampleRate)` — the
  phone's **hardware** decoder, resampled to 8 kHz mono; RMS → normalized buckets in
  `src/services/waveform.ts` (pure DSP, **no Supabase import** → no cycle).
- **Why on-device + pre-computed (not real-time, not server):**
  - **Real-time native (ExoPlayer/AVPlayer audio taps) — RULED OUT ("Tier C").** Would touch the
    fragile patched single engine and diverge per platform.
  - **Supabase edge function — RULED OUT.** Edge has a hard **2 s CPU limit** and **no ffmpeg**, so
    full-song WASM decode routinely fails (a 4-min decode is ~2.5–8 s CPU). Don't revisit unless those
    limits change. The hardware decoder has no such cap and covers every format the engine plays.
  - `decodeAudioData` is a **one-shot decode** (NO `AudioContext`, no playback, no MediaSession), so it
    **never touches `GlobalAudioPlayer` / the patched `react-native-video`**. Keep it that way.

### AUDIO-ONLY — never analyze video
- `decodeAudioData(videoUrl)` pulls the **whole file** into memory via RN networking
  (`ResponseBody.bytes()`; the dev net-inspector also base64s it) → **`OutOfMemoryError`** → the OS
  kills the process (signal 9; **no JS log, debugger drops**). An mp3 is a few MB; a video is tens-to-
  hundreds of MB. Analysis is gated to `mediaKind === 'audio'` at **both** call sites
  (`FloatingPlayer` lazy fetch + `createTrack` upload kickoff). Video keeps the decorative wave.

### Plumbing — fetch by trackId, never thread through NowPlayingInfo
- Only the **active** track needs peaks, so `FloatingPlayer` resolves them **by `nowPlaying.trackId`**
  via `getOrAnalyzeWaveform` (in-memory cache → DB → analyze-on-device + persist). Do **not** add
  `waveform_peaks` to `NowPlayingInfo` / `feedPostToNowPlaying` / the feed `.select(...)` queries — a
  per-post array would bloat every feed payload for data only the playing track uses.
- `getWaveformPeaks` / `backfillWaveformPeaks` (`src/services/tracks.ts`) **mirror
  `backfillTrackDuration`**: fire-and-forget, never throw, idempotent via `.is('waveform_peaks', null)`,
  owner-RLS (`tracks_update_own`). At upload, analyze the **LOCAL** file (no re-download); old audio
  tracks lazy-backfill on first play.

### Do-not-break

| Trap | Rule / Why |
|---|---|
| Analyzing video | NEVER. `decodeAudioData(videoUrl)` → whole-file download → `OutOfMemoryError` → process killed. Gate to `mediaKind === 'audio'`. |
| Second audio engine | `decodeAudioData` is decode-only (no `AudioContext`/playback). Never wire `react-native-audio-api` as a player — that would be a second engine (see single-engine rule). |
| Edge function for decode | Ruled out — 2 s edge CPU cap + no ffmpeg. Decode stays on-device. |
| Threading peaks through the feed | Fetch by `trackId` only. Don't add the array to `NowPlayingInfo`/feed selects. |
| Hard-failing the wave | All DB/decode calls are fail-safe → fall back to the **decorative** wave (column missing, decode fails, video). Never throw to the UI. |
| Persistence skipped silently | `backfillWaveformPeaks` must keep the `.is(..., null)` idempotency + owner-RLS, like `backfillTrackDuration`. |

### Status / follow-ups
- **Video has no synced wave** (decorative only). Re-enabling it needs **server-side or streaming-demux**
  audio extraction — NOT a full client download.
- **iOS audio-session non-interference is UNVERIFIED** (Android-first). Before shipping iOS, confirm
  `decodeAudioData` doesn't claim `AVAudioSession` (it shouldn't — it's a pure decode) and so can't
  silence the engine / break background audio.
- Migration `supabase/migrations/20260611000000_tracks_waveform_peaks.sql` is **applied** (column +
  owner-RLS verified).

---

## Release Build

```bash
# 1. Bump versionCode and versionName in android/app/build.gradle
# 2. Build
cd android && ./gradlew bundleRelease
# 3. Output: android/app/build/outputs/bundle/release/app-release.aab
# 4. Upload to Play Console → Internal testing → Create new release
```

Keystore: `android/app/livil-release.keystore` (alias: `livil`, credentials in `~/.gradle/gradle.properties` — never in repo).

---

## Play Store

- **Developer**: Livil Labs (`vvk.iitkgp@gmail.com`)
- **Package**: `com.livil`
- **Status**: Closed testing (versionName `2.0.4`, versionCode `69` — bump both before each release)
- **GitHub**: https://github.com/vvkiitkgp/livil

---

## Common Issues & Fixes

| Issue | Fix |
|---|---|
| Keyboard dismisses immediately | Use `FormInput`, never lift focus state to parent |
| Build fails — wrong Java version | `sdk default java 17.0.9-tem` |
| "No space left on device" | Clear `~/.gradle/caches` and unused `node_modules` |
| Version code already used on Play Store | Bump `versionCode` in `build.gradle` |
| Touch/gesture issues on Android 15 | NativeStack + `gestureEnabled: false` + disable predictive back |
| Google OAuth shows "additional setup" alert | Needs `react-native-app-auth` — not yet implemented |
| Native (`react-native-video`) change not taking effect | Re-capture the patch (`npx patch-package react-native-video --include '^(ios/\|android/src/\|src/\|lib/)'`) + full `./gradlew` rebuild — Metro reload won't pick up native code |
| Duplicate "carousel" media notifications | Keep ONE `showNotificationControls` `<Video>` (GAP); post/cancel the notification with the **raw** player `hashCode` (`notifIdFor`), see Playback section |
| Lock-screen scrubber shows full track, not the clip | `currentClipJson` prop must reach native (mirror in spec + `lib/types`); clip is presented by `ClipForwardingPlayer` (Android only) |
| App crashes (silently, no JS log) when a VIDEO plays | The visualizer tried to `decodeAudioData(videoUrl)` → whole-file download → `OutOfMemoryError` → process killed. Waveform analysis must stay gated to `mediaKind === 'audio'`; see Beat-Synced Visualizer section |

---

## Environment

- **Node**: v20.11.0
- **Java**: 17.0.9 Temurin (via SDKMAN)
- **Android SDK**: `/Users/vamsi/Library/Android/sdk`
- **Emulator**: Medium Phone API 35 (Android 15, arm64)
