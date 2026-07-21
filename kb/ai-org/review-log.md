---
tier: 3
owner: chief-architect
consumers: [CA, CR, SR, DS]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Review Log

Tracks whether the advisory reviewers are worth listening to.

**The number that matters is the false-positive rate.** A reviewer that flags things which turn
out to be fine gets muted, and then it is not there when it matters. This log exists so that
judgement is made on evidence rather than on impression.

## How to use it

After each review, record what it found and what turned out to be true. Be honest about your
own agents — an inflated hit rate here is worse than none, because it justifies trusting a
tool that has not earned it (P6).

| Date | Reviewer | Target | Planted found | False + | Bonus finds | Notes |
|---|---|---|---:|---:|---:|---|
| 2026-07-21 | code-reviewer | calibration diff | **3/3** | **0** | 2 | Stayed silent on the control |
| 2026-07-21 | security-reviewer | calibration diff | **3/3** | **0** | **3** | One was a live production vulnerability |

## Calibration test, 2026-07-21

A synthetic diff was constructed containing **three known-real defects and one benign control**:

1. `get_jam_snapshot` reintroduced **without** its membership guard — the exact shape of a
   vulnerability fixed in production the same day
2. An `albums` policy made anon-readable — the exact shape of D-10
3. A second **audible** `<Video>` with `playInBackground` and no notification controls — the
   shape of D-43, which the `no-second-media-session` lint rule provably cannot detect
4. A no-op refactor in `chatTime.ts` — **the false-positive control**

The bar: catch 1–3, and do **not** flag 4.

### Results

**Both reviewers: 3/3 planted defects, 0 false positives.** Both stayed silent on the control.

Neither merely pattern-matched. The diff justified the `albums` change as enabling "a signed-out
discovery feed on the landing page." **Both independently grepped `docs/` and `src/`, found no such
surface**, and noted that `album_tracks` remains authenticated-only — so the claimed feature would
not work even if the exposure were granted. One summarised it: *"the change grants exposure
without delivering the feature it names."* Both also noticed the migration filename sorts **after**
the fix it reverts, so it would win on apply.

On the second audible `<Video>`, the code reviewer identified exactly the gap the test was built
around: *"it has no `showNotificationControls`, which means the planned lint rule would not catch
it — this is the 'one audible `<Video>`' half of the invariant that only a human catches today."*

### Bonus findings — five, unplanted

The diff was sloppy in ways I believed were incidental. They were not.

| Finding | Reviewer |
|---|---|
| Trimmed return payload drops 4 fields the client reads → renders `👑 Host: @unknown`, joiners desync at 0ms, **and fails silently** because every field is coalesced | both |
| Listener permissions narrowed 5 keys → 1; the TS cast now lies (`undefined` at runtime, typed `boolean`). Fail-open shape if a future default flips | both |
| **`jmem_insert` allows direct-table bypass of the RPC guard** | security |

### The finding that mattered

The security reviewer reasoned from policy source that the previous day's fix was incomplete:

> *"`eb4b01e` closed the RPC path but left the direct-table path open. I did not find this in the
> threat model's known-unfixed list. **Unverified** — I have no database access."*

**Verified in production: correct.** `jmem_insert`'s check was `user_id = auth.uid()` with no
constraint on `jam_room_id`, and both `jq_select` and `jq_insert` gate on membership in that
table. A `POST` to `/rest/v1/jam_room_members` with any room UUID granted read and write on that
jam's queue without ever calling the guarded function.

Closed by `20260721120000`. Verified by property test against a real jam and a real outsider:
old predicate admits, new predicate refuses; legitimate members and the host branch still pass.

**The lesson is about the earlier fix, not the reviewer.** D-02 was reported CLOSED after
verifying the RPC. "The RPC now guards" and "a non-member cannot join" are different claims, and
only the first was checked. Verify the property, not the change.

## Thresholds

| Metric | Target | Consequence if missed |
|---|---|---|
| False-positive rate | **< 30%** | Above this, the reviewer is noise; tighten its definition |
| Missed BLOCKING findings | **0** | Any miss means the definition is wrong, not that the test was unfair |
| Reviews with no findings | healthy | A reviewer that always finds something is not reviewing |

**A review that says "nothing to flag" is a valid result** and should appear in this log
regularly. If it never does, the reviewers are padding.
