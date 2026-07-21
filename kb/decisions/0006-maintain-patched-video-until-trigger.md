---
tier: 4
owner: principal-playback
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [2]
---

# ADR-0006 — Maintain the patched video library until a named trigger fires

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-07-21 |
| **Domain** | playback (with platform) |
| **Decided by** | Architecture Board — bootstrap debate 1 |
| **Participants** | principal-playback, principal-platform, adversarial-critic |

---

## Context

[ADR-0002](0002-patched-video-library.md) chose to patch `react-native-video` rather than adopt
a track player. Since then the patch has been described — in this knowledge base and in
CLAUDE.md — as "the largest upgrade obstacle in the project."

The board was asked whether to plan a migration off it or commit to maintaining it.

**Both principals independently found that framing misleading.** Positions were written in
parallel with no cross-visibility, and converged.

### What was verified

| Claim | Finding | How |
|---|---|---|
| We are behind on upgrades | **False. `6.19.2` IS `latest`** (published 2026-04-28) | `npm view react-native-video dist-tags` |
| Upstream is dying | **False.** Releases Jan, Mar, Apr 2026; `7.0.0-beta.10` Jun | `npm view … time` |
| We carry an unpatched advisory | **False.** 18 tree vulns, none in this package | `npm audit` |
| The patch is 1,373 lines | **Diff lines. 923 added / 12 removed real lines**, ~99% additive | patch analysis |
| Conflict surface is the whole patch | **12 removed lines across 4 files**, plus re-anchoring | extracted every `-` line |
| It is archaeological | **28% comment density**; each hunk names the incident it prevents | read the hunks |
| Upgrade cost is unmeasured | **Measured.** Patch applied against a clean 6.18.0: **15/16 files clean, 1 of 44 hunks failed** (iOS) | `patch --dry-run` |
| v7 might supersede our patch | **No.** v7 has no `onNextTrack`, `setMediaItems`, or clip presentation | grep of the v7 tarball |

**v7 is a ground-up rewrite** — namespace `com.brentvatne.*` → `com.twg.video.*`, new peer
`react-native-nitro-modules`. Patch reuse is **zero**, and it still lacks the three behaviours
we patched in.

## Decision

**Maintain the patch. Do not plan a migration.** But convert an open-ended commitment into a
bounded one, because indefinite commitment without triggers is how debt quietly becomes
architecture (Constitution P58).

**Triggers — any one reopens this:**

1. **React Native 0.86** — the real unknown. Both principals flagged it; neither could size it.
   Peer ranges declare `react-native: "*"`, so metadata carries no compatibility signal at all.
2. **v7 goes GA** → timeboxed rebase spike, not a migration.
3. **6.x stops receiving security backports** once v7 ships.
4. **A security advisory** lands against the pinned version.
5. **ADR-0005 resolves to support iOS** — the one failing hunk was iOS, and ~86 lines of Swift
   are unverified.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Migrate to v7 now** | Beta, zero patch reuse, and it lacks the features we patched in — we would rebuild the same patch on an unstable base. Strictly worse |
| **Migrate to a track player** | ADR-0002's rejection stands unless re-tested by *building*. Neither principal re-verified the v4 crash claim; it is inherited, not confirmed |
| **Commit indefinitely, no triggers** | The rejected middle. Removes the forcing function that makes deferred cost visible |

## Consequences

**Good:** no work is done to solve a problem we do not currently have. We sit on `latest` with
no advisory.

**Costs, accepted:**
- Upstream security fixes remain manual
- The three-location prop mirror still fails silently
- Cost is deferred and lands **all at once** when a trigger fires
- Native changes still require a full rebuild to observe

## Dissent

**Recorded, and it is the more interesting half of the debate.**

`principal-playback` argued the decision as stated is insufficient: *"My real recommendation is
not 'commit indefinitely' but 'commit until a dated trigger' — characterization tests over the
coordinate translation plus a CI check on the prop mirror. Indefinite commitment without those
is how debt quietly becomes architecture."*

Its sharper point: **migration was never the expensive part.** *"The expense was never writing
the code — it was verifying it on real devices, cars, and lock screens."* Four PRs of
device-verified behaviour are unhedged by any test. A rebase pays a fraction of that cost; a
migration multiplies it.

**The board accepts this dissent as a condition of the decision**, not a footnote — see the
proposal below.

`principal-platform` recorded lower confidence than the decision implies: **medium** that 6.x
minor bumps stay cheap (one measured data point, not a trend), **low** on RN 0.86.

## Follow-on work

The dissent converts into [PROP-0001](../debt/proposals/0001-hedge-the-patch.md):
characterization tests over the coordinate translation (pure, testable today, no device needed)
and a CI check on the three-location prop mirror.

**Neither is a migration. Both reduce the cost of one.**

## Revisit when

Any trigger above fires. **Not** because the patch looks large — that framing was checked and
does not survive contact with the numbers.

## Correction to existing documentation

`kb/architecture/playback.md`, `kb/operations/third-party.md`, and `CLAUDE.md` all describe the
patch as "the largest upgrade obstacle." That is true in the long run and **misleading today**:
we are pinned to the newest stable release. Those documents should be amended to say the cost
is deferred rather than current.

`principal-platform` also self-reported a drift in its own document —
`kb/operations/infrastructure.md` still says "There is no CI," which stopped being true at
commit `e18de88`. *"My file, my defect (P40)."*
