---
tier: 3
owner: principal-platform
consumers: [DO, P-PF]
last_verified: 2026-08-08
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Play Store — Pre-Production Checklist

Status as of **2026-08-08**: closed-testing criteria met (12+ testers, 14+ days),
**Apply for production** unlocked in the Console, production track **Inactive**.
`main` is at `1.1.19 (65)`.

Applying for production is not the same as shipping to production. The application
is a questionnaire Google reviews (typically days, occasionally weeks). Nothing below
blocks *applying* except section 1 — but everything in sections 1–4 blocks a
**successful public launch**, and it is cheaper to fix before review than after a
rejection lands on the account.

---

## 1. User-generated content policy — DONE 2026-08-08

Livil is a social app with public UGC (tracks, video posts, stories, comments, DMs).
Google's [UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937)
requires **all** of: in-app reporting, in-app blocking, and a moderation process that
actually acts on reports. Livil had one of the three. It now has all three, shipped on
`feat/moderation-blocking-reports` with the migrations applied to production.

- [x] **Blocking.** `blocked_users` (migration `20260808100000`), one-way and invisible
      to the person blocked. Severs the friendship (accepted or pending), drops stars
      both ways, and refuses friend requests, stars, comments and DMs from either side.
      Guards sit on the RLS policies, not only the RPCs — PostgREST would otherwise be
      an open bypass. UI is the 3-dots menu on `UserProfileScreen`; when blocked, the
      Friend/Message row collapses to one **Blocked** control that leads to unblock.
      **Content stays visible** — uploads, reposts, playlists and albums. Deliberate:
      the policy asks that a user be able to stop unwanted *contact*, and a catalogue
      with holes in it based on who fell out with whom is a worse product.
- [x] **Stories are reportable.** `story_reports` (migration `20260808110000`) plus a
      Report row in the existing `StoryViewerScreen` menu and `StoryReportModal`.
      `story_id` is `on delete set null` and the reported user is denormalised, so a
      report **outlives the story's 24-hour expiry** — cascading would have emptied the
      queue of exactly the reports nobody had reached yet, every single day.
- [x] **The queue is readable and actionable.** `ops_reports_overview()` /
      `ops_mark_report_reviewed()` (migration `20260808120000`) and a Reports section in
      `/studio/ops` covering all three surfaces with mark-reviewed. Same `is_ops()`
      posture as the rest of the dashboard: the read fails soft, the write raises.
- [x] **Stories ship posture: resolved — stories ship.** The question was only ever
      "can a viewer do anything about a bad story", and now they can. No longer a gate.

### What this left open

- [ ] **Commit to a review turnaround, in writing.** The questionnaire asks what happens
      when a user reports something. "It appears in a queue" is half an answer; the other
      half is how fast someone looks. Pick a number you will actually honour (24h is
      normal for an app this size) and use it in the answer.
- [ ] **Add yourself to `ops_users`.** `is_ops()` reads that table, and it currently has
      **one row** (`vvk_google_test`). Any other account sees an empty Reports section —
      it fails soft by design, so this looks like "no reports", not like an error.
- [ ] **Clear the backlog before you apply.** There is a real unreviewed report in
      production from **2026-07-26** (a post, reason: misinformation). Applying while the
      only report you have ever received sits untouched undercuts the answer above.
- [ ] **Known gap — post and comment reports still cascade.** An author who deletes a
      reported post erases the report with it. Stories are fixed; these two are not.
      Same change applied to two more tables plus a `reported_user_id` backfill. Not a
      launch blocker, but it is the same class of bug that motivated the story fix.

> The production application questionnaire asks directly about safety and moderation.
> Answers that don't match what the app actually does are the fastest route to a
> rejection, and rejections attach to the developer account.

---

## 2. Store listing

