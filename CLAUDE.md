# Livil — Claude Code Guidelines

## What is Livil?
Livil is a social music platform — think Spotify + Discord + SoundCloud.
Users can upload music (audio + video), listen together in real time (Jam rooms), chat with friends, build shared playlists, and follow each other's listening activity.

## Rules
- Always follow the confirmed dependency versions below. Never suggest upgrading or downgrading without explicit instruction.
- Always use `FormInput` (`src/components/FormInput.tsx`) for text inputs — never create raw `TextInput` with focus state lifted to parent. **Why**: on Android 15 + Fabric, lifting focus state causes re-renders that remount the `TextInput` and immediately dismiss the keyboard.
- Always use `createNativeStackNavigator` — never `createStackNavigator`.
- Always keep dark theme (`#0A0A0F` background, `#7C3AED` purple accent). No light mode.
- New screens go under `src/screens/` following the existing structure.
- When adding navigation routes, update `src/navigation/types.ts` with the new route params.
- Never install new packages without checking compatibility with RN 0.85.3 + New Architecture (Fabric) first.
- Bump `versionCode` in `android/app/build.gradle` before every Play Store release.
- Never commit `android/app/livil-release.keystore` or any passwords/credentials.
- **Never use `Alert.alert`.** For confirmations ("Are you sure?", destructive actions, decisions) use `ConfirmActionModal` (`src/components/ConfirmActionModal.tsx`) or a bespoke modal matching the `NotificationPermissionModal` / `JamExitModal` template. For errors, warnings, and short status messages use the toast — `useToast()` from `src/contexts/ToastContext.tsx` — with `kind: 'error' | 'success' | 'info'`. **Why**: `Alert.alert` renders the OS dialog which clashes with the dark theme and looks unprofessional. **How to apply**: when adding a feature that needs user feedback, reach for `ConfirmActionModal` or `useToast` first; only if neither fits, build a new modal in the same visual style.
- **Playback is a SINGLE engine.** `GlobalAudioPlayer` (`src/components/GlobalAudioPlayer.tsx`) is the ONLY `<Video>` with `showNotificationControls` — the sole MediaSession / lock-screen owner — and it plays the audio of **every** post (audio via `audioUrl`, video via `videoUrl` on a hidden 0×0 surface). `FullScreenPlayer` is a **muted, foreground-only** video frame that slaves its picture to the engine's position. **Never add a second `<Video>` with `showNotificationControls` (or a second audio engine)** — it resurrects the notification "carousel" + audio↔video desync. See **Playback & Lock-Screen Media Controls** below.
- **`react-native-video` is PATCHED** (`patches/react-native-video+6.19.2.patch`, pinned to exact `6.19.2` — do not float the `^`). After ANY edit under `node_modules/react-native-video/`, re-capture with `npx patch-package react-native-video --include '^(ios/|android/src/|src/|lib/)'` (the `--include` keeps build artifacts out of the diff) **and do a full native rebuild** (`cd android && ./gradlew …`) — a Metro reload does NOT pick up native changes.

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
"react-native-reanimated": "4.0.3",
"react-native-worklets": "0.4.2",
"react-native-gesture-handler": "2.22.0",
"react-native-safe-area-context": "5.7.0",
"react-native-screens": "4.10.0",
"@react-navigation/native": "7.2.2",
"@react-navigation/native-stack": "7.x",
"@react-navigation/stack": "7.8.11",
"@react-native-async-storage/async-storage": "1.23.1",
"@supabase/supabase-js": "^2.x"
```

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
│   │   └── ClipRangeSlider.tsx    ← clip-window editing (needs the FULL track)
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

- **Project URL**: `https://itmtmeobsclhyczidjct.supabase.co`
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

| Token | Value |
|---|---|
| Background | `#0A0A0F` |
| Surface | `#12121A` |
| Primary accent | `#7C3AED` (purple) |
| Secondary accent | `#00BFFF` (neon blue) |
| Text primary | `#FFFFFF` |
| Text secondary | `#888888` |
| Danger | `#FF4444` |
| Success | `#00C853` |

- Purple CTAs with glow shadow (`shadowColor: '#7C3AED'`)
- Animated purple border on input focus
- Bottom tab bar: Home, Search, Library, Profile

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
| `react-native-track-player` | **Ruled out** — V4 launch-crashes on RN 0.85 + New Arch; paid V5 adds a video A/V-sync risk. We use patched `react-native-video` as the single engine. |

### Status / follow-ups
- **iOS lock-screen CLIP parity is NOT done.** iOS clip-end stays JS-driven; the clip-relative timeline +
  native auto-advance are **Android-only**. To finish iOS: mirror the offset in
  `NowPlayingInfoCenterManager.swift` (duration = clipDur, elapsed = `abs − clipStart`, position command
  `+ clipStart`, clip-end in the existing 250 ms time observer).
- **Intentional limitations:** repeat-**all** wrap-around at the very end of the queue while backgrounded, and
  the very first track before its queue JSON arrives, fall back to JS (foreground) — accepted.

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
- **Status**: Internal testing (versionName `1.0.27`, versionCode `32` — bump both before each release)
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

---

## Environment

- **Node**: v20.11.0
- **Java**: 17.0.9 Temurin (via SDKMAN)
- **Android SDK**: `/Users/vamsi/Library/Android/sdk`
- **Emulator**: Medium Phone API 35 (Android 15, arm64)
