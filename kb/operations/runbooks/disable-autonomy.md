---
tier: 3
owner: chief-architect
consumers: [ALL, human]
last_verified: 2026-07-21
verify_every: 180d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Runbook — Turn Agent Autonomy Off

**Do this first, ask questions second.** Re-enabling costs one commit. Leaving it off
while you think costs nothing.

---

## The switch

Set the **first line** of `.claude/AUTONOMY_ENABLED` to `disabled`.

```bash
echo "disabled" > .claude/AUTONOMY_ENABLED   # then commit and push
```

Or edit it in the GitHub web UI — no clone, no credentials, no working local
environment. That is deliberate: the moment you need this is likely a moment when
something else is already broken.

Deleting the file has the same effect. Absent means off.

---

## What this does

**Blocks** every agent-authored change at CI, regardless of scope or tier. Since agent
work reaches `main` only through a PR that CI gates, nothing agent-authored lands.

**Does not:**

| | |
|---|---|
| Revert what has already merged | Use `git revert`; see below |
| Stop a running agent session | **Close the session** |
| Affect human commits | By design — you still need to be able to work |

It is a gate on landing, not a stop button on execution.

---

## If something has already merged

1. **Turn the switch off first**, before investigating. Stop the bleeding, then diagnose
   (see [incident-response.md](incident-response.md)).
2. `git revert <sha>` — a revert commit, not a force-push. History stays honest.
3. If it reached production, the release path is manual and forward-only; a fix ships as
   a new build. There is no rollback button.
4. **Write the incident** in `kb/private/incidents/`. Constitution P2 — *we pay for a bug
   once* — is unenforceable without the record.

---

## If an agent is mid-task

Close the session. The switch prevents its work landing; it does not interrupt it.

If it holds a database connection or has applied a migration, check production state
directly — an applied migration is not undone by closing anything.

---

## Turning it back on

Set the first line to `enabled`, commit, push.

**Before you do**, be able to answer: what happened, and what stops it recurring? If the
answer is "nothing yet", it is reasonable to leave the switch off. An organization that
cannot be paused is not one you control.

---

## Verify the switch actually works

Annually, and after any change to `scripts/enforce-agent-scope.mjs`:

```bash
git checkout -b agent/killswitch-probe
touch src/utils/__probe.ts && git add src/utils/__probe.ts

echo "disabled" > .claude/AUTONOMY_ENABLED
node scripts/enforce-agent-scope.mjs --staged   # expect: FAIL, exit 1

echo "enabled" > .claude/AUTONOMY_ENABLED
node scripts/enforce-agent-scope.mjs --staged   # expect: PASS

git reset && rm -f src/utils/__probe.ts
git checkout - && git branch -D agent/killswitch-probe
```

A switch you have only seen in the `enabled` state is a switch you have not tested.
