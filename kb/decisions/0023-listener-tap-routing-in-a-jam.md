---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-29
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0001, 0013, 0022]
---

# ADR-0023 — Gate a jam listener's play taps at one point in PlaybackContext

| | |
|---|---|
| **Status** | **Proposed — technical design.** Tap semantics **Escalated** to the product owner (§ Open questions). Not Accepted: see *Protocol deviation* in [ADR-0022](0022-jam-suggestions-store-authorization-delivery.md). |
| **Date** | 2026-09-29 |
| **Domain** | playback + client |
| **Decided by** | Board review, **degraded protocol** — principal-playback, principal-client and adversarial-critic positions were written in one context by the Chief Architect (no dispatch tool). Awaiting human ratification. |

---

## Triage

Split out of the Jam Suggestions request because intercepting a tap means changing
`src/contexts/PlaybackContext.tsx`, which the routing table makes mandatory for principal-playback +
principal-client. Data, security and realtime are covered by ADR-0022. Platform is not routed:
no native code is involved.

**Framed question:** *When a jam listener starts playback from anywhere outside the jam room, where
should that intent be intercepted, and what should it do instead?*

## Context — verified facts

1. **The premise "a listener's tap does not play" is false.** No screen or component checks jam
   state before playing. `PostCard` (`:354,:382,:425`), `SearchScreen:311`, `PlaylistScreen:169`,
   `AlbumDetailScreen:116`, `ConversationScreen:854`, `StoryViewerScreen:571` and `MediaPlayer:194`
   all call `setNowPlaying` + `requestPlay` unconditionally.
2. **What the listener actually experiences today:** the tapped song loads into their engine and
   plays until the host's next heartbeat (≤2 s, `JamRealtimeContext.tsx:381`), which sees a
   different `trackId` and reloads the host's track (`:237`). The tap may also replace the
   listener's local queue and open full screen. If the host has no track loaded and the listener
   never loaded one from the jam, the listener's song **keeps playing** (`:264`).
3. **`jamLocked` exists and is set correctly** — `true` for a non-host listener
   (`JamRealtimeContext.tsx:203`), cleared when the jam ends (`:167`) — but it is only read by
   `FloatingPlayer` to disable expand/full-screen. It is already the right signal, in the right
   context, for a play gate.
4. **The jam mirror itself uses the same entry points** (`setNowPlaying` + `requestPlay`,
   `JamRealtimeContext.tsx:241-259`). A gate on those functions must let the mirror through.
5. **Single engine** ([ADR-0001](0001-single-audio-engine.md)). A listener's engine is occupied by
   the host's stream. A "preview" would need a second audible engine, which is forbidden.
6. **Stories play through the same engine** (`StoryViewerScreen:571`, [ADR-0013](0013-story-clip-session.md)).
   Opening a story as a listener also hijacks the jam stream today.
7. `can_change_track` is honoured by the jam UI (`JamRoomScreen:565,796`) but no UI grants it, and
   **only the host broadcasts** — a co-host's local play would be overwritten by the heartbeat
   exactly like fact 2. The just-added `track_share` card's `canPlay={isHost || can_change_track}`
   inherits this latent bug.
8. `useToast` has no action button (`ToastContext.tsx:16-32`); Undo needs a small extension.
9. `src/contexts/**` is propose-only (no tests; `PlaybackContext` has a 55-entry dependency array).

## Decision

1. **One gate, in `PlaybackContext`, keyed on `jamLocked`.** User-initiated play paths check
   `jamLocked`; when true, they do **not** touch the engine, the queue, or full screen, and instead
   call a single registered handler (`onLockedPlayIntent(post)`), which the suggestions provider
   (ADR-0022) supplies. The jam mirror uses an explicit bypass. The exact API shape (a flag on
   the existing calls vs. a new `playFromUser` wrapper) is left to principal-playback at
   implementation review; **the invariant is: exactly one place decides whether a listener's tap
   may reach the engine.**