- [ ] **App icon is stale in the Console** — shows the pre-rebrand blue-on-white
      mark. See [Why the Console icon is wrong](#appendix-why-the-console-icon-never-updated).
      The replacement is generated and checked in at
      **`docs/play-store-icon-512.png`** — upload it under
      **Main store listing → App icon**.
- [ ] Feature graphic (1024×500) reflects the purple rebrand, not the old blue.
- [ ] Phone screenshots (min 2, 4–8 recommended) are from a current build — check
      none still show the old blue accent or pre-redesign stories.
- [ ] Short (80 char) and full (4000 char) description are current, and the feature
      list matches what ships. Stories are in — see section 1.
- [ ] App category, tags, and contact details (`vvk.iitkgp@gmail.com`).
- [ ] Privacy policy URL set to `https://livil-music.com/privacy-policy.html`
      (matches `src/constants/links.ts` — these must not drift).

## 3. App content declarations

Each is a separate form under **Policy → App content**. All must be green before
production, and several are new-ish requirements that closed testing did not enforce.

- [ ] **Data safety.** Livil collects: name / username / bio / email (auth +
      `profiles`), photos and videos (avatars, cover art, video posts, stories),
      audio (uploads), messages (DMs, reactions), app activity (listen sessions, post
      views, play counts), and device IDs (FCM token via
      `@react-native-firebase/messaging`). Declare all of it as collected **and**
      stored, encrypted in transit, with deletion available.
      *Since the moderation work:* blocks (`blocked_users`) and reports
      (`post_reports`, `post_comment_reports`, `story_reports`, including free-text
      details a reporter types) are also stored. These sit under "app activity" /
      "other user-generated content" rather than needing a new category, but they are
      user data and the declaration should not pretend otherwise.
- [ ] **Account deletion.** Requirement is both in-app *and* a public web URL.
      Both exist — `DeleteAccountScreen` + `https://livil-music.com/delete-account.html`
      (`20260722200000_account_deletion.sql`). Just needs declaring.
- [ ] **Photo and video permissions declaration.** The manifest declares
      `READ_MEDIA_IMAGES` (broad access), which triggers this form. *Also verify:*
      `READ_MEDIA_VIDEO` is **not** declared even though the app uploads video — if
      video selection uses the system photo picker that is correct and preferable;
      if it silently fails on Android 13+, that is a bug to fix first.
- [ ] **Content rating questionnaire.** Answer honestly for a social app with public
      UGC, user-to-user interaction, and content sharing. Expect Teen+. A rating
      obtained by understating UGC is grounds for removal. Where it asks whether UGC
      is moderated, the answer is now **yes** — reporting on every surface, blocking,
      and a reviewed queue — but only say so once the turnaround in section 1 is
      something you are actually doing.
- [ ] **Target audience and content.** Choose 13+ or 18+. Anything including under-13
      pulls in Families policy and Play's designed-for-families requirements.
- [ ] **Child safety standards.** Mandatory for social / UGC apps. `docs/child-safety.html`
      exists and is linked from `src/constants/links.ts`; confirm the Console form is
      submitted, not just the page published.
- [ ] Ads: declare **no ads**. Government app: **no**. Financial features: **none**.
- [ ] News app: **no**.

## 4. Technical readiness

- [ ] `targetSdkVersion 36` / `compileSdkVersion 36` — current, comfortably inside the
      target-API window. `minSdkVersion 24`.
- [ ] Bump `versionCode` (**65 → 66**) and `versionName` in
      `android/app/build.gradle` for the production build. Codes 63, 64 and 65 are
      already spent — a reused code is rejected at upload, and a code is spent even
      if the release it belonged to was discarded.
- [ ] `cd android && ./gradlew bundleRelease` → upload
      `android/app/build/outputs/bundle/release/app-release.aab`.
- [ ] Confirm the release build boots from a cold start on a clean device — the
      native patch (`patches/react-native-video+6.19.2.patch`) is applied by
      `postinstall`; a CI or clean-clone build that skipped it ships a broken player.
- [ ] Play App Signing enrolled and the upload keystore backed up **outside the repo**
      (`android/app/livil-release.keystore`, credentials in `~/.gradle/gradle.properties`).
      Losing this is unrecoverable.
- [ ] Pre-launch report from the closed track reviewed — crashes, ANRs, accessibility
      and policy warnings.
- [ ] Deep links / App Links verified if any are advertised.
- [ ] Supabase is on Micro tier in `ap-south-1`. Re-read
      `kb/operations/scaling-assumptions.md` against an open-signup load, and confirm
      rate limits and the storage plan survive uncapped registration.

## 5. Rollout

- [ ] Country availability — start narrow if you want a soft launch.
- [ ] **Staged rollout at 5–10%**, not 100%. A production halt is easy at 10% and
      painful at 100%.
- [ ] Release notes written for a public audience, not for testers.
- [ ] Someone is watching Crashlytics / Console vitals for the first 48 hours.

---

## Appendix — why the Console icon never updated

The Play Console header, dashboard, and store listing icon come from a **512×512 PNG
uploaded by hand** in *Main store listing → App icon*. It is **not** extracted from
the AAB. The launcher icon in the bundle
(`android/app/src/main/res/mipmap-*/ic_launcher*.png`) only ever affects the icon on
the device home screen.

The rebrand commit `8713b77` (*Purple rebrand + outlined button system*, 2026-07-20)
replaced all 25 mipmap files and nothing else. So:

| Surface | Source | Current |
|---|---|---|
| Device home screen | AAB mipmaps | white waveform on `#0A0A0F` ✅ |
| Play Console / Store listing | manual 512×512 upload | old blue waveform on white ❌ |

No amount of `versionCode` bumping or re-uploading a bundle will change it.

**Fix:** upload `docs/play-store-icon-512.png`. Store-listing changes go through their
own review, so do this *before* the production application rather than during it.

That file is generated from `docs/favicon.svg` — the same source of truth as the app
icon and the site favicon, so the two surfaces can no longer drift. Three deliberate
differences from the favicon:

- **Corners are square (`rx="0"`), not rounded.** Play applies its own mask and
  drop shadow; baking in `rx="44"` would show as a double-rounded, inset icon.
- **Fully opaque** — all four corners are `#0A0A0F` at alpha 255. Transparent
  corners render as ragged edges once Play's mask is applied.
- **The pulse is scaled to 120%** (`MARK_SCALE` in the script), centred, so it
  still reads at the ~48px size Play uses in search results. This leaves a 2% side
  margin — geometrically safe, since Play's mask only cuts the corners and the mark
  is horizontally centred, but it is the practical ceiling. `MARK_SCALE` above ~1.25
  fails the generator's edge check. **`favicon.svg` itself is unchanged** — the app
  icon and site favicon keep the original proportions.

Regenerate with:

```bash
./scripts/gen-store-icon.sh
```

The script asserts all four corners are `#0A0A0F` at alpha 255 before writing, so a
future edit to `favicon.svg` that reintroduces rounding fails loudly instead of
shipping a double-rounded store icon. Output is deterministic — re-running it on an
unchanged source produces a byte-identical PNG.

