---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-30
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [ADR-0018, ADR-0019, ADR-0020, ADR-0033, ADR-0034, ADR-0035]
---

# ADR-0036 — Publish a Studio render through the unchanged Upload path, gated before staging, with no schema change

| | |
|---|---|
| **Status** | **Proposed** — awaiting human ratification. Render format and rights copy **resolved by the owner 2026-10-30** (see Escalated) |
| **Date** | 2026-10-30 |
| **Domain** | data |
| **Decided by** | board debate — principal-data, principal-security, principal-platform, principal-client; adversarial-critic. Human ratifies |

---

## Context

Livil Studio ([ADR-0034](0034-studio-exclusive-audio-ownership.md),
[ADR-0035](0035-studio-pitch-correction-route.md)) ends by rendering **one ordinary audio file**.
The post page is out of scope. The question here is what must change in the upload, rights and
permission paths so that file can be published safely. The question is this narrow on purpose.

Facts. **Verified by reading unless marked:**

| Fact | Evidence |
|---|---|
| `createTrack` requires a title, an audio file, **a cover image**, at least one uploader role, and the streaming grant | `src/services/tracks.ts:500-521` |
| The whole-song scan runs on uploads. A match only *asks*; the only path that stops a publish is the uploader cancelling. The scan is client-run and fails open | `tracks.ts:705-738`, `shared/services/copyrightScan.ts:24-33` |
| Covers are not expected to match, by design | `supabase/functions/scan-upload/app.ts:36-46` |
| Scan limits: 100 chunks (about 20 min); a 50 s provider download timeout records `failed` and the post publishes anyway; 20 whole-song scans per user per day, after which it downgrades to a quick check | `app.ts:121-139, 368-373` |
| **Audio stages the moment a file is set** (uploaded to publicly readable storage, a `tracks` row written, and AudD sent a link before Post). Video already waits for an explicit confirm (`confirmedVideo`) | `UploadScreen.tsx:584-599, 744-747`, `tracks.ts:939-1010`, `privacy-policy.html:568-569` |
| `Upload` takes no route params today | `src/navigation/types.ts:22` |
| `MIN_TRACK_SECONDS = 10`. `MAX_TRACK_SECONDS` (15:00) is **not enforced in the phone app** | `shared/constants/media.ts:10-22` |
| A staged, never-posted row is picked up by the transcoder (it selects any null `transcode_status` and does not check that a post exists). `sweepStagedUploads` runs only when Upload mounts, for the same account on the same phone. `sweepAbandonedUploads` matches only `pending:%` | `scripts/transcode-media.mjs:207-214`, `UploadScreen.tsx:581`, `tracks.ts:182-193` |
| The transcoder encodes only lossless audio; lossy audio at or under 400 kbit/s is probed and skipped. The "new song from a friend" push waits for that pass or 30 min | `transcode-media.mjs:55-56`, migration `20261116000000` |
| **The `isLosslessUrl` guard** (which stops a listener's phone downloading a whole WAV/FLAC to draw the wave) **is absent from 2.1.3 (77) and every earlier build.** `minimum_build` is 0, so those builds are still allowed. Its PR (#296) names the failure: whole-file download → `OutOfMemoryError` on a listener's phone | `git grep isLosslessUrl` at each `release:` commit (present at 837d11b, f1a3089, 5207927; absent at 1c56cd0, checked by the moderator), `app_update_policy` migration |
| Android has no `RECORD_AUDIO`. iOS `NSMicrophoneUsageDescription` says "Livil does not record audio … you will never be asked for microphone access" | `AndroidManifest.xml`, `ios/livil/Info.plist:62-73` |
| The audio-api recorder writes only to `Document` or `Cache`. iOS `Document` maps to `NSDocumentDirectory`, which iCloud backs up. Android `Document` is internal `filesDir`, and `allowBackup="false"`. `UIFileSharingEnabled` is not set | `types.d.ts:24-33`, `FileOptions.mm:182`, `AndroidManifest.xml:45` |
| No filesystem package is installed. audio-api has no list, delete or free-space API | `package.json`, audio-api typings |
| The hand-rolled deep-link parser handles only auth, post and profile. Verified links claim only `/p/` and `/@` | `RootNavigator.tsx:428-490`, `AndroidManifest.xml:74-107` |
| The rights copy "I made this recording myself. A cover counts" appears only after a match | `CopyrightMatchModal.tsx:151`, web `RightsDeclarationForm.tsx:97` |

## Decision

1. **No schema change. No provenance column ("made in Studio").** The reasoning of ADR-0018 §E
   applies unchanged:
   - a client-set flag is data, never proof;
   - it is empty for exactly the actor who matters;
   - it adds a second client-asserted signal for a fact the scan row already records.

   Adding it later is a nullable, add-only column. With nothing deployed on the backend there is
   no deploy-order or old-app risk.
2. **The render enters through the existing Upload screen and `createTrack`**:
   - `Upload` gains an optional `prefill: { audio, source: 'studio', draftId }`;
   - the cover comes from Upload's existing cover step;
   - duration is measured by Upload's preview player, as today (one source of truth).
3. **Nothing leaves the phone until the user confirms.** With `prefill.source === 'studio'`, no
   call to `stageMediaUpload` and no write to storage, `tracks` or `scan-upload` happens until a
   user gesture on Upload made after the render is shown. That step says in one line that the
   file will be uploaded and checked by an outside service. This reuses the `confirmedVideo`
   pattern, with no change to `tracks.ts`.
   - *Test:* stageMediaUpload is called 0 times before the confirm and exactly once after.
4. **Upload and Studio are never added to the deep-link parser.**
   - *Test:* `livil://upload` and `livil://studio` are rejected, so no web page can pre-fill an
     upload (P19).
5. **Render length is clamped on the rendered file:** at least `MIN_TRACK_SECONDS` and at most
   `min(STUDIO_CAP, MAX_TRACK_SECONDS)`, importing the shared constants. This is the only maximum
   on the phone path; nothing on the server enforces it. `STUDIO_CAP` is escalated in ADR-0034.
6. **Takes are deleted only after `createTrack` resolves with a row.** Never at hand-off, never
   on staging success. A failed Post, a cancel after a match, or an app killed mid-upload must
   leave the draft intact.
   - *Test:* a Post failure leaves the draft intact.
7. **What you hear is what you post.**
   - Muted takes, trimmed-away audio and soloed-off tracks are left out of the render graph
     entirely, not set to zero gain.
   - Upload's inline preview plays **the rendered file itself**.
   - Nothing beyond what the encoder writes goes into the file: no stems, no project JSON.
8. **Microphone permission:**
   - Android adds `RECORD_AUDIO` **only**: never `FOREGROUND_SERVICE_MICROPHONE` (ADR-0034).
   - iOS rewrites `NSMicrophoneUsageDescription` and the XML comment above it **in the same build
     whose code first requests the microphone, and not before.** The new text names the use: for
     example, "Livil uses the microphone only while you are recording in Studio. Nothing is
     uploaded unless you choose to post it." Older builds keep the old string, which stays true
     for them.
   - A CI check pairs the two: once `src/` requests recording permission, the purpose string must
     no longer say the app does not record.
   - The prompt is just-in-time, on the first Record tap, after a short in-app explanation. Never
     at launch or on opening "+ Post". If denied, show an in-screen state with a Settings link
     (no `Alert.alert`).
   - The privacy policy gains one sentence: raw takes stay on the device; only a render you
     choose to post is uploaded.
9. **Drafts on the device:**
   - Location: `Documents/studio/<userId>/<draftId>/`. That is where the recorder can write, and
     it is app-private on Android.
   - **On iOS, exclude the folder from iCloud backup** (`NSURLIsExcludedFromBackup`), or no copy
     may claim "uninstalling deletes your drafts".
   - Store `schemaVersion` and **relative** paths only, because the iOS container path changes on
     update. Paths read back from the JSON must resolve inside the studio root; reject `..` and
     absolute paths.
   - List only the signed-in user's folder; other users' folders are hidden, never playable.
   - Wipe the user's folder after an in-app account deletion succeeds; a failed wipe never fails
     the deletion. Deletion from the web or by email cannot reach the phone, and that is accepted.
   - Refuse to start a take with less than about 250 MB free. Running out of disk mid-take saves
     what was recorded.
   - **Upload drafts share this folder and these rules (owner, 2026-11-06):** `upload.json`
     beside the artist's own copy of each picked file, by relative name, listed with the Editor's
     drafts. Unlike the Editor they ship in the store app. They never store the streaming
     permission or a copyright answer, and nothing in one was uploaded: reopening starts the
     upload again. A post that succeeds deletes its draft; a failed one keeps it.
   - Takes are recorded as **WAV**: an M4A cut off by a crash mid-take may be unplayable
     (inferred), while WAV can be recovered.
   - List, delete-within-root, free-bytes and exclude-from-backup come from **a small app-owned
     Kotlin/ObjC module** (precedents: `SplashScreenModule.kt`, `LivilPasteboard.m`), not a
     third-party filesystem package and not ADR-0035's DSP module.
10. **Rights:**
    - Studio adds **no new bypass**: the scan is already client-run and fails open.
    - It does make laundering cheaper: a commercial track played from a speaker bleeds into the
      mic, gets pitch-shifted, and comes out as a render. Fingerprinting is pitch-sensitive.
    - **The board records an expected, unmeasured drop in detection rate for Studio output.** The
      AudD check must never be described as covering Studio output.
    - Studio collects and stores **no cover answer**; ADR-0019 §H stays open.
    - The bundled drum pack's licence must allow redistribution inside public user uploads, and
      the pack must be run through AudD before shipping. If it is in a fingerprint catalogue,
      every Studio post matches.
    - "Use headphones" is guidance, never a control.
11. **Transcoder and waveform need no change.**

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Provenance column** (`created_with='studio'`) | ADR-0018 §E, as above. It cannot measure the drop in detection rate either: Studio no-match rates are mixed up with originals and covers, which are expected not to match. Measuring that drop needs an offline bleed corpus. Honest cost of waiting: analytics days lost before the column exists cannot be filled in later |
| **Prefill and let staging run as for picked audio** (principal-client, Round 1) | A voice take recorded 30 s ago would reach public storage, the transcoder runner and AudD before Post. "Nothing leaves the phone until I post" is the user's reasonable assumption |
| **A separate "Continue to post" screen** (principal-security, Round 1) | Withdrawn. The existing `confirmedVideo` gate achieves the same with no new screen |
| **Studio uses the classic all-at-Post `createTrack` path** | It works, but the user waits about 45 s for the scan plus the full upload at Post (inferred). The gate is cheaper |
| **Upload stems or project JSON to the server** | A second media object outside `tracks_freeze_media`'s single-file model and outside what the scan examined (reopens ADR-0020 §A) |
| **Third-party filesystem package** | A new native pin plus a compatibility check against RN 0.85.3 + New Architecture, for four methods |
| **Drafts in Application Support** | The recorder cannot write there directly. Documents plus the backup exclusion gives the same protection |
| **Require headphones as a control** | Cannot be enforced |
| **Bleed detection in v1** | No evidence on what it would catch. Record the reduced detection rate instead |

## Consequences

**Good:** no backend change, so no old-app or deploy-order risk. Every existing check (the
scan, streaming grant, freeze trigger, transcoder and waveform) applies to Studio output because
Studio adds no new door.

**Costs:**

- One more confirm step before upload begins.
- A small app-owned native module, which means a native rebuild; the microphone permission
  forces one anyway.
- Two text changes that must ship in the same build as the recorder.
- Device-only tests for permission and storage.
- Covers become a designed path, raising the volume on open ADR-0019 §J1/§H questions without
  answering them.
- The detection-rate drop is accepted, not measured.

## Dissent

- **Render format: principal-data and principal-platform swapped positions between rounds.**
  Data moved from lossless to AAC; platform moved from AAC to lossless. Recorded as evidence that
  neither argument is decisive on technical grounds. See Escalated.
- **principal-data (Round 1), about 70% confident on no provenance:** an ops reviewer might want
  "this was a mic recording". Answered within the debate (an unverifiable flag has no evidential
  weight). principal-security conceded.
- **principal-security (Round 2): Studio must not be marketed as "sing covers" until counsel
  answers ADR-0019 §J1.** The adversarial critic answered that ADR-0019 already treats covers as
  first-class, and there is no evidence that marketing changes legal exposure. See Escalated.

## Escalated

**Owner resolution (2026-10-30), format: lossless (FLAC), "best quality".** Position B is adopted.
The render is the master. The existing transcoder (`.github/workflows/transcode-media.yml`)
already derives an AAC 256k copy of lossless audio next to it, so listeners stream the light copy
once it lands. Conditions carried from Position A, all required before launch:
1. Verify `FileFormat.Flac` output (or an equivalent FLAC encode) on both platforms.
2. Store `waveform_peaks` from the local render at upload, as Upload already does. Renders over
   `MAX_ANALYZE_SECONDS` (10:00) get no peaks, so for those either hold the post out of feeds until
   the AAC copy lands, or measure 2.1.3 (build 77) playing a 15:00 FLAC with null peaks and accept
   the result.
3. The length cap is 15:00 (ADR-0034 resolution).

**Owner resolution (2026-10-30), rights: covers are allowed; no counsel gate before launch.**
Position B is adopted. Reported posts are taken down through the existing report flow. The copy
"I made this recording myself" is still reworded so it is true for a cover (for example, "I
recorded this performance"); exact wording is a build-time detail.

> **Question:** What format is the Studio render uploaded in: AAC m4a at 256 kbit/s, or lossless (FLAC)?
> **Position A** (principal-data): AAC 256k. The "keep the original as master" ruling protects a
> master that already exists, while a render's master is the on-device project. AAC is exactly
> what the transcoder would produce, and it avoids WAV/FLAC's higher scan-timeout (unscanned)
> rate, the permanent extra storage, and listener buffering until the light copy lands.
> **Position B** (principal-platform): FLAC. Once takes are deleted after posting, the render
> *is* the only master, and AAC makes 256k a permanent ceiling. The transcoder already handles
> FLAC, and "upload both" is the owner's approved fix if upload size becomes a complaint.
> **Precise point of divergence:** whether the owner's compression ruling applies to a file the
> app itself created; and how much weight to give the **build ≤77 risk**. A FLAC render whose
> peaks are not yet stored makes 2.1.3 and older phones download the whole file to draw the wave,
> an `OutOfMemoryError` with no JS log, until the transcoder swaps in the AAC copy (about a minute
> with the doorbell, 4–7 h without it).
> **What would resolve it:** the owner's reading of their own ruling; the share of installs on
> build 77 or older (Play Console, App Store Connect); an emulator test of 2.1.3 playing a 15:00
> FLAC with null peaks. If FLAC wins, raising `minimum_build` above 77, or holding the render out
> of feeds until it is transcoded, becomes a condition.
> *Note:* the recorder can write M4A directly (`bitRate` option), so a single-take first slice
> needs no encoder for AAC. Its FLAC output (`FileFormat.Flac`) is unverified on both platforms.

> **Question:** Does the rights copy and Studio's marketing need counsel before launch?
> **Position A** (principal-security): not a slice-1 blocker. The copy "I made this recording
> myself" is partly false for a bleed recording and should be reworded, and Studio should not be
> marketed as "sing covers" until counsel answers ADR-0019 §J1.
> **Position B** (adversarial-critic): ADR-0019 already treats covers as first-class, so
> restricting marketing restricts the owner's own premise, with no evidence it changes exposure.
> **Precise point of divergence:** whether marketing a feature for covers changes Livil's legal
> position.
> **What would resolve it:** counsel's answer to ADR-0019 §J1. The copy rewording is the owner's
> call either way.

**Pre-existing defects surfaced, not created by Studio**, to be logged separately:

- the iOS privacy manifest's `NSPrivacyCollectedDataTypes` is an empty array, although the app
  collects email, uploads and messages;
- the privacy policy does not name GitHub as a processor, although the transcoder downloads
  uploads to GitHub runners;
- the Play Data-safety item for audio is unticked (`play-production-checklist.md:186`). A voice
  take likely falls under "Voice or sound recordings" (inferred);
- the App Store Connect privacy label must declare Audio Data. This cannot be checked from the repo.

Voice recordings sharpen all four. The board's inference is that none of them blocks Studio by
itself.

## Revisit when

- The owner wants a "Made in Studio" badge or Studio analytics: add the nullable column then.
- Counsel answers ADR-0019 §J1/§H.
- Studio gains file import ("import a beat"): untrusted input enters, and ADR-0035's parsing rules
  become load-bearing.
- Build-77-or-older installs fall to effectively zero: the lossless risk above disappears.
- A server-side length check is added: then the phone clamp is no longer the only one.