2. **This ships even if the Suggests feature does not.** Fact 2 is a bug in its own right; with no
   handler registered, the gate shows a toast ("The host is choosing the music") and does nothing
   else.
3. **What a listener's play tap does (default pending owner answer):** one tap on a song
   → insert a suggestion for that post → toast "Suggested to *room* · Undo". Undo deletes the row
   (ADR-0022 lets the suggester delete). Already suggested → "Already suggested". At the cap →
   "You have 10 suggestions waiting".
4. **Excluded from tap-to-suggest:** stories (blocked with a toast, not suggested — viewing a
   story is not a request to play it for the room), "Play all"/shuffle buttons on playlists and
   albums (blocked with a toast — one tap must never create N suggestions), and the listener's
   own pause/seek/skip controls (unchanged).
5. **Host and co-host taps are unchanged.** Until co-hosts can broadcast, `can_change_track`
   holders are treated as **listeners** for this gate, and the `track_share` card's
   `canPlay` should be `isHost` only.
6. **No in-jam preview.** A listener who wants to audition a song must leave the jam. This follows
   directly from ADR-0001 and is stated to the owner as a constraint, not an option.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Check jam state at each call site** (≥8 sites today) | Every new play surface inherits the bug by default and nothing complains — the argument `20260923060000_blocked_tracks_invisible.sql` makes for RLS over client filters. Duplication across 8+ files with no tests (P26, P15). |
| **Gate inside `GlobalAudioPlayer`** | Too late: the source has already been swapped and the queue replaced. And it moves product logic into the engine component whose do-not-break table is the longest in the repo. |
| **Long-press "Suggest to jam", plain tap does nothing** | Lowest accidental-spam risk, but undiscoverable, and "tap does nothing" is the confusing state this feature exists to remove. Viable if the owner prefers; the gate design is identical. |
| **Confirmation sheet on every tap** | Safe but slow; Undo gives the same protection with one fewer step. Owner's call. |
| **Listener preview through a second, local-only player** | Second audible engine — violates ADR-0001; resurrects audio-focus fights with the jam stream. |
| **Leave today's behaviour** | It is not "blocked"; it is a 2-second hijack that also clobbers the listener's queue (facts 2, 6). |

## Consequences

**Easy:** one testable invariant; new play surfaces are safe by default; the jam mirror is the
only path to a listener's engine.

**Hard / costs:**
- A change to `PlaybackContext`, which has no tests. Per P30 the gate should land **with** a unit
  test that fails if a user-initiated play reaches the engine while `jamLocked` — and that test is
  the natural first step toward graduating `src/contexts/**` from propose-only.
- Each existing call site still needs a small edit so it goes through the gated path and does not
  open full screen or replace the queue first. The gate reduces that to one pattern, not zero edits.
- Toast gains an action button (shared UI component).
- Accidental suggestions will happen with tap-to-suggest; Undo and the per-person cap bound them.

## Dissent

*Constructed, not independently argued — see ADR-0022 Protocol deviation.*

- **Playback lens:** "Do not put product routing in `PlaybackContext`; keep the context a pure
  engine seam and gate at a thin `usePlayIntent` hook that call sites adopt." A legitimate shape;
  it moves the single decision point out of the context but still leaves it single. Left to
  implementation review — the ADR fixes the invariant, not the file.
- **Adversarial critic:** "Tap-to-suggest will surprise listeners who tap to *hear* a song. You have
  no data on how listeners browse during jams." Not refuted; that is why tap semantics are escalated
  rather than decided, and why Undo is required in every variant.

## Open questions for the product owner (Escalated, P63)

1. Plain tap = suggest (with Undo), long-press = suggest, or tap = confirm sheet?
2. Stories during a jam: block with a toast (recommended), or let the listener watch muted?
3. "Play all" on a playlist/album as a listener: block (recommended), or suggest the first song?

## Revisit when

- Co-hosts gain the ability to broadcast (then `can_change_track` holders become hosts for this gate).
- Evidence of accidental suggestions (Undo rate, dismiss rate) is available.
- ADR-0001 is ever superseded (preview becomes possible).

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`.
