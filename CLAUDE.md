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
- Never install new packages without checking compatibility with RN 0.78.0 first.
- Bump `versionCode` in `android/app/build.gradle` before every Play Store release.
- Never commit `android/app/livil-release.keystore` or any passwords/credentials.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Mobile App | React Native 0.78.0 (no Expo) |
| Language | TypeScript |
| Navigation | @react-navigation/native-stack (v7) |
| Backend/Auth | Supabase |
| Database | Supabase PostgreSQL |
| File Storage | Cloudflare R2 (planned) |
| Real-time | Socket.io (planned) |

---

## Confirmed Working Dependency Versions (DO NOT CHANGE)

```json
"react-native": "0.78.0",
"react": "19.0.0",
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
│   │   └── FormInput.tsx          ← always use this for text inputs
│   └── theme/
│       └── colors.ts
├── lib/
│   └── supabase.ts                ← Supabase client config
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
- **Status**: Internal testing (v1.0.1)
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

---

## Environment

- **Node**: v20.11.0
- **Java**: 17.0.9 Temurin (via SDKMAN)
- **Android SDK**: `/Users/vamsi/Library/Android/sdk`
- **Emulator**: Medium Phone API 35 (Android 15, arm64)
