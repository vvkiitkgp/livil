# Store Screenshot Storyboard — Google Play + Apple App Store

Six screenshots, one story, one set of assets for both stores. This document is the
text spec: what each panel says, what is on the phone, how the panels connect when a
visitor swipes, and how to produce them.

Design principle: **every panel is a beat in one sentence.** Read the six headlines in a
row and you get the whole pitch:

> Press play here… → …and it plays there. → See what your friends are playing, right now.
> → Share the 15 seconds that gave you chills. → Built for the people who make the music.
> → Your music, everywhere you are.

Panels **1 + 2** are a single panoramic image split in two (the store carousel shows them
side by side, so the split reads as one scene). Panels **5 + 6** share a continuous
background gradient so the set feels like it ends where it began.

---

## Global art direction

| Element | Spec |
|---|---|
| Background | `#0A0A0F` base. One soft radial glow per panel in `#4C1D95 → #8B3DFF`, positioned to lead the eye toward the next panel (glow drifts right across 1→2→3, then settles centre on 4, then bottom-left → bottom-right across 5→6). |
| Headline type | Heavy geometric sans (Inter / SF Pro Display Black / Manrope 800), `#FFFFFF`, letter-spacing −3%. One emphasised word per headline set in a serif italic with the hero gradient `#6D28D9 → #A855F7` as text fill — the same device the landing page uses ("lonely", "room", "presence", "together"). |
| Sub-line | Same sans, 500 weight, `#C9B6FF` (purpleLight), ~40% of headline size. |
| Device | Dark bezel-less phone frame (Pixel- or generic-style, no brand logo). Slight 4–6° tilt on the diptych panels, dead straight on 3–5. Screen content = real app screenshots (see capture list at the end). |
| Signature | The Livil pulse glyph (the waveform line from `docs/favicon.svg`) drawn as a thin `#A855F7` line at ~30% opacity that runs **continuously through all six panels** at the same vertical position. It is the "string" that ties the carousel together. |
| Footer | Nothing on panels 1–5. Panel 6 carries the app icon + wordmark + "Live · Vibe · Link". |
| Text position | Headline at the top third, phone occupying the lower two thirds, except panels 1–2 where the phones are large and the headline sits in the top 22%. Never place text inside the phone bezel. |
| Safe zone | Design at **1320 × 2868** (Apple 6.9"). Keep every word and the whole phone inside a centred **1320 × 2347** box. The top/bottom 260 px are bleed only. The Play export is that box scaled to 1080 × 1920. |
| Accessibility | Headline contrast on `#0A0A0F` is white (21:1). `#C9B6FF` sub-lines measure ≈ 12:1. Do not put text over the glow's brightest point. |

---

## Panel 1 — "Press play here…"  (left half of the diptych)

**Headline:** `Press play *here*…`  (italic-serif gradient word: *here*)
**Sub-line:** none — the sentence finishes on panel 2.

**Scene:** A phone on the right edge of the panel, tilted ~5° clockwise, cut off by the
panel edge so that roughly one third of the device continues into panel 2. On screen:
the **Jam Room** as the **host** sees it.

**On-device content (seeded, real-looking):**
- Room title: `friday. no plans.` · pill: `HOST`
- Now playing: **Midnight Drive** — `@riya.wav` · cover art: deep-purple night road
- Progress: `1:42 / 3:56`, the waveform scrubber lit to the same point as panel 2
- Listener avatars in a row: `riya`, `sam_beats`, `nadia`, `+2` with the green presence dot
- In-room chat, last three messages:
  - `sam_beats` — `this drop 🔥`
  - `nadia` — `wait for 2:10`
  - `riya.wav` — `host, loop it`
- The big play control shows **pause** (music is playing).

**Motion of the eye:** the pulse line enters from the left edge, rises into a peak
exactly under the word *here*, and exits right into panel 2.

**Alt text (Apple accessibility field):** "Livil Jam Room, host view. A song plays at 1:42
while four friends listen and chat in the same room."

---

## Panel 2 — "…and it plays there."  (right half of the diptych)

**Headline:** `…and it plays *there*.`  (gradient word: *there*)
**Sub-line:** `Jam Rooms keep everyone on the same beat — in real time.`

**Scene:** A second phone on the **left** edge, tilted ~5° counter-clockwise, mirroring
panel 1 so the two devices face each other across the gutter. On screen: the **same Jam
Room**, seen by a **listener**.

**On-device content:**
- Same room title, same track, same cover art
- Progress: **`1:42 / 3:56`** — identical to panel 1. This is the whole point: two phones,
  one moment. Make the scrubber positions pixel-matched.
- Pill: `LISTENING` · a small line: `riya.wav is hosting`
- The listener's controls are "suggest a track" rather than transport (true to the app:
  listeners suggest, hosts control)
- Chat shows the reply that panel 1 didn't: `you` — `looping it 🔁`

