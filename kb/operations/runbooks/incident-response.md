---
tier: 3
owner: principal-platform
consumers: [DO, P-PF, P-SE, human]
last_verified: 2026-07-21
verify_every: 180d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Runbook — Incident Response

For when something is already wrong in production.

**Read the constraint first:** there is no crash reporting, no error monitoring, and no
analytics. **Incidents are discovered from user reports or by using the app.** Assume any
incident has been live longer than you think, and that you cannot measure its blast radius.

---

## Severity

| Level | Meaning | Examples |
|---|---|---|
| **SEV1** | Data exposed, or the app is unusable for everyone | Authorization bypass being exploited; launch crash; total backend outage |
| **SEV2** | A core flow is broken for many users | Playback fails; uploads fail; sign-in fails |
| **SEV3** | Degraded but usable | A screen crashes; notifications delayed |

Playback failures rank higher here than their technical severity suggests. Playback that keeps
working is the product's core promise (Constitution P7).

---

## First moves

1. **Write down what you observed and when.** Memory degrades fast and this becomes the
   incident record.
2. **Establish scope** — one user, one device, one platform version, or everyone?
3. **Establish onset** — which release, which migration, which configuration change?
4. **Stop the bleeding before diagnosing.** Halting a rollout or reverting a migration beats a
   perfect root cause while users are affected.

---

## Containment by type

### Bad release

Play Console → the release → **halt rollout**. This stops new installs; it does **not** roll
back existing ones. There is no automated revert — recovery means shipping a fixed version
forward, which takes a full manual build and review cycle.

### Backend outage

Check the provider's status page. There is no failover and no read replica — the backend is a
single point of failure (see [../infrastructure.md](../infrastructure.md)). If it is a provider
outage, containment is communication, not engineering.

### Data exposure or authorization bypass

**Highest priority; treat as SEV1 regardless of confirmed exploitation.**

1. **Tighten the policy or function immediately** — a restrictive policy that breaks a feature
   is better than an open one. Never weaken to restore a feature (P57).
2. Apply the fix to the hosted project first; commit the migration second.
3. Assess exposure: what data, whose, for how long.
4. **Do not delete evidence.** Preserve logs and state before changing things.
5. Record it, then update the private threat model.

### Migration gone wrong

Migrations are applied by hand, so there is no automated rollback. Write and apply a forward
migration that reverses the change. Confirm on a scratch project first if the change touched
data rather than structure.

### Push delivery broken

The edge function's **source is not in any repository** — it exists only in the provider. That
makes it the hardest component to debug or restore. Check the function logs in the dashboard;
there is no local copy to diff against.

---

## After

Every incident produces an entry in `kb/private/incidents/`. This is not paperwork. Constitution
P2 — *we pay for a bug once* — is unenforceable without a written record, and every
do-not-break rule in this knowledge base exists because someone wrote one.

An entry records:

- **Symptom** — what was observed, not what was wrong
- **Root cause** — the mechanism, not the file
- **Why it was hard to find** — usually the most valuable line
- **The rule it produces** — what changes so it cannot recur
- **The test or check that now catches it** — a rule with no enforcement is a wish (P1)

Incidents are **append-only** and live in the private repository, since they contain
vulnerability detail.

---

## Escalation

Everything escalates to the repository owner — there is no on-call rotation and no second
responder.

**Agents must not** apply production changes, alter provider configuration, or halt a rollout
autonomously during an incident. Diagnose, propose, and hand over. Incident conditions are
exactly when a confident wrong action does the most damage (P16 of the refusal rules: never
take an irreversible action whose necessity has not been confirmed).

## Related

- [keystore-recovery.md](keystore-recovery.md)
- [../deployment.md](../deployment.md)
- [../../security/model.md](../../security/model.md)
