<div align="center">

<img src="src/assets/livil-logo.png" alt="Livil" width="160" />

# Livil

### A social music platform — where listening is something you do *together*.

**Spotify’s player · Discord’s presence · SoundCloud’s creator feed** — in one app.

[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20iOS-7C3AED)](https://github.com/vvkiitkgp/livil)
[![React Native](https://img.shields.io/badge/React%20Native-0.85.3-00BFFF)](https://reactnative.dev)
[![Architecture](https://img.shields.io/badge/New%20Architecture-Fabric-7C3AED)](https://reactnative.dev/architecture/landing-page)
[![Backend](https://img.shields.io/badge/backend-Supabase-3ECF8E)](https://supabase.com)
[![Status](https://img.shields.io/badge/Play%20Store-Internal%20Testing%20v1.1.3-00C853)](https://github.com/vvkiitkgp/livil)

</div>

---

## What is Livil?

Most music apps are something you use *alone*. Livil is built around the opposite idea: **music is social**.

Creators upload their tracks (audio **and** video). Listeners follow each other, see what friends are playing in real time, drop into **Jam Rooms** to listen in sync, build **collaborative playlists**, react and comment, and share clipped highlights as **Stories** and **reposts** — all wrapped in a polished, dark, gesture-driven mobile experience with full lock-screen media controls.

It’s a creator network, a listening party, and a chat app fused into a single React Native codebase running on the **New Architecture (Fabric)**.

> **By the numbers:** ~37,500 lines of TypeScript · 28 screens · 40+ reusable components · 21 backend services · 30+ database migrations · shipping on the Google Play Store.

---

## 📱 Screenshots

> _Drop product screenshots / screen-recording GIFs here — feed, Jam Room, full-screen player, chat, profile. This is the first thing a recruiter or investor looks at._

| Home Feed | Jam Room | Player | Chat |
|:--:|:--:|:--:|:--:|
| _coming soon_ | _coming soon_ | _coming soon_ | _coming soon_ |

---

## ✨ Features

### 🎧 Listening & Playback
- **Unified player engine** for every post — audio tracks and the audio of video posts play through one source of truth.
- **Lock-screen & notification media controls** (play / pause / seek / next / prev) that keep working while the app is backgrounded — driven natively for reliability.
- **Clip-aware playback** — posts can play a clipped window of a track, with the lock-screen scrubber showing the *clip*, not the whole file.
- **Beat-synced waveform visualizer** — the floating player’s wave reacts to the song’s **actual loudness and frequency content**, decoded on-device (no server round-trip).
- **Queue, shuffle, repeat, recently-played**, and a floating mini-player that follows you across the app.

### 👥 Social & Real-Time
- **Jam Rooms** — listen together in real time; playback stays in sync across participants.
- **Live friend activity** — see what people are playing *right now* via presence + now-playing broadcasts.
- **Direct messages & group chats** — reactions, mentions, swipe-to-reply, typing/read state, and an inbox with request gating.
- **Follow graph & friend requests** — relationships, followers/following, and an activity center for notifications.
- **Push notifications** for messages, follows, likes, comments, and Jam invites.

### 🎵 Creating & Curating
- **Upload audio & video** with large-file streaming uploads.
- **Albums & Playlists** — collaborative, with per-item visibility, emoji / gradient cover art, and a collaborator picker.
- **Stories** — share ephemeral, clipped highlights.
- **Reposts** with custom clip windows.
- **Comments, likes, and reporting** with moderation hooks.

### 🔐 Accounts
- **Email/Password + Google Sign-In**, with a permanent-username onboarding flow.
- Profiles with avatars, bios, edit-profile, and rich profile grids.

---

## 🏗️ Engineering Highlights

The interesting parts aren’t the feature list — they’re the hard problems behind it. A few worth calling out:

- **Single-engine audio architecture.** Exactly one media-session owner powers playback for the entire app. An earlier two-engine design churned the OS MediaSession on every audio↔video boundary, producing duplicate “carousel” notifications and dropped skip events — consolidating to one engine eliminated an entire class of bugs.
- **Native background auto-advance.** Because Fabric defers JS-driven view commands while the app is backgrounded, track advancement and clip-end looping are handled **natively** (Android foreground service) so the lock screen stays correct even when JS is asleep.
- **Patched `react-native-video`.** Lock-screen clip-relative timelines required patching the native player and threading new props through the codegen spec — a precise, version-pinned native patch captured in `patches/`.
- **On-device, fail-safe audio analysis.** The loudness/frequency envelope behind the visualizer is computed with the phone’s hardware decoder via a one-shot decode that never touches the playback engine. It’s strictly audio-only (decoding a video’s bytes would OOM the process) and degrades gracefully to a decorative wave on any failure.
- **Real-time backend on Supabase.** Postgres with row-level security, realtime publications for chat/presence/Jam, RPCs for atomic operations, and storage buckets for media — all schema-managed through 30+ versioned migrations.

> A deep, battle-tested architecture doc lives in [`CLAUDE.md`](CLAUDE.md), capturing the “why” behind every hard-won decision.

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Mobile** | React Native **0.85.3** · New Architecture (Fabric) · TypeScript · no Expo |
| **Navigation** | React Navigation v7 (native-stack) |
| **State / Realtime** | React Context + Supabase Realtime |
| **Backend & Auth** | Supabase (PostgreSQL · Auth · Realtime · Storage) |
| **Media** | Patched `react-native-video` · `react-native-audio-api` (on-device decode) · `react-native-svg` |
| **Animation / Gesture** | Reanimated 4 · Worklets · Gesture Handler |
| **Auth providers** | Email/Password · Google OAuth |

---

## 📂 Project Structure

```
livil/
├── src/
│   ├── screens/          # 28 screens — auth, feed, player, chat, jam, albums, profile…
│   ├── components/       # 40+ reusable UI + the single playback engine
│   ├── services/         # 21 backend service modules (posts, messages, jam, uploads…)
│   ├── contexts/         # playback, jam, relationships, stories, toast…
│   ├── navigation/       # native-stack navigators + session guard
│   └── theme/            # dark design system
├── supabase/migrations/  # 30+ versioned schema migrations
├── patches/              # native react-native-video patch (lock-screen controls)
└── android/ · ios/       # native projects
```

---

## 🎨 Design System

A single, consistent dark aesthetic — no light mode.

| Token | Value |
|---|---|
| Background | `#0A0A0F` |
| Surface | `#12121A` |
| Primary accent | `#7C3AED` (purple) |
| Secondary accent | `#00BFFF` (neon blue) |
| Success / Danger | `#00C853` / `#FF4444` |

Purple CTAs with glow shadows, animated focus borders, and a floating bottom tab bar.

---

## 🚀 Getting Started

> Requires the [React Native environment](https://reactnative.dev/docs/set-up-your-environment) (Node 20, Java 17, Android SDK / Xcode).

```sh
# 1. Install dependencies
npm install

# 2. Start Metro
npm start

# 3. Run on a device/emulator (in a second terminal)
npm run android
# or
npm run ios     # requires: bundle install && bundle exec pod install
```

Supabase keys are configured in `lib/supabase.ts`.

### Release build (Android)

```sh
# Bump versionCode + versionName in android/app/build.gradle first
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

---

## 🗺️ Roadmap

- **iOS lock-screen clip parity** — clip-relative timeline + native auto-advance (Android-complete; iOS in progress).
- **Cloudflare R2** media storage migration.
- **Synced waveform for video** posts (currently audio-only).
- Web uploader for large 4K media.

---

## 📦 Status

Livil is in **active development** and live on **Google Play (Internal Testing)** — package `com.livil`, currently `v1.1.3`.

<div align="center">

**Built with React Native · TypeScript · Supabase**

</div>