**Continuity:** the pulse line arrives from panel 1 at the same height, passes *behind*
the phone, and continues out the right edge. The background glow is one ellipse whose
centre sits on the seam between panels 1 and 2, so when the store shows them side by side
the light is unbroken.

**Alt text:** "The same Jam Room on a friend's phone, at the same second. Listeners can
chat and suggest tracks while the host controls playback."

---

## Panel 3 — "See what your friends are playing. Right now."

**Headline:** `See what your friends are playing. *Right now.*`  (gradient: *Right now.*)
**Sub-line:** `Presence, not posts. Star people with taste and follow their listening live.`

**Scene:** Phone straight-on, centred. On screen: the **Home feed**.

**On-device content:**
- Top: friends' **Story rings** — five avatars, three with the unread purple ring
  (`riya`, `sam_beats`, `nadia`), two seen (grey)
- A "listening now" strip: `sam_beats · playing *Low Tide*` · `nadia · in a Jam Room`
- First feed card: a **Repost** by `nadia` — `"the bridge in this is insane"` — of
  `Low Tide — @sam_beats`, showing the clip range `0:48 – 1:03` on the mini-waveform,
  like count `128`, comment count `14`
- Second card (partially visible at the bottom): an **Upload** by `riya.wav` — `Midnight
  Drive` — with the `+ Repost` outlined button
- The **floating player** pill above the tab bar, playing `Low Tide`, its beat-synced wave
  mid-swell

**Callouts (optional, max two, thin `#A855F7` lines with 11–12 pt labels outside the
bezel):**
- → the presence strip: `who's listening, live`
- → the story ring: `24-hour Stories, friends only`

**Alt text:** "Livil home feed showing friends' stories, a live 'listening now' strip, and a
reposted clip with a comment."

---

## Panel 4 — "Share the 15 seconds that gave you chills."

**Headline:** `Share the 15 seconds that gave you *chills*.`  (gradient: *chills*)
**Sub-line:** `Clip any moment. Repost it with your take, or post it as a Story.`

**Scene:** Phone straight-on, centred, background glow settled directly behind the device
so the clip editor's purple handles are the brightest thing in the frame.

**On-device content — the Repost / clip editor screen:**
- Track header: `Low Tide — @sam_beats` · full-track waveform across the width
- **Clip range slider** with both handles visible and the selected range filled with the
  deep → neon gradient: `0:48 ——— 1:03` · label `15s`
