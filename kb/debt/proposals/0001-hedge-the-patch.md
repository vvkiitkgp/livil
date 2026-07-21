---
tier: 4
owner: principal-playback
consumers: [CA, TR, ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [6]
---

# PROP-0001 — Hedge the patch instead of migrating off it

| | |
|---|---|
| **Status** | **Draft — awaiting human ratification** |
| **Date** | 2026-07-21 |
| **Domain** | playback |
| **Addresses** | [ADR-0006](../../decisions/0006-maintain-patched-video-until-trigger.md) dissent, D-41 |
| **Jira** | *(assigned on ratification)* |

---

## Problem

ADR-0006 decided to keep the patch. `principal-playback` accepted that decision but recorded a
condition: **the expensive part of this dependency was never writing the code — it was verifying
it on real devices, cars, and lock screens.** Four PRs of device-verified behaviour are hedged
by nothing.

Two failure modes are currently invisible:

1. **Clip coordinate translation** — absolute ↔ clip-relative. Errors here produce a lock screen
   that disagrees with the app: visible to users, hard to reproduce, trivial to introduce.
2. **The three-location prop mirror** — a new native prop must be declared in
   `src/specs/VideoNativeComponent.ts`, `src/types/video.ts`, and `lib/types/video.d.ts`. A
   missed mirror **silently drops the prop**. Our own architecture document calls this seam
   "easy to silently break," which is a sentence currently doing a regression test's job.

## Why now

Not urgent, and cheap. Both are testable **today** with no device and no native rebuild, and
both directly reduce the cost of the rebase that ADR-0006's triggers will eventually force.

## Proposal

1. **Characterization tests over the coordinate translation.** Pure functions: round-trip
   absolute → clip-relative → absolute, boundaries, no-clip pass-through, seeks at clip edges.
2. **A contract test over the prop mirror** asserting the three declarations agree, and that
   every prop the JS side sends appears in the native spec.

## Implementation plan

1. Extract or expose the coordinate translation as a pure, importable function *(check first
   whether it already is — do not restructure playback code to make it testable without a
   separate decision)*
2. Write the characterization tests
3. Write the prop-seam contract test
4. Wire both into the existing CI `verify` job

## Scope boundaries

**Not** included: any change to playback behaviour; any restructuring of `GlobalAudioPlayer` or
`PlaybackContext`; device testing; iOS clip parity; anything touching `patches/**` — closed to
every agent.

**If step 1 shows the translation cannot be tested without moving production code, stop and
escalate.** Do not refactor playback to satisfy a test without a decision.

## Risk

Low. Adding tests. The only real risk is step 1 tempting someone into a refactor — hence the
explicit stop condition.

## Verification

The tests fail when the behaviour is broken. **Mutation-test them**: invert a clip boundary,
remove one of the three prop declarations, and confirm a specific named test fails. A test that
stays green through that is decoration (Constitution P29).

## Alternatives

| Alternative | Why not |
|---|---|
| Migrate off the patch | ADR-0006 |
| Do nothing until a trigger fires | The rebase then happens with no safety net, which is the condition the dissent objected to |
| Device-level integration tests | Far more expensive; no harness exists. These two are the cheap subset that covers the silent failures |
