---
tier: 4
owner: principal-data
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# ADR-0004 — Clients talk to Postgres directly; no API tier of our own

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | ~2026-04 (backfilled 2026-07-21) |
| **Domain** | data |
| **Decided by** | Human, at project inception |

---

## Context

Livil is built and maintained by one person. It needs a database, authentication, file storage,
realtime updates, and push delivery.

An API tier of our own would mean a service to write, deploy, monitor, secure, scale, and keep
available — before any product feature exists.

## Decision

**The mobile client talks to Postgres directly** through the provider's REST layer and database
functions. Server-side logic lives in Postgres as functions and triggers. There is one edge
function, for push fan-out.

**Row-level security is the authorization boundary.** Not one layer of several — the only one.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Our own API service | An entire operational surface for one maintainer, before any feature exists |
| Serverless functions as a full API tier | Rebuilds the API tier with worse ergonomics and cold starts, and the provider's edge runtime has hard CPU limits |
| A backend-as-a-service with a proprietary database | Postgres is portable; a proprietary store is not. This mattered — the database is the one layer we could actually take elsewhere |
| GraphQL layer | More surface, same authorization question underneath |

## Consequences

**Good:**

- No server to operate. For a solo maintainer this is decisive, not merely convenient
- No duplicated validation between tiers
- **Authorization cannot be bypassed by a privileged middle tier, because there isn't one**
- The database itself is genuinely portable — standard Postgres, dumps out cleanly

**Costs, and they are structural:**

- **One enforcement point.** A policy gap is not a hardening gap; it is the absence of
  authorization. There is no second layer to catch a mistake.
- **`SECURITY DEFINER` functions are holes in the only perimeter** and each must prove its own
  check. Three currently do not — see the private threat model.
- **The query shape is the API.** A schema change is a client contract change.
- **No natural place for rate limiting**, secret-holding operations, or server-side validation.
  The absence of abuse controls follows directly from this decision.
- **Storage objects are public URLs.** Policies gate writes, not reads — so row-level privacy
  does not extend to media.
- **Vendor concentration.** Auth and realtime are the anchors; the database is not.
- Every screen manages its own fetch and refresh state, since there is no cache tier.

## Dissent

*None recorded at the time.* Recorded now: this decision is the root cause of several items in
the debt register, and it will be the thing to revisit if the product needs server-side
validation, rate limiting, or media privacy. **That is not an argument that it was wrong** — it
was right for a solo maintainer shipping a first version, and it is why the product exists at
all. But it should be re-examined deliberately rather than defended reflexively.

## Revisit when

- **Abuse becomes real** and needs rate limiting or moderation tooling that has nowhere to live
- **Media privacy becomes a product promise** rather than a listing filter — signed URLs need a
  server-side signer
- Server-side secrets are needed for an integration
- The team grows beyond the point where one person holds the whole authorization model
- Provider concentration becomes an unacceptable business risk

**Partial exits are available and cheaper than a rewrite.** A thin service can be introduced for
specific operations — signing URLs, rate-limited endpoints — while everything else continues to
talk to Postgres directly. That is the likely path, not a wholesale migration.
