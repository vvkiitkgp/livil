---
tier: 3
owner: principal-security
consumers: [P-SE, SR, BE, CR]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Authentication & Session Architecture

How identity is established and carried. **Authorization** — what an identity may do — is a
separate concern enforced in the database; see [../security/model.md](../security/model.md).

> **Scope note.** This document describes the architecture and its invariants. Known
> weaknesses in this area are tracked in the private threat model, not here, because this
> repository is public. Absence of a concern from this page does not mean none exists.

---

## There is no AuthContext

Session state lives as local state in `RootNavigator`. There is no context exposing the
current user.

The consequence is concrete: **dozens of call sites independently call `supabase.auth.getUser()`**
to re-derive the current user id — screens, cards, sheets, the floating player. That is a
network round trip unless cached, repeated across the app.

A context exposing `{ session, userId }` would remove all of them. This is recorded debt, not
a design choice — it accumulated.

---

## The session gate is four-state, not two

`RootNavigator` does not simply branch on signed-in. It resolves four states in order:

| State | Condition | Renders |
|---|---|---|
| **Splash** | still loading, or signed in but onboarding status unknown | Splash overlay |
| **Password recovery** | arrived via a recovery link | Reset-password screen |
| **Needs username** | signed in, username not yet claimed | Choose-username screen |
| **App** | otherwise | Full provider stack and the navigator |

The ordering matters. A user arriving on a recovery link while signed in must reach the reset
screen, not the app.

### The onboarding gate currently fails open

If the username-status lookup throws — offline, transient server error — the gate resolves to
"does not need username" and the user enters the app un-onboarded.

This is **low severity because the real enforcement is server-side**: username claiming is a
database function, and a trigger makes the username immutable once set. The client gate is a
routing convenience, not the control. But it does produce users in a half-onboarded state, and
the failure direction is the wrong one.

---

## Session lifecycle

```
getSession()
  → supabase.realtime.setAuth(token)      ← REQUIRED, see below
  → register push device
  → resolve onboarding status
  → clear splash

onAuthStateChange
  → setAuth(token) again, every event
  → SIGNED_IN   : guarded so token refresh does not re-run onboarding
  → SIGNED_OUT  : clear message cache, unregister push device, reset gates
```

Client configuration: sessions persist to AsyncStorage, tokens auto-refresh, and URL session
detection is off (correct for React Native).

**Two non-obvious requirements:**

1. **`realtime.setAuth` must be called on every auth event.** Without a fresh JWT, realtime
   subscriptions gated by row-level security are dropped **silently**. See
   [realtime.md](realtime.md).
2. **Sign-out must clear the message cache.** The cache is not keyed by user, so skipping this
   leaks one user's inbox to the next user on the same device.

---

## Sign-in paths

| Path | Notes |
|---|---|
| **Email + password** | Also accepts a username, resolved to an email server-side first |
| **Google** | Browser-based OAuth via the system browser, returning through the app's URL scheme |
| **Password reset** | Emailed recovery link → recovery gate → set new password |

Two deliberate anti-enumeration behaviours, worth preserving:

- Username sign-in reuses the **wrong-password** wording when the username does not exist, so
  the response does not reveal which usernames are registered.
- Sign-up handles the provider's deliberately ambiguous response for an already-registered
  address rather than reporting "this email exists."

### A known inconsistency

The Supabase client is configured for **implicit** flow, while the deep-link handler contains a
**PKCE** code-exchange branch. Under implicit flow no code verifier is stored, so that branch
cannot succeed — the fragment-token branch is what actually runs.

Either the code path is dead, or Google sign-in does not work the way the code suggests.
**This has not been resolved and should be**, since PKCE is also the more appropriate choice
for a mobile client. Recorded in the debt register.

---

## Deep links

There is **no `linking` config** on the navigator. Deep links are handled manually: the app
listens for its custom scheme and inspects the URL for an auth code, tokens, or a recovery
marker.

The scheme is registered as browsable in the Android manifest, which means **any web page can
open it**. Everything arriving through that channel is untrusted input from outside the app
and must be treated as data, never as authority (Constitution P19).

**Rules for anyone touching this code:**

- Never log the full deep-link URL. It can carry credentials into the device log.
- Never adopt a session from link-supplied material without validating it.
- Widening what the handler accepts is a security change, not a convenience change, and needs
  security review.

Push-notification navigation is a **separate** path — it goes through a navigation-ready queue
because the navigator may not exist yet when a cold-start tap arrives.

---

## Identity model

- **Username is claimed once and is then permanent**, enforced by a database trigger rather
  than by the client. Users arriving via OAuth without a username are gated until they claim one.
- Private profile fields (date of birth, phone) live in a **separate table** from the public
  profile, so ordinary profile reads cannot expose them.
- **A device token is bound to a `(user, device)` pair** and unregistered on sign-out.

## Related

- [../security/model.md](../security/model.md) — authorization, the perimeter
- [realtime.md](realtime.md) — why the JWT must reach the realtime client
- [backend.md](backend.md) — the service layer
- 🔒 Known weaknesses: private threat model
