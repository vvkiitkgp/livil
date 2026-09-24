---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0015, 0018]
---

# ADR-0021 — Retire the waitlist backend

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-09-24 |
| **Domain** | data + security (with client) |
| **Decided by** | human (maintainer), on a footprint review prompted by a stale counter in `/ops` |

---

## Context

ADR-0015's appended outcome (2026-09-02) removed the waitlist *capture* — the sign-in form, the
`EarlyAccessCard`, `joinWaitlist()` — and explicitly declined to remove the backend:

> **Kept, deliberately.** The `waitlist` table, its RLS, the `waitlist-join` / `waitlist-invite`
> edge functions and the `/ops` roster all stand. […] retiring the backend is its own decision,
> with its own data question, not a side effect of deleting a form.

This is that decision. The facts that had not been assembled in one place when it was deferred:

- **Nothing has written to the table since 2026-08-07.** Ten rows exist: eight people who were
  invited in August and already hold accounts, and two rows from testing the form itself.
- **Nothing calls either edge function.** `waitlist-invite` was reachable only from the `/ops`
  Send button; `waitlist-join` was reachable only from the marketing form deleted three weeks
  earlier. A repository-wide search finds no other caller in either client.
- **`waitlist-join` is deployed with `verify_jwt` FALSE** — the only function in the project
  that is. It holds `RESEND_API_KEY` and writes rows. That was correct while an anonymous form
  had to reach it; with the form gone it is an unauthenticated write-and-send endpoint serving
  nothing. It was still ACTIVE at the time of this decision.
- **`waitlist_request` is one of five SECURITY DEFINER functions deliberately granted to `anon`**
  (`scripts/check-definer-anon-grants.mjs`), justified in that allowlist as "the waitlist form is
  public by design". The form it names does not exist.
- **The table has no foreign keys in either direction.** Nothing depends on it structurally.

The trigger was cosmetic and worth recording, because it is the argument for reading a counter
you cannot explain: a "2" appeared on the new People tab in `/ops`, counting the two never-emailed
test rows. Chasing what the number meant surfaced the open endpoint.

## Decision

Remove the waitlist end to end.

- `public.waitlist` is dropped, taking its three policies and its index.
- `public.waitlist_request(text)` and `public.waitlist_mark_emailed(uuid, text)` are dropped, and
  their entries leave the anon-grant allowlist.
- The `waitlist-join` and `waitlist-invite` edge functions are deleted from the repository and
  from the project. **`waitlist-join` goes first** — the security finding is the urgent half, and
  a deployed function whose table has gone answers 500 rather than 404.
- The studio loses `data/waitlist.ts`, `data/invite.ts` and the Waitlist section of `/ops`.
- The ten rows are archived outside this repository before the drop. They are not re-imported
  anywhere: every address either belongs to an existing account or was a test.

**`ops_users` and `is_ops()` stay.** They were created by
`20260805000000_waitlist_ops_dashboard.sql`, whose filename says waitlist and whose contents are
the access gate for the entire backstage — the reports queue, the copyright queue, the user
roster, badge grants, the team inbox. Reverting that migration is the obvious way to do this job
and it would lock every operator out of the dashboard. The drop migration's verify block fails if
either object goes missing, so the trap is caught by the migration rather than by a reader.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Keep the table, remove everything else** — ADR-0015's position, restated | The data question it was protecting has since answered itself: the addresses belong to people who accepted and now have accounts, so the table is a duplicate of `auth.users` for eight rows and noise for two. Keeping a table no code reads is how `waitlist` became write-only in the first place — the original defect this whole area was built to fix. |
| **Drop only the table** | Actively worse than doing nothing. `waitlist-join` stays deployed and unauthenticated, and starts returning 500s — an endpoint that looks broken rather than absent, which invites someone to "fix" it. |
| **Delete `waitlist-join` and stop there** | Removes the risk, leaves the debt: a dead section in `/ops`, two orphaned modules, an allowlist entry justified by a form that does not exist, and a counter nobody can explain. The cosmetic complaint that started this is unaddressed. |
| **Keep `waitlist-invite` for future campaign mail** | Raised by ADR-0018, which calls it "the campaign's ignition" and proposes adding it to `REQUIRED_FUNCTIONS`. It is an invite mailer addressed to a waitlist; a campaign sender is a different function with a different recipient set and a different opt-out story. Keeping this one to avoid writing that one would ship the wrong contract early. |

## Consequences

**Easier.** One fewer public attack surface, and the project returns to having no unauthenticated
edge function at all — a property worth being able to state plainly. The anon SECURITY DEFINER
allowlist drops from five entries to four, and the one removed was the least defensible. `/ops`
loses its longest section.

**Harder.** Re-opening a waitlist means rebuilding the table, the RPC, the mailer and the roster.
That is the correct cost: a gated-access mechanism designed for closed testing is not the one a
paid tier or a regional launch would want, and restoring it would bias that design.

**Foreclosed.** The ten addresses stop being queryable from the product. The archive is a CSV
held outside the repository, which is deliberately inconvenient — it is a record, not a list to
mail. **This is not reversible from inside the application.**

**Not affected.** `welcome-email` mentions the waitlist functions in comments only, as the shape
it was modelled on; it reads nothing from these objects and account signup is untouched.

## Dissent

*Recorded from ADR-0015 rather than from a live objection.* That ADR argued the table "holds real
addresses collected under a stated purpose, and `/ops` is the only way to read them back", and
that deleting it should not be a side effect. That reasoning is accepted and is the reason this is
a separate ADR with its own archive step — but as a conclusion it has expired: the stated purpose
was fulfilled seven weeks ago, and continuing to hold eight addresses whose owners already have
accounts is retention without a purpose, which is the weaker position under both the original
argument and data-minimisation.

## Revisit when

- Livil needs gated access again — a paid tier beta, a regional launch, an invite-only feature.
  **Build it new.** Do not restore these objects; the design question will not be the same one.
- Campaign mail becomes real (ADR-0018 §4). That needs a sender with its own recipient model and
  opt-out handling, and `REQUIRED_FUNCTIONS` should gain *that* function, not this one.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
