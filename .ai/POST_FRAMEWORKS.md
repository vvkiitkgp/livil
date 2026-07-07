# LiViL — Post Frameworks

> **Repeatable content templates so no LiViL post is built from scratch.**
> Pick a framework → fill the slots → run the checklist → publish.

**Version 1.0** · Execution layer for [`INSTAGRAM_STYLE.md`](./INSTAGRAM_STYLE.md), built on
[`BRAND_GUIDE.md`](./BRAND_GUIDE.md), [`CREATIVE_DIRECTOR.md`](./CREATIVE_DIRECTOR.md), [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)

This doc does **not** redefine canvas sizes, type scales, colors, or layout rules — those
live in `INSTAGRAM_STYLE.md` (referenced as `IS §n`) and `DESIGN_SYSTEM.md` (`DS §n`). It
defines the **story shape** of each post type so an AI or designer can generate a complete,
on-brand post by selecting one framework.

---

## How to use this document

1. **Match intent → framework.** Use the [Selector](#framework-selector) below.
2. **Read the framework's 11 fields.** Every framework specifies Purpose, When, Audience,
   Story Structure, Slide count, Screenshots, Layout, Type hierarchy, CTA, Caption, Mistakes.
3. **Fill the `[slots]`.** Bracketed slots are the only things you write. Everything else is fixed.
4. **Apply the visual system.** Layout/type/color come from `IS` — this doc tells you _what
   goes where_, `IS` tells you _how it looks_.
5. **Run the [Universal Checklist](#universal-checklist)** + the [IS §14 checklist](./INSTAGRAM_STYLE.md#14-consistency-checklist).

**Global defaults (unless a framework overrides):** 4:5 canvas 1080×1350 · obsidian bg ·
96px gutter · one purple accent · founder voice · ≤1 emoji · real screenshots only ·
closing slide = one CTA + wordmark.

---

## Framework Selector

| I want to… | Use |
|---|---|
| Show off one feature | [1. Feature Spotlight](#1-feature-spotlight) |
| Let a beautiful screen speak | [2. UI Showcase](#2-ui-showcase) |
| Explain how something hard works | [3. Engineering Deep Dive](#3-engineering-deep-dive) · [12. Technical Achievement](#12-technical-achievement) |
| Show a redesign | [4. Before vs After](#4-before-vs-after) · [17. Comparison](#17-comparison) |
| Talk like a founder | [5. Founder Update](#5-founder-update) · [16. Lessons Learned](#16-lessons-learned) |
| Explain a "why" | [6. Product Decision](#6-product-decision) |
| Show the process | [7. Behind the Scenes](#7-behind-the-scenes) |
| Tell a bug story | [8. Bug Story](#8-bug-story) |
| Announce what shipped | [9. Release Notes](#9-release-notes) · [10. Progress Update](#10-progress-update) |
| Dissect one screen's craft | [11. Design Breakdown](#11-design-breakdown) |
| Share a music/industry take | [13. Music Industry Insight](#13-music-industry-insight) |
| Spotlight a user/artist | [14. Community Highlight](#14-community-highlight) |
| Celebrate something | [15. Milestone](#15-milestone) |
| Share what's coming | [18. Future Vision](#18-future-vision) |

**Real LiViL source material** (draw from these — all real, all in the repo/`CLAUDE.md`):
single-engine playback (one `<Video>` owns audio + lock-screen for every post) · clip-relative
lock-screen controls · native background auto-advance (Fabric defers view commands) ·
beat-synced waveform visualizer (on-device decode, audio-only or it OOMs) · the Android-15
Fabric keyboard-dismiss fix (`FormInput`) · Jam Rooms (listen together) · Google sign-in +
permanent-username onboarding · playlists/albums · chat + reactions · the emoji cover-art
gradient system · IG/YouTube-style cold-start splash.

---

# Framework Template (how each entry is structured)

Every framework below has these 11 fields. An AI generating a post fills only the `[slots]`.

- **Purpose** — what this post achieves for the brand.
- **When to use it** — the trigger.
- **Target audience** — who it's for (from `BRAND_GUIDE` audiences).
- **Story structure** — the slide-by-slide narrative arc.
- **Recommended slides** — count + whether single/carousel.
- **Screenshot requirements** — exactly what to capture.
- **Visual layout** — placement per slide (references `IS`).
- **Typography hierarchy** — which type roles from `IS §5`.
- **CTA style** — how the ask is phrased.
- **Caption structure** — a fill-in template.
- **Common mistakes** — what kills this format.

---

## 1. Feature Spotlight

- **Purpose:** Introduce one feature so it's instantly understood and desired. The most common post.
- **When to use it:** A feature just shipped or is worth (re)surfacing.
- **Target audience:** Music lovers, early adopters, designers.
- **Story structure (IS Framework A):**
  1. **Hook** — feature name + one-line promise.
  2. **Problem** — the friction it removes (honest, relatable).
  3. **Solution** — the feature stated plainly.
  4. **Screenshot** — the real feature, hero-framed.
  5. **Why it matters** — the one benefit that lands.
  6. **CTA** — try it / what would you add.
- **Recommended slides:** 4–6 carousel (or a single post for a small feature: Hook+device on one frame).
- **Screenshot requirements:** The actual feature screen, in a dark-framed angled device with purple glow ([IS §4](./INSTAGRAM_STYLE.md#4-screenshot-guidelines)). Capture the feature _in use_, real data.
- **Visual layout:** Hook = eyebrow "FEATURE" + headline top-left, small device peek. Screenshot slide = single floating device lower ⅔ ([IS §9](./INSTAGRAM_STYLE.md#9-screenshot-placement)). Purple "NEW" badge.
- **Typography hierarchy:** Eyebrow (label) → Headline (feature name) → Body (benefit). 3 sizes max.
- **CTA style:** Invitational, low-pressure. "It's live now." / "What would make this better?"
- **Caption structure:**
  ```
  [One-line what it is.]

  [1–2 sentences: the problem it solves, plainly.]
  [1–2 sentences: how it works / one detail you're proud of.]

  [CTA question.]
  ```
- **Common mistakes:** Listing every sub-feature (pick ONE). Screenshot too small. Overselling ("revolutionary"). Skipping the problem so the value isn't felt.

---

## 2. UI Showcase

- **Purpose:** Let a beautiful screen sell itself — proof of craft, no explanation needed.
- **When to use it:** A screen is genuinely gorgeous (player, feed) and needs no story.
- **Target audience:** Designers, frontend engineers, "people who appreciate beautiful products."
- **Story structure:** Almost wordless. 1 hero screen, maybe a 2-slide "and this detail too." Let silence and space do the work.
- **Recommended slides:** 1 (single post) or 2–3 (screen + one close-up).
- **Screenshot requirements:** The most premium real screens — Full-Screen Player first, then Feed. Duo-overlap (feed + player) is ideal ([IS §9](./INSTAGRAM_STYLE.md#9-screenshot-placement)). Immaculate state (good art, no debug, real content).
- **Visual layout:** Maximum negative space. Device(s) large, floating, angled, strong glow. Text almost absent — at most a tiny bottom caption. The UI is 60–70% of visual weight ([IS §2](./INSTAGRAM_STYLE.md#2-layout-principles)).
- **Typography hierarchy:** Minimal — one small caption/label at most. No headline competing with the screen.
- **CTA style:** Understated or none. "Every pixel considered." Let the work imply the ask.
- **Caption structure:**
  ```
  [One quiet line about the screen or a design intention.]

  [Optional: one detail worth noticing.]

  [Soft prompt: What details do you notice?]
  ```
- **Common mistakes:** Adding a loud headline that fights the UI. Crowding the frame. Low-res or half-loaded screenshots. Explaining what the image already shows.

---

## 3. Engineering Deep Dive

- **Purpose:** Show how a hard problem was solved — earn respect from technical followers.
- **When to use it:** A non-trivial system is worth explaining (playback engine, realtime, visualizer).
- **Target audience:** Frontend/mobile engineers, founders, technical early adopters.
- **Story structure (IS Framework B):**
  1. Hero — the problem as an honest title.
  2. Why it's hard — the real constraint.
  3. The wrong way — what was ruled out.
  4. The approach — architecture / diagram.
  5. The code — one real excerpt.
  6. The result — before/after or outcome.
  7. Close — "ask me anything."
- **Recommended slides:** 5–8 carousel.
- **Screenshot requirements:** Real code excerpts (5–12 lines, syntax-tinted per [IS §5](./INSTAGRAM_STYLE.md#5-typography)), an architecture diagram, and/or a screen-recording still. **Diagrams:** simple boxes/arrows in `surface` cards, purple for the key node.
- **Visual layout:** Code/diagram on `surface` 20-radius cards, one highlighted line (`purpleDim` row). Eyebrow "ENGINEERING". One concept per slide ([IS §10](./INSTAGRAM_STYLE.md#10-cards)).
- **Typography hierarchy:** Eyebrow → Headline (the problem) → Body (plain-English explanation) → Code (mono). Explain like you're talking to a smart friend, not a spec.
- **CTA style:** Curious, peer-to-peer. "How would you have solved it?" / "Happy to go deeper — ask."
- **Caption structure:**
  ```
  [The problem in one line.]

  [The constraint that made it hard — 1–2 sentences.]
  [The approach, plainly — 2–3 sentences.]
  [Optional: the gotcha / what surprised you.]

  [Technical discussion prompt.]
  ```
  Example seed: _"Playing audio AND video through one engine so the lock screen never shows a duplicate 'carousel' notification."_
- **Common mistakes:** Wall of code. Jargon with no plain-English translation. Faking/oversimplifying to the point of being wrong. No diagram where one would clarify. Bragging instead of teaching.

---

## 4. Before vs After

- **Purpose:** Show growth in craft via a redesign — and the _thinking_ behind the change.
- **When to use it:** A screen/flow was meaningfully redesigned.
- **Target audience:** Designers, followers watching the journey.
- **Story structure:**
  1. Hook — "We redesigned [screen]."
  2. Before — the old version, honestly.
  3. What was wrong — the specific problems.
  4. After — the new version.
  5. What changed & why — the decisions.
  6. Close — reflection + prompt.
- **Recommended slides:** 4–6 carousel. (A single split-frame before/after works for a tight story.)
- **Screenshot requirements:** Real before + after screenshots, **identical framing/angle/zoom** so the diff is honest and readable. Label "BEFORE" / "AFTER" in small tracked eyebrows.
- **Visual layout:** Split or sequential devices, same lean. Before slightly de-emphasized (lower opacity glow); after gets the strong purple glow. Annotate the after with what improved.
- **Typography hierarchy:** Eyebrow (BEFORE/AFTER) → Headline → Body (the reasoning).
- **CTA style:** Reflective. "Better? What would you change?"
- **Caption structure:**
  ```
  [What we redesigned and why we revisited it.]

  Before: [the problems, honestly.]
  After: [what changed — 2–3 specifics.]

  [Prompt: agree with the direction?]
  ```
- **Common mistakes:** Making the "before" a strawman. Inconsistent framing that hides the real diff. Changing too many variables to attribute improvement. No stated reasoning ("we just made it prettier").

---

## 5. Founder Update

- **Purpose:** The human, build-in-public voice — the reason people follow the _journey_.
- **When to use it:** Weekly/biweekly, or after a meaningful moment (a hard week, a breakthrough, a doubt).
- **Target audience:** Founders, early adopters, the community rooting for you.
- **Story structure:** A short, honest reflection — where things are, a win, a roadblock, what's next. Conversational, not announcement-shaped.
- **Recommended slides:** 1 (text-forward single) or 3–4 short carousel (IS Framework E).
- **Screenshot requirements:** Minimal or none. Optional: one small device of the thing you're referencing. This format is words-first.
- **Visual layout:** Large calm statement on obsidian, generous space. Optional 4px purple accent bar. No stock "founder" photos ([IS §7 Founder Update](./INSTAGRAM_STYLE.md#7-post-categories)).
- **Typography hierarchy:** Hero statement / Quote size → quiet Body. Feels like a journal page.
- **CTA style:** Human, open. "Building this solo — what should I focus on next?"
- **Caption structure:**
  ```
  [Where things are right now — honest, one paragraph.]

  A win: [specific.]
  A roadblock: [specific.]
  Next: [one thing.]

  [Open question to the community.]
  ```
- **Common mistakes:** Vague positivity ("great progress!"). Humble-bragging. Sounding like a press release. No specifics. Over-frequency (dilutes each one).

---

## 6. Product Decision

- **Purpose:** Walk readers through _why_ a feature exists — showcase product thinking.
- **When to use it:** A decision had real tradeoffs worth explaining (what you built _and_ what you deliberately didn't).
- **Target audience:** Founders, designers, PM-minded followers, engineers.
- **Story structure:**
  1. Hook — the decision as a question ("Should playback be one engine or two?").
  2. The options — what was on the table.
  3. The tradeoffs — honestly weighed.
  4. The call — what we chose.
  5. Why — the principle behind it (people over algorithms, craft over speed, etc.).
  6. Close — "how would you have decided?"
- **Recommended slides:** 5–6 carousel.
- **Screenshot requirements:** Optional — a device of the resulting feature, or a simple options diagram on `surface` cards.
- **Visual layout:** Text-forward with a decision diagram. Options as `surface` cards; the chosen one gets the purple accent. Eyebrow "PRODUCT".
- **Typography hierarchy:** Eyebrow → Headline (the question) → Body (the reasoning).
- **CTA style:** Invites debate. "Would you have made the same call?"
- **Caption structure:**
  ```
  [The decision, framed as a question.]

  Options: [A vs B, briefly.]
  Tradeoff: [the tension.]
  We chose [X] because [principle].

  [Prompt: your call?]
  ```
- **Common mistakes:** Presenting the decision as obvious (no real tradeoff = no story). Justifying after the fact instead of showing genuine thinking. Ignoring the option you rejected.

---

## 7. Behind the Scenes

- **Purpose:** Show the messy, real process — sketches, Figma, code, testing, iterations.
- **When to use it:** Mid-build, when the _making_ is interesting even if the result isn't done.
- **Target audience:** Designers, engineers, other builders, early adopters.
- **Story structure:** A peek at work-in-progress — the sketch → the Figma → the code → the test → the iteration. Raw, honest, unpolished-on-purpose.
- **Recommended slides:** 3–6 carousel.
- **Screenshot requirements:** Real artifacts — Figma frames, whiteboard sketches, a code diff, a screen recording of a rough state, simulator/emulator shots. WIP is fine here; **label design mocks clearly** so they're never mistaken for shipped UI ([IS §4](./INSTAGRAM_STYLE.md#4-screenshot-guidelines)).
- **Visual layout:** Artifacts on `surface` cards, consistent 20-radius. Slightly looser than a polished showcase — but still aligned, still obsidian, still gutter-respecting. Eyebrow "BEHIND THE SCENES".
- **Typography hierarchy:** Eyebrow → short Headline → Body captions per artifact.
- **CTA style:** Inviting. "This is the messy middle — follow along."
- **Caption structure:**
  ```
  [What you're building and what stage it's at.]

  [The process shown: sketch → design → code → test.]
  [One honest note about what's still rough.]

  [Prompt: what's your process?]
  ```
- **Common mistakes:** Over-polishing until it's just a showcase. Faking "candid." Showing process with no payoff/context. Mistaking clutter for authenticity — still align and space it.

---

## 8. Bug Story

- **Purpose:** Turn a gnarly bug into an engaging story — relatable, technical, human.
- **When to use it:** A bug was interesting, sneaky, or taught something (the best LiViL material).
- **Target audience:** Engineers, founders, anyone who's debugged at 2am.
- **Story structure:**
  1. Hook — the symptom ("The app silently died when a video played. No logs.").
  2. The hunt — what you thought it was.
  3. The reveal — the actual cause.
  4. The fix — what solved it.
  5. The lesson — what you'll never do again.
- **Recommended slides:** 4–6 carousel.
- **Screenshot requirements:** Optional — a code excerpt of the fix, a log snippet, a diagram of the failure. Keep code real and minimal.
- **Visual layout:** Story-driven text on obsidian; code/log on `surface` cards. Eyebrow "BUG STORY". Consider a subtle `error`-tinted accent for the "symptom" slide, resolving to purple by the fix.
- **Typography hierarchy:** Eyebrow → Headline (the symptom) → Body (the narrative) → Code.
- **CTA style:** Camaraderie. "Ever chased a ghost like this?"
- **Caption structure:**
  ```
  [The symptom — dramatic but true, one line.]

  What I thought it was: [wrong guess.]
  What it actually was: [root cause.]
  The fix: [what worked.]
  Lesson: [the takeaway.]

  [Prompt: your worst debugging story?]
  ```
  Example seed: _"Decoding a video's audio for the waveform pulled the whole file into memory → OutOfMemoryError → the OS killed the process. No JS log. The debugger just… dropped."_
- **Common mistakes:** Too much technical detail with no narrative. No "lesson." Making it a brag instead of a shared-pain story. Fabricating drama.

---

## 9. Release Notes

- **Purpose:** Announce what shipped — clarity over marketing (Linear-changelog energy).
- **When to use it:** A new version / batch of improvements is out.
- **Target audience:** Existing users, early adopters, followers tracking momentum.
- **Story structure:** Version → a tight list of what's new/fixed → one hero of the headline change.
- **Recommended slides:** 1–3. Single 4:5 for a small release; 3-slide for a bigger one.
- **Screenshot requirements:** One device showing the biggest change. Optional per-item mini-shots.
- **Visual layout:** Version number as a hero stat ("v1.1", 140–200px). Tight bulleted list on a `surface` card — each item = purple check + short line ([IS §10 Release/Launch cards](./INSTAGRAM_STYLE.md#10-cards)). Eyebrow "WHAT'S NEW".
- **Typography hierarchy:** Stat (version) → Label list items → Body (one-line context).
- **CTA style:** Direct, unhyped. "Update and let me know what you think."
- **Caption structure:**
  ```
  LiViL [vX.Y] is out.

  ✓ [change 1]
  ✓ [change 2]
  ✓ [fix]

  [One line on the highlight.] [CTA: update / feedback.]
  ```
- **Common mistakes:** Marketing-speak on a changelog. Burying the headline change. Vague items ("various improvements"). Overusing emoji as bullets (one check style, consistent).

---

## 10. Progress Update

- **Purpose:** Show momentum — "here's where LiViL is." Builds the follow-the-journey habit.
- **When to use it:** Weekly/monthly cadence.
- **Target audience:** Early adopters, founders, the community.
- **Story structure (IS Framework C):** Period → Shipped → Showcase → Next → Reflection.
- **Recommended slides:** 3–5 carousel (or single stat frame for a light week).
- **Screenshot requirements:** One device of the biggest new thing. Optional metric frame.
- **Visual layout:** Checklist/timeline on `surface` cards (done = purple check, next = muted grey). Eyebrow "PROGRESS" + date. Metrics as hero numbers if they're real and meaningful ([IS §10 Metrics](./INSTAGRAM_STYLE.md#10-cards)).
- **Typography hierarchy:** Eyebrow+date → Headline → Label list / Stat → Body.
- **CTA style:** Momentum + openness. "Two weeks in. Here's the plan — what's missing?"
- **Caption structure:**
  ```
  [Period] at LiViL:

  Shipped: [1–3 things.]
  Learned: [one thing.]
  Next: [one focus.]

  [Prompt: what should I prioritize?]
  ```
- **Common mistakes:** Vanity metrics with no meaning. "Great progress" with nothing concrete. Inconsistent cadence. Making it identical every time (vary the hero — stat vs device vs checklist).

---

## 11. Design Breakdown

- **Purpose:** Dissect one screen's craft — spacing, hierarchy, type, interaction, color.
- **When to use it:** A screen embodies real design decisions worth teaching.
- **Target audience:** Designers, frontend engineers, product people.
- **Story structure (IS Framework D):** Screen → the goal/feeling → spacing/grid → color/type → motion → final clean shot.
- **Recommended slides:** 5–7 carousel.
- **Screenshot requirements:** The real screen, plus **annotated versions** — redlines, spacing markers, color swatches (`purpleLight` annotations). This is the sanctioned place for **labelled design artifacts** ([IS §7 Design Breakdown](./INSTAGRAM_STYLE.md#7-post-categories)).
- **Visual layout:** Annotated screenshots per slide, one decision each. Swatch chips pulled from [DS §3](./DESIGN_SYSTEM.md#3-color-system); type specs shown literally. Eyebrow "DESIGN".
- **Typography hierarchy:** Eyebrow → Headline (the decision) → Body (the why) → tiny spec labels.
- **CTA style:** Craft-nerd invitation. "What details do you notice?"
- **Caption structure:**
  ```
  Designing [screen]:

  Goal: [the feeling.]
  Spacing: [decision.]
  Type/color: [decision.]
  Motion: [decision.]

  [Prompt: what would you refine?]
  ```
- **Common mistakes:** Annotations too dense to read. Claiming intent that wasn't real. No consistent annotation style. Forgetting the clean "final" payoff slide.

---

## 12. Technical Achievement

- **Purpose:** Highlight a genuinely hard engineering win (realtime sync, audio streaming, perf, caching, rendering, native integration).
- **When to use it:** Something difficult _works_ and is worth flexing — with substance.
- **Target audience:** Engineers, technical founders, potential collaborators/hires.
- **Story structure:** The achievement → why it's hard → how it works (briefly) → the proof (it runs). Shorter and prouder than a Deep Dive; the Deep Dive teaches, this one _demonstrates_.
- **Recommended slides:** 3–5 carousel (or a single hero-stat + device).
- **Screenshot requirements:** Proof it works — a screen recording still, a perf number, a lock-screen shot, a diagram. Real metrics only.
- **Visual layout:** Hero statement + one supporting stat/diagram. Strong glow — this is a confident frame. Eyebrow "ENGINEERING".
- **Typography hierarchy:** Hero statement / Stat → Body (the one-line how).
- **CTA style:** Confident but humble. "Quietly proud of this one."
- **Caption structure:**
  ```
  [The achievement in one line.]

  Why it's hard: [constraint.]
  How: [one-sentence approach.]

  [Optional: a metric.] [Prompt.]
  ```
  Example seed: _"The lock-screen scrubber shows the clip's timeline, not the full track — the offset is translated natively so background auto-advance still works while the app is asleep."_
- **Common mistakes:** Flexing without substance. No proof. Overclaiming ("world's first"). Turning it into a full tutorial (that's the Deep Dive).

---

## 13. Music Industry Insight

- **Purpose:** Share a specific, earned observation about music, creators, listeners, or social listening — position LiViL as a thoughtful voice, not just an app.
- **When to use it:** You have a genuine, non-obvious take (ideally one that motivates LiViL's existence).
- **Target audience:** Music lovers, independent artists, producers, the broader community.
- **Story structure:** Observation → why it's true → what it means for how we listen → (optional) how LiViL responds. Insight-first; product is a soft footnote, not the pitch.
- **Recommended slides:** 1 (strong single statement) or 3–4 carousel.
- **Screenshot requirements:** Usually none, or a subtle cover-art gradient / player as mood. This is a _thinking_ post.
- **Visual layout:** Large quote/statement on obsidian or a cover-art-gradient hero ([DS §9](./DESIGN_SYSTEM.md#9-gradients)). Minimal. Eyebrow "NOTES" or "ON MUSIC".
- **Typography hierarchy:** Hero statement / Quote → quiet Body → muted attribution if quoting.
- **CTA style:** Discussion-opening. "Agree? How do you discover music now?"
- **Caption structure:**
  ```
  [The observation, one sharp line.]

  [Why it's true — 2–3 sentences, specific.]
  [What it means for listening together.]

  [Soft: this is why we're building LiViL.] [Prompt.]
  ```
  Example seed: _"Streaming made music infinitely available and somehow lonelier. The algorithm knows what you'll play next; it doesn't know who you'd love to play it with."_
- **Common mistakes:** Generic opinions ("music brings people together!"). Thinly-veiled ads. Hot takes with no substance. Punching at streaming services by name (critique the _pattern_, not a competitor — see [17](#17-comparison)).

---

## 14. Community Highlight

- **Purpose:** Showcase real users, artists, playlists, or community activity — make the platform's soul visible.
- **When to use it:** Real community content exists worth celebrating (a Jam Room, a shared playlist, an artist).
- **Target audience:** The community, prospective users, independent artists.
- **Story structure:** The person/content → what makes it great → the LiViL moment it happened in → an invite for others.
- **Recommended slides:** 2–4 carousel.
- **Screenshot requirements:** Real user/artist content — Jam Room, playlist, cover art, a track in the player. **Consent + attribution required**; anonymize where needed ([IS §7](./INSTAGRAM_STYLE.md#7-post-categories)).
- **Visual layout:** The user's cover art / gradient as hero (the one place richer color leads), their content in the player screenshot, a warm one-liner. Human and warm.
- **Typography hierarchy:** Eyebrow "COMMUNITY" → Headline (name/thing) → Body (why it's great).
- **CTA style:** Welcoming. "Share yours — tag us."
- **Caption structure:**
  ```
  [Who/what you're highlighting + one line on why.]

  [The story or detail worth celebrating.]

  [Attribution/credit.] [CTA: share yours.]
  ```
- **Common mistakes:** Using content without permission. Stock "musicians." Making it about LiViL instead of the person. No credit.

---

## 15. Milestone

- **Purpose:** Celebrate a real achievement — launch, download count, feature, Play Store release, repo milestone, personal win.
- **When to use it:** Something genuinely worth marking (don't manufacture milestones).
- **Target audience:** Everyone — the community, followers, fellow builders.
- **Story structure:** The milestone → a moment of gratitude/reflection → what's next. Short, warm, confident — not boastful.
- **Recommended slides:** 1 (single celebratory frame) or 2–3.
- **Screenshot requirements:** Depends — a Play Store listing, a device with the launched feature, a repo graph, a number. Real proof.
- **Visual layout:** The **Launch/Announcement card** treatment ([IS §10](./INSTAGRAM_STYLE.md#10-cards)): hero gradient bg, wordmark + the number/thing as a hero stat + the strongest purple glow. Reserve LiViL's biggest glow for these.
- **Typography hierarchy:** Hero stat / statement → Body (gratitude + next).
- **CTA style:** Grateful + forward. "Thank you — here's what's next."
- **Caption structure:**
  ```
  [The milestone.] 🎉  (the one sanctioned emoji moment)

  [One line of genuine reflection / thanks.]
  [What this unlocks / what's next.]

  [Warm CTA.]
  ```
- **Common mistakes:** Inflating minor things into "milestones" (erodes trust). Boasting over gratitude. Vanity metrics. Over-emoji even here (one, max).

---

## 16. Lessons Learned

- **Purpose:** Share a mistake, tradeoff, or failure and what changed after — the most trust-building content there is.
- **When to use it:** You got something wrong and learned from it (be genuinely vulnerable).
- **Target audience:** Founders, builders, the community.
- **Story structure (IS Framework E):** The lesson (big) → the story of the mistake → the cost → what changed → the takeaway.
- **Recommended slides:** 3–5 carousel (text-forward).
- **Screenshot requirements:** Usually none — or a small before/after of what changed. Words lead.
- **Visual layout:** Big statement per slide (the lesson), quiet body (the story). Calm, honest, obsidian. Eyebrow "LESSONS".
- **Typography hierarchy:** Hero statement (the lesson) → quiet Body.
- **CTA style:** Peer-level. "Learned this the hard way — you too?"
- **Caption structure:**
  ```
  [The lesson, one line.]

  What I got wrong: [honestly.]
  What it cost: [real consequence.]
  What changed: [the fix / new principle.]

  [Prompt: what did you learn the hard way?]
  ```
  Example seed: _"I almost shipped a second audio engine for video. It would've resurrected the duplicate lock-screen notification and desynced audio from video. One engine, always — I re-learn that rule every time I'm tempted to fork it."_
- **Common mistakes:** Fake vulnerability / humble-brag ("my biggest flaw is caring too much"). No real cost. No change. Preachy generic wisdom instead of a specific story.

---

## 17. Comparison

- **Purpose:** Compare old vs new, or two approaches/decisions — clarify _why_ one is better. **Never attack competitors.**
- **When to use it:** A meaningful A/B in design or engineering deserves examination.
- **Target audience:** Designers, engineers, product-minded followers.
- **Story structure:** The two options → criteria → how each measures up → the verdict → the principle. Fair to both sides.
- **Recommended slides:** 3–6 carousel (or a split single-frame).
- **Screenshot requirements:** Both options, identically framed for an honest diff. Or two diagrams.
- **Visual layout:** Side-by-side or sequential; the winner gets the purple accent, the other stays neutral grey (never mocked). Eyebrow "COMPARISON".
- **Typography hierarchy:** Eyebrow → Headline (the question) → Body (the analysis) → small labels (Option A / B).
- **CTA style:** Debate-inviting. "Which would you ship?"
- **Caption structure:**
  ```
  [Option A] vs [Option B]:

  [Criteria that matter.]
  [How each does — fairly.]
  We went with [X] because [principle].

  [Prompt: your pick?]
  ```
- **Common mistakes:** Strawmanning the loser. **Naming/attacking a competitor** (compare _approaches_ and _our own_ past/present, per `BRAND_GUIDE`). Unfair framing. No clear takeaway.

---

## 18. Future Vision

- **Purpose:** Share where LiViL is heading — roadmap, experiments, concepts — **without overpromising.**
- **When to use it:** You want to rally the community around direction (frame as intent, not commitment).
- **Target audience:** Early adopters, the community, potential collaborators.
- **Story structure:** Where we are → where we're going → why that direction → an honest "these are ideas, not promises."
- **Recommended slides:** 3–5 carousel (or a single roadmap frame).
- **Screenshot requirements:** Mostly conceptual — a roadmap timeline, or a **clearly-labelled** concept/mock (never dressed as shipped UI, per [IS §4](./INSTAGRAM_STYLE.md#4-screenshot-guidelines)).
- **Visual layout:** **Roadmap card** ([IS §10](./INSTAGRAM_STYLE.md#10-cards)): Now / Next / Later, current phase purple, future muted. One "you are here" purple marker. Eyebrow "WHAT'S NEXT".
- **Typography hierarchy:** Eyebrow → Headline (the direction) → Label list (phases) → Body (the why).
- **CTA style:** Collaborative, hedged. "Directions, not promises — what matters most to you?"
- **Caption structure:**
  ```
  Where LiViL is heading:

  Now: [current focus.]
  Next: [near-term.]
  Later: [ideas — clearly ideas.]

  [Honest hedge: no dates, subject to change.] [Prompt: what would you want first?]
  ```
- **Common mistakes:** Hard promises/dates you can't keep. Concept art mistaken for real features. Vaporware energy. Listing everything (focus the vision). Overhyping ("the future of music").

---

# Universal Checklist

For **every** framework, confirm these eight before you build and before you ship. (This is the
content-completeness pass; [IS §14](./INSTAGRAM_STYLE.md#14-consistency-checklist) is the visual pass.)

### 1. Hook
- [ ] Slide 1 communicates the whole value in **≤7 words** + a visual hook.
- [ ] It earns the swipe/follow on its own (the feed only shows slide 1).
- [ ] No clickbait, no fake urgency — intriguing because it's _true_.

### 2. Story
- [ ] One core story, sayable in a sentence.
- [ ] Follows the framework's structure; each slide advances it.
- [ ] Honest — nothing exaggerated, faked, or overclaimed.
- [ ] Teaches, inspires, or shows progress (per `CREATIVE_DIRECTOR.md`).

### 3. Screenshot plan
- [ ] Every screenshot is **real product UI** (or a clearly-labelled design artifact).
- [ ] Hero screens preferred (player / feed / jam); legible; good state, real content.
- [ ] Framing per [IS §4](./INSTAGRAM_STYLE.md#4-screenshot-guidelines): dark device, angled 15–20°, purple glow.
- [ ] If a needed screenshot doesn't exist: **specify exactly which screen/state to capture.**

### 4. Layout recommendation
- [ ] Obsidian bg, 96px gutter, 8px grid, one purple accent ([IS §2](./INSTAGRAM_STYLE.md#2-layout-principles)).
- [ ] One idea per frame; generous negative space; ≤40 words body per frame.
- [ ] Consistent device/angle and card radius across the carousel.

### 5. Copy hierarchy
- [ ] ≤3 type sizes per frame; heavy weight + tight tracking on headlines ([IS §5](./INSTAGRAM_STYLE.md#5-typography)).
- [ ] Eyebrow → Headline → Body roles used correctly for the framework.

### 6. Caption template
- [ ] Follows the framework's caption structure.
- [ ] Founder voice: short, clear, confident, no buzzwords ([`BRAND_GUIDE.md`](./BRAND_GUIDE.md)).
- [ ] ≤1 emoji; opens with the value, not a preamble.

### 7. CTA
- [ ] Exactly one, low-pressure, matches the framework's CTA style.
- [ ] Invites participation, not "buy now."
- Examples by intent: _"It's live — try it." · "How would you have solved it?" · "What should I prioritize?" · "Which would you ship?" · "What did you learn the hard way?"_

### 8. Discussion prompt
- [ ] The caption ends on a genuine question that sparks replies.
- [ ] Relevant to LiViL's audience (music lovers, artists, designers, engineers, founders).
- Examples: _"How do you discover new music now?" · "What detail do you notice?" · "Your worst debugging story?" · "What would you build next?"_

### Final gut check (from the brand)
- [ ] Would this make someone think _"a startup I'd love to work at" / "these people care about music"_?
- [ ] Does it strengthen LiViL's brand — or just fill the calendar? **If the latter, don't post it.**

---

_Frameworks are the story shape; `INSTAGRAM_STYLE.md` is the look; `DESIGN_SYSTEM.md` is the
tokens; `BRAND_GUIDE.md` is the voice; `CREATIVE_DIRECTOR.md` is the mandate. Select a framework,
fill the slots, apply the system, run both checklists — and the post will be unmistakably LiViL._
