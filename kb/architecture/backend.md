---
tier: 3
owner: principal-data
consumers: [P-DA, BE, CR, QA]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Backend Architecture

There is no backend service. That single fact explains most of what follows.

---

## The shape

```
screen  →  service (src/services/)  →  supabase-js  →  PostgREST / RPC  →  Postgres
```

**No API tier. No ORM. No query cache.** Screens import service functions directly; services
issue Supabase calls. Server-side logic lives in Postgres as functions and triggers, plus one
edge function for push delivery.

### What this buys and what it costs

**Buys:** no server to operate, deploy, or scale; no duplicated validation between tiers; row-level
security applies uniformly because there is no privileged middle tier to bypass it.

**Costs, and they are real:**

- **Authorization has exactly one enforcement point** — row-level security. There is no second
  layer. A policy gap is not a hardening gap; it is the absence of authorization
  (Constitution P16).
- **The query shape is the API.** Changing a table changes the client contract directly.
- **No cache layer** means every screen manages its own fetch, loading, and refresh state.
- **Privileged functions bypass the only perimeter there is.** Each one must prove its own
  check (P17). See [rpc-reference.md](rpc-reference.md).

This is a reasonable trade for the current scale and team size, and it should be revisited
deliberately rather than drifted out of. See
[../operations/scaling-assumptions.md](../operations/scaling-assumptions.md).

---

## The service layer

Around two dozen modules under `src/services/`, one per domain. Current sizes are in
[inventory.md](inventory.md).

Services own: query construction, mapping rows to app types, error translation, and any
fire-and-forget follow-up work (push fan-out, backfills). They do **not** own React state.

### Error handling has three deliberate modes

Knowing which mode applies is essential — picking the wrong one either loses errors or breaks
a user's action for something that did not matter.

| Mode | Used for | Behaviour |
|---|---|---|
| **Throw** | Anything the user is waiting on | `if (error) throw new Error(error.message)` — the screen catches and surfaces it |
| **Fail-safe** | Non-essential follow-up work | Swallow and log. Push delivery, waveform analysis, duration backfill |
| **Silent** | A small number of presence/read-marking writes | Result discarded entirely |

**Fail-safe is a deliberate choice, not laziness.** A failed push notification must never break
the message that triggered it. A failed waveform analysis must never break playback.

**Silent is the mode to be suspicious of.** A discarded result means a failure nobody can ever
observe — including a call to a function that does not exist. That has already happened here;
see the private undefined-RPC report.

### Backfills

Several fields are filled in after the fact — track duration, waveform peaks. Backfills are
**fire-and-forget, never throw, and idempotent** (guarded on the column still being null, with
owner-scoped policies). A backfill failure must never reach the user.

---

## Query conventions

- **Pagination is keyset-based** where it matters. The home feed is a single RPC returning
  fully hydrated posts — track, author, original author, and whether the viewer liked it — with
  a cursor. That RPC is deliberately `SECURITY INVOKER` so row-level security still gates
  visibility.
- **Batch, don't loop.** Related rows are fetched with `.in(...)` rather than per-row queries.
- **Prefer parallel simple queries over complex filter strings.** The `.or()` filter grammar is
  fragile: its metacharacters are not the same as SQL's, and user input interpolated into a
  filter string can widen the filter. Where a search needs two conditions, two parallel `ilike`
  queries are the safer pattern and are already used in places.

### Known scalability gaps

Several queries have no limit and grow with user data. The worst pulls every post from every
starred creator over a time window purely to compute a count — work that belongs in a Postgres
aggregate. **Unbounded is a defect, not a simplification** (P22). The current list lives in the
debt register.

There is also a presence heartbeat writing per foregrounded user on a fixed interval. It is
fine now and has an obvious ceiling; the number is in
[../operations/scaling-assumptions.md](../operations/scaling-assumptions.md).

---

## Caching

No React Query, SWR, or Redux. Three hand-rolled mechanisms:

1. **Message cache** — AsyncStorage, stale-while-revalidate, capped per conversation, every
   read and write swallowed. **It is not keyed by user**, so sign-out must clear it explicitly;
   otherwise a second user on the same device sees the first user's cached inbox.
2. **Waveform cache** — in-memory `Map` with in-flight de-duplication so a track is never
   analysed twice concurrently. Resolution order: memory → database → on-device decode →
   persist. Failures are deliberately not cached, so a transient error retries.
3. **AsyncStorage odds and ends** — session, device id, notification prompt state, one UI
   onboarding flag.

---

## Server-side code

**In Postgres:** roughly three dozen functions and a handful of triggers. Most are
`SECURITY DEFINER`, which means they bypass row-level security by design. See
[rpc-reference.md](rpc-reference.md) for the inventory and which ones carry an authorization
check.

**One edge function** handles push fan-out. Its source is **not in this repository** — it is
deployed directly to Supabase. That is unversioned production code we cannot review or restore
from source, which contradicts Constitution P51. Getting it into git is recorded debt.

**Edge functions were explicitly ruled out for audio decoding** — a hard CPU limit and no
media tooling make full-song decode unreliable there. That is why waveform analysis is
on-device. Do not revisit unless those limits change.

## Related

- [data-model.md](data-model.md) — schema, generated
- [rpc-reference.md](rpc-reference.md) — privileged functions
- [../security/model.md](../security/model.md) — the authorization perimeter
- [media-pipeline.md](media-pipeline.md) — uploads and storage
