---
tier: 2
owner: principal-data
consumers: [BE, P-DA, CR, QA]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Data Access Standards

Conventions for talking to the database. **This is the closest thing this project has to API
conventions** — there is no HTTP API, so the query is the contract.

Architecture context: [../architecture/backend.md](../architecture/backend.md).

---

## Where data access lives

**Screens never call the database directly. Services do.**

```
screen  →  src/services/<domain>.ts  →  supabase-js  →  Postgres
```

A service owns query construction, row-to-type mapping, error translation, and fire-and-forget
follow-up work. It does **not** own React state, and it does **not** import from `src/screens/`
or `src/components/`.

One file per domain. A new domain gets a new file rather than an extension of a loosely
related one.

---

## Choose the error mode deliberately

Three modes, and picking the wrong one either loses failures or breaks a user's action over
something that did not matter.

| Mode | When | Shape |
|---|---|---|
| **Throw** | The user is waiting on this | `if (error) { throw new Error(error.message); }` |
| **Fail-safe** | Non-essential follow-up | `try { … } catch (e) { console.warn(…); }` — never rethrow |
| **Silent** | Almost never | Result discarded |

**Throw** is the default. If a user tapped something and it failed, they must find out.

**Fail-safe** is for work that follows a successful action and does not affect it: push
dispatch, waveform analysis, duration backfill, read-marking. A failed notification must never
break the message that triggered it.

**Silent is the mode to be suspicious of.** Discarding a result means a failure nobody can
observe — including calling a function that does not exist. That has already happened here: a
jam queue RPC is called, does not exist, and fails invisibly because its result is thrown away.

> **Rule:** if you discard a result, say why in a comment. An unexplained discarded result is
> treated as a defect in review.

Translate provider errors through `friendlyErrorMessage` before showing them. Users should not
read raw database messages.

---

## Query conventions

### Pagination

**Anything that grows with user data must be bounded** (Constitution P22).

- Prefer **keyset pagination** — a `(sortKey, id)` cursor — over `offset`, which drifts as rows
  are inserted and gets slower the deeper you go
- Fetch `limit + 1` to detect "has more" without a second count query
- The home feed is the reference implementation: one RPC, fully hydrated, cursor-based

**A query with no limit needs a written justification** — "this list is bounded by
construction" is a valid one; "it is small today" is not.

### Batch, do not loop

Fetch related rows with `.in(...)` after the parent query. Never issue one query per row.

### Prefer parallel simple queries over interpolated filter strings

The `.or()` filter grammar has **its own metacharacters** — `,` `(` `)` `.` — which are not
SQL's. Escaping SQL wildcards is not sufficient; user input can still widen the filter.

```ts
// Fragile: user input reaches the filter grammar
.or(`title.ilike.${pattern},description.ilike.${pattern}`)

// Preferred: two parallel queries, merged in JS
```

Both patterns exist in the codebase; the safe one is already used for track search. **Use it.**

Interpolating anything into a filter string other than a value derived from `auth.uid()` needs
security review.

### Select only what you need

Wide selects on feed queries carry cost per row per user. Do **not** add large columns to feed
selects for data only one screen uses — the waveform envelope is fetched by track id for the
playing track precisely to avoid this.

---

## Row-level security is the authorization boundary

**Do not add client-side owner filters to mutations.** Deletes and updates are issued without
them deliberately, so the dependency on policies is explicit rather than creating a false
impression that the client is enforcing something.

**Every new table needs policies in the same migration that creates it.** A table without
policies is not private by default in any useful sense — see
[../security/model.md](../security/model.md).

**Every new `SECURITY DEFINER` function must check authorization in its own body**, because it
bypasses the only perimeter there is. An authentication check is not an authorization check.

---

## Migrations

- **One migration per logical change.** Name it `<timestamp>_<what_it_does>.sql`
- **Idempotent where practical** — `if not exists`, `drop policy if exists` before create
- **Never edit a migration that has been applied.** Write a forward migration
- **Comment the why at the top** — the existing migrations do this well and it is why they are
  readable a year later
- **Apply to a scratch project first** if the change touches data rather than structure

A migration once referenced a column that did not exist and broke jam rooms for a day. Applying
migrations to a throwaway database in CI catches that class instantly, and is a Phase 1 item.

---

## Backfills

For data filled in after a row is created (duration, waveform peaks):

- **Fire-and-forget** — never block the user
- **Never throw** — a failed backfill must not surface
- **Idempotent** — guard on the column still being null
- **Owner-scoped** — rely on policies, do not widen them for a backfill

---

## Caching

There is no query cache library. Three hand-rolled mechanisms exist (message cache, waveform
cache, AsyncStorage odds and ends) — see [../architecture/backend.md](../architecture/backend.md).

**If you add a cache, it must be keyed by user or cleared on sign-out.** The message cache is
not user-keyed and depends on sign-out clearing it; do not repeat that shape.

---

## Enforcement status

| Rule | Enforcement |
|---|---|
| Services own data access | `ADVISORY` |
| Bounded queries | `ADVISORY` — unbounded queries exist today |
| No interpolation into filter strings | `ADVISORY` — one known violation |
| Policies in the creating migration | `ADVISORY` — the generated RLS inventory reports gaps |
| DEFINER functions carry an authorization check | **Reported** by `npm run kb:generate` |
| Migrations apply cleanly | **Not checked** — Phase 1 CI item |

The privileged-function check is the one genuinely automated control here: `kb:generate` flags
functions that write to access-granting tables without a membership check.

## Related

- [../architecture/backend.md](../architecture/backend.md) · [../architecture/data-model.md](../architecture/data-model.md)
- [../security/model.md](../security/model.md)
