---
tier: 4
owner: principal-playback
consumers: [ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [2, 6]
---

# ADR-0011 — Reaffirm ADR-0006, ratify the patch hedge with a scope correction, and disambiguate trigger #1

| | |
|---|---|
| **Status** | **Accepted** (companion to ADR-0006) |
| **Date** | 2026-07-24 |
| **Domain** | playback (with platform) |
| **Decided by** | Architecture Board — LIV-7 debate |
| **Participants** | principal-playback, principal-platform, adversarial-critic |

Board recommendation — PENDING FOUNDER RATIFICATION (2026-07-24).

---

## Context

[ADR-0006](0006-maintain-patched-video-until-trigger.md) (Accepted, 2026-07-21) decided: maintain
the patched `react-native-video`, do not migrate, and hedge via characterization tests over the
clip-coordinate translation plus a CI contract test over the three-location native prop mirror.
[PROP-0001](../debt/proposals/0001-hedge-the-patch.md) is that hedge, still marked "Draft —
awaiting ratification." LIV-7 asks the board to finalize the ratification recommendation.

**Surprise finding, independently verified by both principals AND the critic:** the PROP-0001
work is already implemented and merged to `main` in commit `008d427` (PR #67, 2026-07-21) —
`src/utils/__tests__/nowPlayingMetadata.test.ts` (17 tests) and
`src/__tests__/contracts/native-prop-seam.test.ts` (11 tests), both passing, both wired into the
CI `verify` job (`npm ci` → typecheck → lint → `npm test`). The three-location mirror lives
inside the patched `node_modules/react-native-video`
(`src/specs/VideoNativeComponent.ts`, `src/types/video.ts`, `lib/types/video.d.ts`).

**Trigger status re-verified live:** `react-native-video@6.19.2` is still `dist-tags.latest`;
`7.0.0-beta.10` is still beta (not GA); `npm audit` shows 0 advisories against
`react-native-video`. RN 0.86.0 GA'd 2026-06-09 — six weeks **before** ADR-0006 was written —
but Livil is still pinned to `0.85.3` (`package.json` unchanged).

## Decision

1. **REAFFIRM ADR-0006** under Constitution P53. No trigger has fired on the intended reading:
   `6.19.2` is latest, v7 is still beta, no advisory. Maintain the patch; do not migrate. No new
   evidence contradicts the original reasoning.
2. **RECOMMEND the founder ratify the content of PROP-0001** — the two test suites are real,
   pass, are CI-gated, and are genuinely useful for what they cover. Correct PROP-0001's stale
   status from "Draft — awaiting ratification" to reflect that the work is already implemented (a
   factual correction; the founder still owns ratification).
3. **SCOPE CORRECTION** — this is the load-bearing finding and must not be smoothed over. The
   hedge is **narrower** than ADR-0006's language ("characterization tests over the coordinate
   translation") implies. What is actually tested: (a) the three-location JS↔native
   prop-declaration mirror — genuinely load-bearing, the test strips comments to avoid false
   positives and reads the real patched files, and mutation-testing confirms it catches a dropped
   declaration; and (b) JS-side clip-JSON serialization (`buildCurrentClipJson`: unit conversion
   + an explicit `active` flag). What is **not** tested: the actual coordinate arithmetic —
   `position = absolute − clipStart`, `seekTo(p) → super.seekTo(p + clipStart)`, the `coerceIn`
   clamp — which lives entirely in Kotlin, in `ClipForwardingPlayer` inside the patch. Inverting
   that Kotlin arithmetic would leave all 28 JS tests green. There is no Kotlin/Robolectric test
   harness anywhere in CI, so this exact failure mode — the lock screen disagreeing with the app,
   which is precisely what ADR-0006's dissent worried about — remains as unhedged as before
   PROP-0001. The board must state the hedge's scope honestly: "the JS↔native prop-declaration
   seam and JS-side clip JSON are hedged; the native coordinate arithmetic and every other native
   patch behavior (queue advance, notification hashCode/`notifIdFor` identity, the 250ms
   clip-end watcher, `naturalEndListener`) remain unhedged and untestable by the current suite."
   Nobody should read "PROP-0001 ratified" as "the patch is now safety-netted."
4. **GOVERNANCE FINDING, recorded not laundered:** the implementing commit (`008d427`) landed the
   same day as, and after, the commit adding PROP-0001, while the proposal still reads "Draft."
   The charter says propose → ratify → implement are three actors that must not be collapsed;
   there is no documented "human commits are exempt" carve-out. The board records that the
   sequence was inverted and no ratification artifact exists — this is a finding to log, not a
   reason to revert good tested work, and explicitly **not** a precedent: the gate exists for the
   case where the code is not competently done.
5. **DISAMBIGUATE ADR-0006 trigger #1.** "React Native 0.86" is ambiguous, and under the literal
   "ships upstream" reading it had already fired before ADR-0006 was written (0.86.0 GA
   2026-06-09). This companion ADR fixes the wording: the trigger is **RN 0.86 adoption** (Livil
   bumping its pin off `0.85.3`), not 0.86's upstream release. On that reading it has not fired.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Ratify PROP-0001 as "the hedge is done / the patch is safety-netted" | False-confidence: the native coordinate arithmetic that the dissent worried about is untested and untestable by this suite. Overclaims coverage |
| Silently flip PROP-0001 to Ratified and move on | Launders a real governance inversion (code shipped before ratification) and hides the scope gap. Record both instead |
| Reopen ADR-0006 because trigger #1 "already fired" | The literal reading is a drafting defect, not a real trigger — the pin is unchanged at 0.85.3. Disambiguate the wording rather than reopen the decision |
| Migrate off the patch / to v7 | ADR-0006 already rejected this; v7 is still beta with zero patch reuse |

## Consequences

**Good:** the governance loop is closed honestly; the prop-mirror seam (the highest-value cheap
boundary per P30) is now regression-tested; trigger #1 is unambiguous.

**Costs / made-hard:** the real risk — native coordinate arithmetic and background auto-advance —
is still unhedged, and closing this must not lower the perceived urgency of the true triggers
(0.86 adoption, v7 GA). Testing the Kotlin arithmetic would need a native test harness that does
not exist and whose feasibility (Robolectric/ExoTestUtil unit test of `ClipForwardingPlayer`, or
whether a device is genuinely required) is unverified.

## Dissent

- The adversarial critic could not refute that the prop-mirror test is load-bearing (it does what
  it claims). It did refute the framing that the characterization tests cover "the coordinate
  translation" — they cover the wrong half of the JS/Kotlin boundary — and the board adopts that
  correction wholesale (Decision §3).
- One principal raised the process inversion as a first-class objection, not a footnote; recorded
  in Decision §4.
- Both principals initially read trigger #1 charitably; the critic pushed that the charitable
  reading was assumed, not proven — resolved by disambiguating the text (§5).

## Revisit when

- Livil adopts RN 0.86 (bumps its pin) — trigger #1, now unambiguous.
- `react-native-video` v7 goes GA; or 6.x stops receiving security backports; or an advisory
  lands against the pinned version (ADR-0006 triggers, unchanged).
- Someone establishes whether a Kotlin/Robolectric unit test of `ClipForwardingPlayer`'s
  arithmetic is feasible — if so, the real hedge gap (Decision §3) can finally be closed.

## Follow-on work

[PROP-0001](../debt/proposals/0001-hedge-the-patch.md) — recommended for founder ratification
with the scope correction above; its status is corrected to reflect the work is already
implemented. The unhedged native-arithmetic gap is recorded as a revisit trigger, not a new
proposal (its feasibility is unverified and `patches/**` is closed to agents).

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