- Caption field (using the app's real input): `the bridge in this is insane`
- Two choices, both as outlined purple buttons: `Repost to feed` · `Post as Story · 24h`
- Small helper text under Story: `Stories are 10 seconds max` (true to the app)

**Why this panel matters:** it is the one screen a visitor cannot guess from the icon.
Clipping + reposting is what makes Livil feel different from a streaming app. Give the
slider room; do not crowd it with callouts.

**Alt text:** "Clip editor with a 15-second range selected on a waveform, a caption field,
and buttons to repost to the feed or post as a 24-hour Story."

---

## Panel 5 — "Built for the people who make the music."

**Headline:** `Built for the people who *make* the music.`  (gradient: *make*)
**Sub-line:** `Upload audio or video. Credit your collaborators. Be heard by people who
actually listen.`

**Scene:** Phone straight-on, shifted slightly left of centre; the glow starts in the
bottom-left and will hand off to panel 6. On screen: a **creator profile**.

**On-device content:**
- Avatar, `@riya.wav` · display name `Riya` · bio `bedroom producer · Mumbai`
- Stats row: `2.4K stars` · `38 uploads` · `3 albums`
- Tabs: `Reposts · Uploads · Albums · Playlists` with **Uploads** active
- Grid/list of uploads with cover art; the top one, `Midnight Drive`, shows a small
  `feat. @sam_beats · producer` credit line and play count `12.8K`
- An album strip: `Night Shift · 8 tracks`

**Second element (small, tucked into the bottom-right corner behind the phone, ~35%
scale, no tilt):** the **Upload** screen mid-flow — `Add cover art`, `Title`, a
`Collaborators` row showing two chips. It reads as "and here's how it gets there" without
needing another full panel.

**Alt text:** "A creator's Livil profile with star count, uploads, albums, and collaborator
credits; the upload screen peeks in from the corner."

---

## Panel 6 — "Your music. Everywhere you are."

**Headline:** `Your music. *Everywhere* you are.`  (gradient: *Everywhere*)
**Sub-line:** `Full-screen player with lyrics and credits. Lock-screen controls. Playlists
you build with friends.`

**Scene:** Three surfaces fanned like a hand of cards, left to right, each a bit smaller
and further back:
1. **Full-screen player** (front, largest): `Midnight Drive — riya.wav`, video frame with
   the waveform scrubber, `Lyrics · Queue · Info` tabs with **Info** open showing the
   collaborator credits
2. **Lock-screen media card** (middle): the same track, clip-relative scrubber, prev / pause
   / next
3. **Shared playlist** (back): `late nights 🌙` · `by you + nadia` · visibility pill
   `Friends`

**Footer band (the only panel with one):** app icon (the pulse mark in the purple gradient
tile) · wordmark **Livil** · tagline `Live · Vibe · Link` · line under it `Free to
download`.

**Continuity:** the glow arrives from panel 5's bottom-left and ends bottom-right; the
pulse line finishes with a final peak and flattens into the footer's baseline. This is
the visual "full stop" of the sentence started on panel 1.

**Alt text:** "Livil's full-screen player with credits, the lock-screen controls, and a
shared friends-only playlist, with the Livil logo and the tagline Live, Vibe, Link."

---

## Copy bank — alternatives if any headline tests poorly

| Panel | Alternate A | Alternate B |
|---|---|---|
| 1+2 | `One song.` / `A hundred rooms.` | `Hit play.` / `They hear it too.` |
| 3 | `Music feels different when someone's in it with you.` | `Your friends' taste, live.` |
| 4 | `Repost the moment, not the whole song.` | `The 15 seconds worth talking about.` |
| 5 | `Not a chart. An audience.` | `Upload it. Credit them. Get heard.` |
| 6 | `Listen anywhere. Even the lock screen.` | `Live · Vibe · Link.` (headline-only closer) |

Keep headlines ≤ 8 words. Apple truncates nothing, but Play's carousel is small on a
phone — anything longer than two lines at the recommended size becomes unreadable.

---

## Store specs (verify against the consoles before export — they change)

| | Google Play | Apple App Store |
|---|---|---|
| Count | 2–8 phone screenshots | up to 10 per device size |
| Recommended size | **1080 × 1920** (9:16) | **1320 × 2868** (iPhone 6.9″, required) |
| Constraints | PNG/JPEG, no alpha, 320–3840 px on each side, aspect no more extreme than 2:1 | PNG/JPEG, no alpha, exact size |
| Also needed | **Feature graphic 1024 × 500** (required for the listing) | 13″ iPad set if the iOS app supports iPad |

**One master, two exports.** Design at 1320 × 2868 with the 1320 × 2347 safe zone
described above. Apple gets the master as-is. Play gets the safe zone cropped out and
scaled to 1080 × 1920 — nothing is lost because nothing important lives in the bleed.

**Feature graphic (Play only):** reuse panel 1 + 2 as one wide image: both phones facing
each other, headline `Press play here… and it plays there.` on one line, pulse line
through the middle. 1024 × 500, text kept out of the outer 10% on every side (Play
overlays a play button on it in some placements).

---

## Production checklist

**Seed the demo account before capturing.** Every screenshot above assumes the same cast
so the story holds across panels:

| Handle | Role in the story |
|---|---|
| `riya.wav` | creator, Jam host, owns *Midnight Drive* and the *Night Shift* album |
| `sam_beats` | creator, owns *Low Tide*, credited as producer on *Midnight Drive* |
| `nadia` | listener, reposts *Low Tide* with the caption, co-owns the *late nights 🌙* playlist |
| `you` | the account holding the phone in panels 2, 3, 4, 6 |

Match the timestamps: panels 1 and 2 must both show `1:42 / 3:56`. Pause both devices,
seek to the same point, then capture.

**Capture list (real app screens, dark theme, status bar cleaned — 100% battery, no
notifications, a round time like 9:41 or 10:00):**

1. `JamRoomScreen` as host — panel 1
2. `JamRoomScreen` as listener — panel 2
3. `HomeScreen` with stories + presence + repost card + floating player — panel 3
4. `RepostScreen` with a 15 s clip selected — panel 4
5. `ProfileScreen` (creator, Uploads tab) and `UploadScreen` — panel 5
6. `FullScreenPlayer` (Info tab), the Android lock screen, and `PlaylistScreen` — panel 6

Existing captures in this folder (`jam-room.png`, `home-feed.png`, `profile.png`,
`player-info.png`, `lock-screen.png`) can be reused where the seed data already matches.

**Compose** in Figma / Canva / Pixelmator on the 1320 × 2868 canvas, six artboards side by
side so the pulse line and the 1↔2 glow can be drawn as one continuous shape and then
sliced. Export PNG, flatten alpha, run both size exports, and upload the six in this order
to both stores.

---

## Designed panels

The six panels above are built as a design canvas (Claude Design artifact, "Livil Store
Screenshots"). Each artboard is 1320 × 2868 and exports to PNG from the canvas toolbar.

`store/gen.mjs` regenerates the artboard HTML (`node gen.mjs` writes `Main.dc.html`,
`Panel2..6.dc.html` and `canvas.json` into the current directory). `store/panel-N.png`
are headless-Chromium preview renders of the same files with fallback fonts — the
canvas loads Sora / Manrope / Instrument Serif and looks sharper than these previews.
