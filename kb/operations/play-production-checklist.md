# Play Store — Pre-Production Checklist

Status as of **2026-08-04**: closed-testing criteria met (12+ testers, 14+ days),
**Apply for production** unlocked in the Console, production track **Inactive**,
`1.1.16 (62)` still **In review** on the closed track.

Applying for production is not the same as shipping to production. The application
is a questionnaire Google reviews (typically days, occasionally weeks). Nothing below
blocks *applying* except section 1 — but everything in sections 1–4 blocks a
**successful public launch**, and it is cheaper to fix before review than after a
rejection lands on the account.

---

## 1. Blockers — user-generated content policy

Livil is a social app with public UGC (tracks, video posts, stories, comments, DMs).
Google's [UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937)
requires **all** of: in-app reporting, in-app blocking, and a moderation process that
actually acts on reports. Livil currently has one of the three.

- [ ] **User blocking does not exist.** No `blocked_users` table, no block action
      anywhere in `src/`. This is an explicit, itemised UGC requirement — not a nice
      to have. Needs a table + RLS, a block action on profiles/posts, and filtering
      of blocked users out of the feed, stories, comments, search and DMs.
- [ ] **Stories cannot be reported.** `PostReportModal` is wired to `PostCard` only.
      `StoryViewerScreen` has no report affordance, and there is no `story_reports`
      table. Stories are the highest-risk surface (ephemeral, full-screen, autoplay).
- [ ] **Reports are write-only with no moderation tooling.** `post_reports` /
      `post_comment_reports` have an insert policy and *no select policy* — by design,
      per the migration comment: "Moderation reads happen via service role / admin
      tooling later." Later is now. A report that nothing reads is not a moderation
      process. Minimum viable: a service-role queue view + a documented human SLA for
      reviewing and actioning it.
- [ ] **Decide the stories ship posture.** The long-standing open question. Options:
      ship stories with the moderation stack above, or gate stories off for the
      production track and ship the rest. Either is defensible; drifting into launch
      without deciding is not.

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
- [ ] Short (80 char) and full (4000 char) description are current; feature list
      matches what actually ships if stories are gated off.
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
- [ ] **Account deletion.** Requirement is both in-app *and* a public web URL.
      Both exist — `DeleteAccountScreen` + `https://livil-music.com/delete-account.html`
      (`20260722200000_account_deletion.sql`). Just needs declaring.
- [ ] **Photo and video permissions declaration.** The manifest declares
      `READ_MEDIA_IMAGES` (broad access), which triggers this form. *Also verify:*
      `READ_MEDIA_VIDEO` is **not** declared even though the app uploads video — if
      video selection uses the system photo picker that is correct and preferable;
      if it silently fails on Android 13+, that is a bug to fix first.
- [ ] **Content rating questionnaire.** Answer honestly for a social app with
      unmoderated UGC, user-to-user interaction, and content sharing. Expect Teen+.
      A rating obtained by understating UGC is grounds for removal.
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
- [ ] Bump `versionCode` (**62 → 63**) and `versionName` in
      `android/app/build.gradle` for the production build.
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

