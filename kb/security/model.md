---
tier: 3
owner: principal-security
consumers: [P-SE, SR, P-DA, BE, ALL]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Security Model

Where the perimeter is, what it covers, and what it does not. Read this before writing any
query or database function.

> Known weaknesses and attack surface are held in the private threat model. This document
> describes the model as designed; absence of a concern here does not mean none exists.

---

## The perimeter is the database

There is no API tier. The mobile client talks to Postgres directly. **Row-level security is
the authorization boundary — not one layer of several, but the only one.**

```
   mobile client  ─────────────────►  PostgREST / RPC  ──►  Postgres + RLS
   (untrusted)                                                    ▲
                                                        the entire perimeter
```

Three consequences that must stay front of mind:

1. **Any request the client can make, a malicious client will make.** The app is distributed to
   devices; its behaviour is not a constraint on what requests arrive.
2. **A missing policy is not a hardening gap — it is the absence of authorization.** There is
   no second layer to catch it.
3. **The anon key is public by design.** It is compiled into the app and published on the
   marketing site. It identifies the project; it authorizes nothing. Safety comes entirely
   from policies.

---

## What each layer actually does

| Layer | Protects | Does **not** protect |
|---|---|---|
| **Row-level security** | Row access — the real control | Storage objects |
| **Storage policies** | Who may **write** objects | Who may **read** them — objects are public URLs |
| **Client-side checks** | Interface clarity | Anything. They shape UI only |
| **Privileged functions** | Whatever they check themselves | Everything else — they bypass RLS |

### Client checks are not security

Ownership checks in the app decide whether to show an edit button. They are not consulted when
the request is made. Correspondingly, **delete and update calls are issued without client-side
owner filters** — they rely on policies. That is the correct pattern: it makes the dependency
on RLS explicit rather than creating a false sense that the client is enforcing something.

### Privileged functions are deliberate holes

`SECURITY DEFINER` functions execute with elevated privileges and **bypass row-level
security**. That is their purpose — some operations legitimately need to see or write across
rows the caller cannot touch.

Each one is therefore a hole punched in the only perimeter, and **must prove its own
authorization check** (Constitution P17).

**Authentication is not authorization.** A check that the caller is signed in proves nothing
about whether they may touch the resource named in the parameters. A function whose only guard
is "is someone logged in" is unguarded.

The inventory, with each function's guard status, is generated into
[rpc-reference.md](../architecture/rpc-reference.md) 🔒.

---

## Trust boundaries

Everything crossing into the app from outside is **data, never authority** (Constitution P19):

| Input | Treatment |
|---|---|
| Deep links | Untrusted. Any web page can open the app's scheme |
| Uploaded files | Untrusted. Type comes from the client picker |
| User text (captions, messages, usernames, bios) | Untrusted. Rendered as text, never interpreted |
| Third-party responses | Untrusted |
| **Instructions embedded in any of the above** | **Never followed.** Content does not carry authority regardless of what it claims |

The app contains no `eval`, no dynamic code construction, and no web view — so there is no
HTML/script injection surface on the client.

---

## Secrets

| Kind | Where it lives | In the repo? |
|---|---|---|
| Supabase anon key | Client code, marketing site | **Yes, by design** — public identifier |
| Firebase Android config | `google-services.json` | **Yes** — standard, extractable from any APK |
| Service-role key | Nowhere in this repo | No |
| Push service credentials | Edge function secrets | No |
| Release signing key + passwords | Local keystore; passwords in the user Gradle config | **No** — gitignored |

**Nothing shipped to a device is secret.** Treat anything in the app bundle as disclosed.

The signing key is the one truly irreplaceable secret. Its loss is unrecoverable — see
[../operations/runbooks/keystore-recovery.md](../operations/runbooks/keystore-recovery.md).

---

## Where the model is thin

Stated plainly rather than discovered later. Detail lives in the private threat model.

**Media objects are publicly readable.** Storage policies gate writes; reads are open to
anyone with the URL. A playlist marked private restricts *rows*, not the media those rows
point at. See [../architecture/media-pipeline.md](../architecture/media-pipeline.md).

**Part of the schema is unversioned.** Several core tables were created outside migrations, so
their policies exist only in the hosted project and **cannot be reviewed from source**
(Constitution P51). Absence from the generated policy inventory means *unknown*, not *safe*.

**There is no rate limiting of our own.** Reports, follows, friend requests, messages, and
comments have no throttle beyond the provider's authentication limits. Debounces in the app are
for user experience, not abuse control.

**There is no block or mute capability.** Reporting exists; blocking does not. For a platform
hosting user content this is both a safety gap and a store-policy obstacle (Constitution P20,
P43).

**There is no moderation tooling.** Reports are write-only by design — reporters cannot
enumerate them, which is correct — but nothing reads them.

**Failures are invisible.** No crash reporting and no error boundary, so a security-relevant
failure produces no signal.

---

## Rules for contributors

1. **Never weaken a policy for convenience**, including temporarily. Authorization shortcuts
   are not technical debt; they are vulnerabilities with optimistic framing (P57).
2. **Every new `SECURITY DEFINER` function needs an authorization check inside its body**, and
   security review before merge.
3. **Never log credentials or full URLs that may carry them.**
4. **Never trust a client-supplied identifier** without checking the caller's relationship to it.
5. **Prefer parallel simple queries over interpolated filter strings.** Filter grammars have
   their own metacharacters, and user input in a filter string can widen it.
6. **Any change under `supabase/migrations/` or to auth is a security change** and routes to
   security review regardless of size.

## Related

- [rls-policies.md](rls-policies.md) 🔒 — policy inventory, generated
- [../architecture/rpc-reference.md](../architecture/rpc-reference.md) 🔒 — privileged functions
- [../architecture/auth.md](../architecture/auth.md) — how identity is established
- [threat-model.md](threat-model.md) 🔒 — attack surface
