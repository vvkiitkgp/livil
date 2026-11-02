---
tier: 4
owner: principal-client
consumers: [CA, TR, ALL]
last_verified: 2026-11-02
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0001, 0004, 0007, 0012, 0013]
---

# PROP-0011 — Disappearing (20-minute) photos and videos in chat

| | |
|---|---|
| **Status** | **Draft** · Ratified · Rejected · Deferred · Implemented |
| **Date** | 2026-11-02 |
| **Domain** | client · data · security · playback · platform |
| **Design** | Claude Design canvas "5-minute photos & videos in chat" (drawn at 5 min; now 20) (10 screens, owner-private): `https://claude.ai/artifact/GHQnTvLMnqtc5H3GarWD7P` |
| **Branch** | `feat/disappearing-media` (off `main` at `b4ae53a`) |

---

## What it is

From the chat composer a member opens Livil's own camera — **tap the shutter for a photo,
hold it for a video** (stops itself at 10 s) — or picks from the gallery (a gallery video
longer than 10 s goes through a trim screen), previews it and sends it. No explanatory copy
anywhere: the running timer on the bubble teaches the rule.
**The file lives for exactly 20 minutes from the moment it is sent — opened or not** (5 in the first build; owner raised it to 20, 2026-11-02, `20261118000002`).

- Recipients' apps **download it as soon as it arrives**, so it opens instantly and offline.
  Open and reopen freely until the 20 minutes are up — **the sender too** (owner, 2026-11-02).
- While it is open, **screenshots and screen recording are blocked**.
- The viewer has **Save to phone**. A save is announced in the chat under the bubble:
  "Saved to phone by" + the saver's avatar.
- At 20 minutes the server deletes the file and every app deletes its downloaded copy. The
  bubble turns to *Expired* and does nothing on tap. The **metadata stays forever**: type,
  size, dimensions, duration, sent time, who saved it.
- Someone who does not open Livil within the 20 minutes misses it. That is the product.

Owner decisions (2026-11-02): unlimited opens inside the window · screenshots stay blocked
even though saving is allowed · gallery videos over 10 s are trimmed, not refused · built in
the main checkout.

## Design

### Message — a TEXT message carrying metadata, never a new `kind`

```jsonc
{ "kind": "text",
  "body": "📷 Photo · Update Livil to view",     // or "🎬 Video · Update Livil to view"
  "metadata": { "media": { "v": 1, "type": "photo" | "video", "object": "<conversation_id>/<uuid>.jpg|.mp4",
                           "mime": "image/jpeg" | "video/mp4", "w": 1200, "h": 1600, "bytes": 412345,
                           "duration_ms": 8000 /* video only */ } } }
```

- Same compatibility shape as GIFs (`src/utils/chatGif.ts`): **every build in the stores
  renders `body` for `kind = 'text'`**, so old apps show a readable line and have no route to
  the file. A new `kind` needs the CHECK widened and old builds draw an unknown kind empty.
- **Expiry = `messages.created_at + 20 min`.** `created_at` is stamped by the server
  (`trg_messages_stamp_created_at`, `20261105000000`), so a client cannot extend it. No
  expiry column — nothing to keep in sync.
- `metadata` is immutable after insert (`messages_freeze_identity`, `20261107000000`). Correct:
  it is the permanent record the owner asked for. Mutable state lives in its own table.

### Data — `chat_media_saves`

`(message_id → messages on delete cascade, user_id → profiles on delete cascade, saved_at,
primary key (message_id, user_id))`, RLS on, in `supabase_realtime` so the sender sees
"Saved by" appear live.

- **SELECT:** members of the message's conversation.
- **INSERT:** `user_id = auth.uid()`, member of the conversation, not the sender, the message
  carries `metadata.media`, and `now() < created_at + 21 min` (20 min + 1 min clock grace — the
  local copy is gone at 20).
