---
tier: 3
owner: principal-data
consumers: [P-DA, P-PF, CA, DC]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Scaling Assumptions

The scale this system is designed for, and the specific points where it stops working.

Constitution P23: build for the next order of magnitude, not the next four — but **name the
scale you are designing for and say when it needs revisiting.** This document is that
statement.

---

## ⚠️ The target scale is not defined

**No usage numbers, growth targets, or capacity goals exist for this project.** There is no
analytics, so current usage is unmeasured, and the product documents that would state a target
(`kb/product/business-goals.md`) have not been written.

That has a concrete consequence: **"will this scale?" is currently unanswerable**, and any
agent asked to weigh a performance concern against a feature has no basis for the trade. It
must escalate rather than invent a threshold (Constitution P63).

Working assumption, stated so it can be corrected: **the order of hundreds of users**.
Everything below is calibrated against that assumption. If it is wrong, the priorities change.

**That assumption now needs re-basing, and no agent should do it alone.** It was written for
closed testing with a public launch named as the next inflection point. The launch happened:
Livil has been live on Google Play since 2026-08-14, on full rollout, with open signup. The
ceiling that a fixed tester list used to impose is gone.

What has NOT changed is that usage is still unmeasured — there is no analytics, so nobody can
say whether the real number is twenty or twenty thousand. Constitution P63 applies with more
force than before, not less: an agent must escalate rather than invent a threshold, because the
one bound that made the old number defensible has been removed. The cliffs below are still the
right cliffs; how close the app now sits to each of them is an open question, and answering it
needs a human with the Supabase dashboard open.

---

## Known cliffs

Each is a place where a design that is fine now stops being fine at a knowable point.

### 1. Presence heartbeat writes

Every foregrounded user writes `last_seen_at` on a fixed interval, to a single table.

| Users online | Writes/sec |
|---:|---:|
| 100 | ~3 |
| 1,000 | ~33 |
| 10,000 | ~333 |

Fine at hundreds. Uncomfortable at thousands. At ten thousand it is a meaningful and constant
write load on the same instance serving every read.

**When to act:** before a public launch, or when concurrent users pass ~1,000.
**Options:** lengthen the interval, batch client-side, or move presence out of Postgres entirely.

### 2. Unbounded queries

Several queries have no limit and grow with user data. **Unbounded is a defect, not a
simplification** (P22).

The sharpest: computing a count by fetching every post from every starred creator over a time
window into the client. At 200 starred creators this pulls thousands of rows to produce one
number. It belongs in a Postgres aggregate.

Others fetch all friendships, all conversation members, all album tracks, all jam queue rows.
Each is fine at tens and painful at thousands.

**When to act:** the aggregate one now — it is cheap to fix and already uncomfortable. The rest
before public launch.

### 3. Single database instance

One project, one region, no read replica, no failover. Every read and write shares it, and it
is a total single point of failure.

**When to act:** when read load affects write latency, or when downtime cost exceeds the cost
of a replica. Not yet.

### 4. Media served as whole files from public buckets

No adaptive bitrate, no transcoding, no CDN we control. Every play downloads a full-quality
file; a 4K video is hundreds of megabytes.

**Egress is likely to become the dominant cost line before compute does**, and it scales with
plays rather than users.

**When to act:** when storage egress becomes material, or when users on poor connections
report stalling. See [../architecture/media-pipeline.md](../architecture/media-pipeline.md)
for the revisit triggers.

### 5. Client-side fan-out

Push notifications are triggered by the client after an action succeeds. A post liked by many
users produces one client-initiated dispatch per like.

**When to act:** when notification volume per event grows — a creator with many followers is
the trigger, not total user count.

### 6. Realtime subscription count

Roughly ten subscription sites, several mounted per screen. Each connection holds channels
open, and providers cap concurrent connections.

**When to act:** when concurrent users approach the plan's connection limit. Check the limit
before launch — it is a hard ceiling, not a gradual degradation.

### 7. Feed query cost

The home feed is a single keyset-paginated RPC — the good pattern, and already an improvement
over what preceded it. It still scales with the number of posts visible to a user.

**When to act:** when p95 feed latency degrades as content grows. Currently the best-engineered
query path in the product.

---

## What is already right

Worth stating so it is not "optimised" away:

- **The feed is keyset-paginated and hydrated in one call** — no N+1
- **Related rows are batched** with `.in(...)` rather than per-row queries
- **Lists are virtualised**
- **High-frequency playback state lives in refs**, so it never re-renders React
- **Waveform analysis is cached and de-duplicated**, so a track is analysed once ever

---

## Instrumentation gap

**We cannot see any of this happening.** No analytics, no performance monitoring, no crash
reporting, no query insight beyond the provider's dashboard.

So every threshold above is a **structural estimate, not a measurement**. The first scaling
action should probably be the ability to observe, not an optimisation — Constitution P21 says
performance work begins with a measurement, and right now we cannot take one.

---

## Before public launch

In priority order. Most are not performance work.

1. **Block and mute** — a safety and store-policy blocker, not a scaling one
2. **Crash reporting and an error boundary** — otherwise launch failures are invisible
3. **Fix the unbounded aggregate query**
4. **Check the realtime connection limit** against expected concurrency
5. **Revisit the presence heartbeat interval**
6. **Decide whether media privacy needs signed URLs** — a product promise question

## Related

- [infrastructure.md](infrastructure.md) — what runs
- [../architecture/backend.md](../architecture/backend.md) — query patterns
- [../architecture/media-pipeline.md](../architecture/media-pipeline.md) — media limits
