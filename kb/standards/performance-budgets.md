---
tier: 2
owner: principal-client
consumers: [P-CL, P-PF, FE, QA]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Performance Budgets

Explicit numbers, so "is this fast enough?" has an answer that is not a matter of taste.

---

## ⚠️ Most budgets are not set, and nothing is measured

**No performance monitoring, analytics, or crash reporting exists.** There is no way to observe
current performance in production, and no historical baseline to set targets against.

Values below marked **TBD** are deliberately blank rather than invented. A fabricated budget is
worse than none: it looks authoritative, gets enforced, and optimises toward a number nobody
chose (Constitution P8 — evidence before opinion).

**Two things are needed to complete this document**, both from the repository owner:

1. **Target device class.** A budget is meaningless without one — "cold start under 2s" means
   different work on a flagship than on a low-end device.
2. **Which numbers matter to the product**, which follows from
   [`../product/business-goals.md`](../product/business-goals.md), not yet written.

Until then, agents must **escalate performance trade-offs rather than assume a threshold** (P63).

---

## Set

The only budgets currently grounded in something real.

| Budget | Value | Basis | Enforced? |
|---|---|---|:--:|
| **Upload size cap** | **500 MB** | Enforced client-side today | ✅ code |
| **Frame budget** | **16.7 ms** (60 fps) | Platform constant, not a choice | ADVISORY |
| **Waveform decode** | one-shot, audio only, never video | Video decode causes an out-of-memory process kill | ADVISORY |

The frame budget is not negotiable: work that blocks a frame is a defect against the
experience, not a performance nicety (P24). Anything running per-frame belongs on the UI thread
via Reanimated, not in JavaScript.

---

## Not yet set

| Budget | Proposed | Why it matters | Status |
|---|---|---|---|
| Cold start to interactive | TBD | First impression; already engineered with a native splash handoff | **TBD** |
| Warm start | TBD | | **TBD** |
| Feed first page (p50 / p95) | TBD | Previously ~3.2s, now ~1.0s after a migration — a real baseline exists but no target | **TBD** |
| Time to first audio after tap | TBD | Core promise. Probably the single most important number here | **TBD** |
| Screen transition | TBD | | **TBD** |
| Bundle size | TBD | | **TBD** |
| Memory ceiling, playback | TBD | The known crash mode is memory | **TBD** |
| Realtime message → render | TBD | | **TBD** |

**Time to first audio is the one to set first.** Livil's core promise is playback (P7); the
delay between tapping play and hearing sound is the most product-relevant number on this page.

---

## Rules that hold regardless of budget

These do not depend on a threshold and apply now.

**Measure on a real device with real data** (P21). Emulator timings and seeded data are both
misleading, and mobile intuition is reliably wrong — especially about memory.

**Never load an unbounded amount into memory.** The known crash mode in this codebase is
memory: reading a large file into a buffer produced failures that presented as network errors,
and decoding a video pulls the whole file in and the OS kills the process with no JavaScript
error at all. Stream, cap, or refuse.

**Keep high-frequency state out of React.** Playback position updates several times a second
and lives in refs; surfaces poll it. Moving such a value into state re-renders every consumer
at that rate.

**Bound every query that grows with user data** (P22). See
[data-access.md](data-access.md).

**Do not optimise without a measurement.** The optimisation you assume is needed is usually not
the one that mattered.

---

## Known costs, unmeasured

Structural estimates, not measurements. Listed so they are not rediscovered as novel.

| Cost | Shape |
|---|---|
| `PlaybackContext` re-render fan-out | 55-entry dependency array; any change re-renders every consumer |
| Jam heartbeat | Sets state on an interval → all consumers re-render while a jam is active |
| Presence heartbeat | One write per foregrounded user per interval |
| Unbounded queries | Several; the worst fetches many rows to compute one number |
| Media download | Whole-file, no adaptive bitrate — a 4K video is hundreds of MB |
| Production logging | 112 `console.log` calls ship, some on realtime hot paths |

Detail: [../operations/scaling-assumptions.md](../operations/scaling-assumptions.md).

---

## Enforcement status

| | |
|---|---|
| Upload cap | ✅ enforced in code |
| Everything else | **not enforced** — nothing measures it |
| Bundle size check | not configured |
| Performance regression tests | do not exist |

**The first action here is instrumentation, not optimisation.** Until something can be
measured, every budget on this page is an assertion — and this document exists to replace
assertions with numbers.

## Related

- [../operations/scaling-assumptions.md](../operations/scaling-assumptions.md)
- [../architecture/client.md](../architecture/client.md) · [../architecture/media-pipeline.md](../architecture/media-pipeline.md)