- **GRANT** `select, insert` to `authenticated`, all to `service_role`, in the same migration
  (no auto-grants on new tables since 2026-10-30; CI's replay blanket-grants and would hide it).
- Honest limit: a modified client can save without inserting the row. The marker is what
  honest clients show, not proof.

### Storage — new **private** bucket `chat-media`

- `public = false`, `file_size_limit = 25 MB` (10 s of phone video), `allowed_mime_types =
  {image/jpeg, video/mp4, video/quicktime}`. Declared in the migration (ADR-0007/0012).
- **INSERT** for `authenticated`: first path segment is a conversation the caller is a member
  of **and** `can_write_to_conversation()` passes (the `msg_insert` test).
- **No SELECT, UPDATE or DELETE for `authenticated`.** Nobody downloads by path; the bytes are
  reachable only through a signed URL from the edge function.

### Edge function `chat-media`

SQL cannot mint a Storage signed URL, hence a function (ADR-0004 exception, like `gifs`).

- `status` → `{ enabled }` from env `CHAT_MEDIA_ENABLED`. Missing function / error → the app
  hides the camera button (fail-safe for a new app on an unapplied backend; `useGifsEnabled`
  pattern).
- `link { message_id }` as the caller: member of the conversation · message not deleted ·
  `metadata.media.object` starts with `<conversation_id>/` (else a client could point at another
  chat's file) · `now() < created_at + 20 min`. Returns a signed URL whose **TTL is the time
  left**, so no link outlives the window even before the sweep runs.
- `sweep` (service role, every minute via `pg_cron` + `pg_net`, the transcoder-doorbell
  pattern of `20261117000000`): delete **every object in the bucket older than 20 minutes** —
  no join needed, which also removes orphans from uploads whose message insert failed. Uses
  the Storage API (direct `DELETE` on `storage.objects` is refused by Supabase).

### Client

| Piece | Notes |
|---|---|
| Switch | `useChatMediaEnabled()` → `chat-media` `status`. |
| Composer button | Camera icon inside the message box, hidden while typing / searching / switch off. |
| Source sheet | `SheetModal fit`: Camera · Choose from gallery. Titles only. `KeyboardController.dismiss()` first. |
| Camera | **Deferred to the next release** (owner, 2026-11-02). This release keeps the system camera (`image-crop-picker` `openCamera`, photo only, with the platform's own confirm screen). Next release: **Livil's own camera** — iOS AVFoundation + Android CameraX, full-screen (aspect-fill, photo cropped to the screen's aspect), tap = photo, hold = video, straight into the Send/Retake preview. Chosen over `react-native-vision-camera` 5.2.4 (needs `react-native-nitro-modules` + `react-native-nitro-image`) because of its open crash on opening the camera on iOS 17/18 with RN 0.85 + New Architecture ([#4211](https://github.com/margelo/react-native-vision-camera/issues/4211), unfixed as of 2026-11-02); Livil supports iOS 15.1+. CameraX current stable: 1.5.3. |
| Gallery | **iPhone: Apple's own picker** (`PHPickerViewController`, `ios/livil/LivilPhotoPicker.m` — the Photos app's look, no library permission; ImageIO downsample ≤1600 px, metadata-free JPEG). Since 2026-11-02 the same picker serves EVERY iPhone gallery pick: profile photo and album cover (then image-crop-picker's `openCropper`, falling back to its old picker if the cropper cannot open the photo), upload cover art / thumbnail (same), and upload videos (the original file, untouched). Android, and an iPhone build without the module: `react-native-image-crop-picker` `openPicker` (its iOS gallery is the third-party QBImagePicker, which asks for the whole library). Photos re-encoded ≤1600 px JPEG q0.8. |
| Trim | New route `ChatMediaTrim`, gallery videos over 10 s only: muted preview + 10 s window on a strip; export via native. |
| Preview | New route `ChatMediaPreview` (`fullScreenModal`). |
| Upload + send | Stream the file to `chat-media` (never `arrayBuffer`), then insert the message. Push text "📷 Sent a photo" / "🎬 Sent a video" (`dispatchMessagePush`, client-side). |
| Prefetch | On a media message on screen and inside the window: `link` → written as a FILE under the app's private folder (`<root>/chat-media/<message_id>/`, via the existing `LivilStudioFiles` module — no new native code for photos). Tapped before it is ready: a spinner in the bubble, the viewer opens when it is. Sender keeps the picker's file. |
| Bubble | `ChatMediaBubble`: countdown (server-time offset), Expired, "Saved to phone by" avatars. |
| Viewer | New route `ChatMediaViewer` (`transparentModal`) — **a navigation screen, not an RN `<Modal>`**: an Android Modal is its own Dialog window, which `FLAG_SECURE` on the Activity does not cover. Photo from the local copy; Save button. Opens by growing out of the tap point and closes back into it. Tap = the sender's next live photo sliding in from the right (left third: previous, from the left; past the last: close), swipe down = close, pinch = Instagram-style zoom around the fingers (a finger left down drags it; all fingers up → back to 100%). An expiring photo moves on to the next. |
| Expiry | A timer deletes local files at expiry while the app is open. **Leaving the app deletes every local copy at once** (`AppState` → `background`), and on return the photos still in their window are fetched again, so they keep opening instantly while the app is in use; nothing is fetched while backgrounded, and a download that lands then is deleted, not kept. Owner decision 2026-11-02, over a native timed delete: phones do not reliably run an app's timers in the background, and iOS cannot at all. Android also reports `background` under its own dialogs, so Save pins its copy through the Android 7–9 storage-permission prompt (`pinChatMedia`). A sweep at launch deletes anything a killed run left behind. Tests: `src/services/__tests__/chatMediaBackground.test.ts`. |
| Inbox preview | `message_preview()` gains the two labels → "📷 Sent a photo" / "🎬 Sent a video". |

### Video playback — through the single engine

A chat video has sound. ADR-0001 allows one audio source, so the viewer reuses the **story
clip session over GAP** (ADR-0013): audio through the engine, picture from a muted frame,
no MediaSession. **Needs principal-playback review before it lands.**

### Native — own module `ChatMediaKit`, no new npm packages

| Method / view | Android | iOS |
|---|---|---|
| `setSecure(on)` | `FLAG_SECURE` on the Activity window | — (see `SecureView`) |
| `SecureView` (native view) | pass-through | children hosted in a `UITextField(isSecureTextEntry)` secure layer → left out of screenshots, recordings, mirroring; "Photo hidden" placeholder behind it. Relies on UIKit internals: **re-verify every iOS release.** Backstop: hide while `UIScreen.isCaptured`. |
| `download(url, path)` | OkHttp (already in the app) | `URLSession` download task |
| `saveToGallery(path, type)` | `MediaStore` (API 29+ needs no permission; minSdk 24 → `WRITE_EXTERNAL_STORAGE` `maxSdkVersion=28`) | `PHPhotoLibrary` add-only |
| `trimVideo(src, startMs, endMs)` | Media3 **Transformer** `1.8.0` (matches RNV's media3) — one new Gradle dependency | `AVAssetExportSession` |

Codegen spec beside `src/specs/VideoNativeComponent.ts`. A library alternative
(`react-native-blob-util`, `@react-native-camera-roll/camera-roll`, a trim package) would each
need the RN 0.85.3 + New Architecture check `CLAUDE.md` requires; four small native pieces
of our own are less risk than four dependencies.

### Permissions — iOS rebuild

- `NSPhotoLibraryAddUsageDescription` — **new** (Save to phone).
- `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` — add chat photos/videos.
- `NSMicrophoneUsageDescription` — today says "you will never be asked for microphone
  access"; recording video asks. **Must be rewritten** (guideline 5.1.1).
- Android: `CAMERA`, `READ_MEDIA_IMAGES` present; add `RECORD_AUDIO` (in-app video has
  sound), `READ_MEDIA_VIDEO`, and `WRITE_EXTERNAL_STORAGE` with `maxSdkVersion="28"`.

## Production compatibility — all additive

| Change | Apps in the stores |
|---|---|
| `chat_media_saves`, bucket + policies, `message_preview` cases, cron | Never referenced; the preview cases match only the new labels. |
| Edge function `chat-media` | Never called. |
| A media message on an old app | "📷 Photo · Update Livil to view". No route to the file. |
| New app before backend | `status` fails → no camera button. |

## Build order (commits on the branch)

1. Backend — migration + `supabase/functions/chat-media`.
2. App, photo path — switch, service, composer button, sheet, gallery pick, preview, bubble, viewer, prefetch, expiry.
3. Native `ChatMediaKit` — secure, `SecureView`, download, save, trim (Android + iOS).
4. Camera — **next release**: Livil's own native camera (tap photo / hold video).
5. Video — trim screen, viewer over the story clip session.
6. Info.plist / manifest strings, tests, KB.

## Build status (2026-11-02)

| Step | State |
|---|---|
| 1. Backend | **Applied + deployed** (`20261118000000`, `…01` grants; `…02` 20 minutes: written, not yet applied). `20261118000000_chat_media.sql` (local replay + `supabase/tests/rls/chat-media.test.sql`, 25 checks; weakening the 6-minute save rule fails #10) and `supabase/functions/chat-media` (16 Deno tests). |
| 2. App, photo path | **Built.** Camera button (only when `status` says enabled), sheet, gallery photo, preview, send, running-timer bubble, Expired, "Saved to phone by" (display + realtime), received-photo prefetch (in memory), viewer that closes itself at 5:00, push and inbox text. "Camera" opens the system camera for a photo until step 4. No Save button until step 3. |
| 3. Native (part) | **Built on `feat/chat-media-secure-save`.** Capture blocking — iPhone: `LivilSecureImage` draws the photo in a secure-text-field canvas (screenshots/recordings show a "Photo hidden" card); Android: `FLAG_SECURE` on the window while the viewer is open. Save to phone — `LivilChatMedia.saveToPhotos` (iOS add-only Photos access, `NSPhotoLibraryAddUsageDescription`; Android MediaStore → Pictures/Livil, `WRITE_EXTERNAL_STORAGE` ≤ API 28), then `chat_media_saves` so the chat shows "Saved to phone by". Recipients only. |
| 4–6 | Camera next release; video not started. |

## Tests

- Jest: `chatMediaFrom(metadata)`; countdown/expired maths with a clock offset; bubble states;
  composer button visibility.
- Local migration replay; RLS: member can't read the bucket; save insert refused after 21 min,
  by the sender, by a non-member.
- Function: `link` after 20 min → 410; wrong-conversation object → 400; non-member → 403;
  TTL ≤ time left. Sweep deletes only objects older than 20 min.
- Real phones: screenshot refused (Android) / placeholder (iPhone); recording black /
  placeholder; offline open after prefetch; file gone from the phone after 20 min; Save → gallery
  + marker on both phones; keyboard open → camera button works on first tap.
