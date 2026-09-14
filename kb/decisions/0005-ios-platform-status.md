---
tier: 4
owner: principal-platform
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
superseded_by: 0016
related_adrs: [0016]
---

# ADR-0005 — iOS platform status

| | |
|---|---|
| **Status** | **Superseded by ADR-0016** — decided as Option B (Revive) |
| **Date** | 2026-07-21 |
| **Domain** | platform |
| **Decided by** | *Not yet decided* |

> **SUPERSEDED. Do not quote this as current.** This ADR recorded an open question and
> asked to be decided rather than revisited. It was decided on 2026-09-08 as **Option B
> (Revive)** — see [ADR-0016](./0016-ship-ios.md). iOS builds, ships, and its regressions
> matter.
>
> The evidence table below was accurate when written (2026-07-21) and is kept as the record
> of what was true then. Every row of it has since been addressed.
>
> ---
>
> *Original note:* This ADR records an open question, not a decision. It exists because the
> ambiguity is itself a cost: agents currently cannot tell whether iOS regressions matter, and
> every cross-platform change carries an unanswerable question about whether to handle iOS.

---

## Context

The repository is a React Native project and nominally targets both platforms. **In practice
only Android ships.**

Evidence, verified 2026-07-21:

| Signal | State |
|---|---|
| Dependency manifest | Unmodified template — no lockfile, no installed pods |
| Entitlements | **None exist** |
| Usage descriptions | **Camera and photo library missing**, despite both being used |
| Location usage string | Present but **empty** |
| Commits touching `ios/` | **3, ever** — initial scaffold, and two incidental cross-platform edits |
| App icons | Sitting untracked in the working tree |
| Playback clip parity | Android-only; iOS clip handling remains JavaScript-driven |

**iOS would not build today**, and if it did it would be rejected at review for the missing
usage descriptions — and would crash at runtime on first camera access.

Meanwhile, code carries real iOS-specific handling: clip-end logic gated to iOS, and an
explicit constraint that the full-screen player must never set
`disableAudioSessionManagement` because of an iOS process-wide singleton. **We are paying an
iOS tax in code complexity while getting no iOS product.**

## Decision

**Decided 2026-09-08: Option B (Revive).** See [ADR-0016](./0016-ship-ios.md).
The two options as they were framed:

### Option A — Formally Android-only

Declare iOS unsupported. Keep the directory (removing it is disruptive and forecloses the
future) but state clearly that it is unmaintained.

- **For:** stops the ambiguity; agents ignore iOS regressions with confidence; no wasted effort
  on a platform that does not ship
- **Against:** forecloses roughly half the mobile market until reversed; the reversal cost grows
  as more Android-only assumptions accumulate

### Option B — Revive

Commit to making iOS build and ship: install pods, add entitlements and usage descriptions,
finish clip parity in the iOS now-playing manager, verify background audio and the ring switch,
and confirm the on-device decoder does not claim the audio session.

- **For:** doubles addressable market; forces genuinely cross-platform discipline
- **Against:** substantial work, an Apple developer account, a second release pipeline, a second
  device matrix — and **it roughly doubles the surface that the currently-nonexistent test
  suite would need to cover**

## Alternatives considered

| Alternative | Why not |
|---|---|
| Leave it ambiguous (status quo) | **This is the current state and it is the worst one.** Ambiguity has an ongoing cost in every cross-platform change |
| Delete `ios/` entirely | Irreversible-ish and disproportionate. Option A gets the clarity without burning the bridge |

## Consequences

**If A:** the platform document states Android-only; iOS-specific code paths become dead weight
that can be simplified; the roadmap drops iOS testing; the media-session work stays
single-platform.

**If B:** roadmap effort increases materially, particularly in testing; clip parity becomes a
real work item; release process doubles.

**Either way, the ambiguity ends** — which is the actual value of deciding.

## Dissent

*None yet — no decision has been argued.*

Noted for whoever decides: the iOS-specific constraints already documented in the playback
architecture (the audio-session singleton, the JavaScript-gated clip handling) suggest a
non-trivial amount of prior thought went into iOS compatibility. Choosing Option A discards
that investment; choosing Option B builds on it. Neither is free.

## Revisit when

Done. It asked to be decided rather than revisited, and to be superseded by an ADR
recording the choice — [ADR-0016](./0016-ship-ios.md) is that ADR.
