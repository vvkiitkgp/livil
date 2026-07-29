---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-29
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0008]
---

# ADR-0014 — Reject widening `msg_update`; the orphaned-message gap is a product decision

| | |
|---|---|
| **Status** | **RATIFIED** 2026-07-29 — the widening is **Rejected**; the escalated question is **Answered** (see below). |
| **Date** | 2026-07-29 · ratified 2026-07-29 |
| **Domain** | data (with security, client) |
| **Decided by** | Board debate — principal-data, principal-security, principal-client, adversarial-critic; moderated by chief-architect. **Ratified by the human maintainer.** |

> **RATIFIED by the human maintainer, 2026-07-29.** Two rulings were given at ratification:
>
> 1. **The verdict stands as written** — `msg_update` is not widened, no DELETE policy is added, and
>    the RPC and hide table remain deferred with their revisit triggers intact.
> 2. **The escalated product question is answered: ATTRIBUTION ONLY.** When a user deletes their
>    account, Livil erases the *attribution* of the messages they sent, not the *content*. This is
>    Position A — the board's position, consistent with the ratified PROP-0003 boundary. Erasing
>    content would alter other people's record of a conversation they took part in. See
>    *Escalated to the human* below, which this resolves.
>
> Note that the fix for finding 1 under *Live defects* **tightens** `msg_update` (an explicit
> `WITH CHECK`). That is not in tension with this ADR — the rule below prohibits *granting* write
> access to a row the caller did not author, and the fix removes such access rather than adding it.

> **Counterfactual the board could not obtain — since answered.** Every participant named
> `select count(*) from messages where sender_id is null` and none could run it. Executed against
> production on 2026-07-29: **0 orphaned rows** out of **482 messages** (0 soft-deleted; PostgreSQL
> **17.6** confirmed, so the debate's 15.18 version caveat is narrowed but not eliminated — nothing
> was tested through PostgREST). The gap this ADR concerns is therefore **entirely latent**: it
> becomes reachable only when the in-app delete flow ships. principal-client stated a zero count
> changes the ranking, and it does — the live defects above outrank it.

> **Jira:** LIV-75 (split from LIV-15, child of Epic LIV-13). The ticket key in the debate transcript
> was written as "LIV-15e", a provisional label from triage; the created ticket is **LIV-75**. The
> observation that `grep -rn "LIV-15" kb/ .github/` returned zero hits stands as a tracking defect.

---

## Context

- `delete_my_account()` (`supabase/migrations/20260722200000_account_deletion.sql:188`) is live:
  SECURITY DEFINER, zero parameters, acts on `auth.uid()`. Deletion nulls `messages.sender_id` via
  `ON DELETE SET NULL`.
- `msg_update` (`supabase/migrations/20260528000000_chat_jam.sql:277-278`) is
  `for update using (sender_id = auth.uid())` — **no `WITH CHECK`, no membership clause**.
- There is **no DELETE policy on `messages` in any migration**. Verified independently by the
  chief architect: the only `for delete` on a chat table is `rxn_delete` on `message_reactions`.
- So a message whose sender was deleted can be mutated by nobody. The migration's own comment block
  (lines 43-50) recorded this as open against D-62 and named the widening as the likely remedy.
- `kb/debt/proposals/0003-in-app-account-deletion.md` is **ratified** and its Scope boundaries
  explicitly exclude deleting a user's messages from other people's conversations.
- **The product context does not exist.** `kb/product/` contains only `.gitkeep` (verified). Per
  Constitution P63 the board may not invent a product rationale.

**The counterfactual the board could not obtain:** nobody could run
`select count(*) from messages where sender_id is null` against production. All four participants
named it; none could answer it.

**The version caveat — it qualifies every executed result below:**
CI declares production is **PostgreSQL 17.6** (`.github/workflows/ci.yml:272`), the main replay job
runs `postgres:15` (`:105`), and **every execution in this debate was performed on scratch
PostgreSQL 15.18 clusters. Nothing was tested through PostgREST**, which is the only path a real
client uses. All "verified" claims are version-qualified and layer-qualified.

## Decision

1. **`msg_update` is NOT widened** to admit `sender_id is null AND caller is a conversation member`.
   Neither in the bare form nor paired with a freeze trigger.
2. **No scoped DELETE policy is added to `messages`.**
3. **No SECURITY DEFINER redaction RPC and no `message_hides` table is added at this time.** Both are
   deferred, not rejected.
4. **The residual question — what SHOULD close the gap — is escalated to the human**, because it is
   a product and compliance decision, not an authorization one.
5. **Three defects discovered during the debate are separated out and proposed as work that needs no
   product decision and grants no new authority** — see PROP-0005.

A future change violates this ADR if it grants any `authenticated` principal write access to a
`messages` row they did not author, without a ratified product decision about what account deletion
does to message content.

## Why the widening was rejected — record the corrected reason

**This is the most important paragraph in the ADR.** The board's first reason was wrong and the
adversarial critic refuted it. Record both.

**The reason first given (rejected as unsound):** that the widening is *dangerous*. Two principals
independently executed an attack battery against the widened policy on scratch clusters and both
found that RLS is row-level, not column-level, so the grant is the whole row. Verified to succeed:
rewriting `body`; adopting authorship via `sender_id = auth.uid()`; rewriting `kind` to `system` or
`jam_invite` with arbitrary `metadata`; moving `created_at`; repointing `reply_to_id`; relocating the
row to another conversation the attacker belongs to; rewriting the primary key; and — the one that
matters most — **setting `deleted_at` and then setting it back to null**, so the remedy and its
reversal are the same grant and every member holds both.

**Why that reason does not hold.** The adversarial critic built the form the board declined to test:
the widening paired with a `BEFORE UPDATE` freeze trigger permitting only a one-way `deleted_at`
transition. The repository already has two precedents (`conversation_members_freeze_identity`,
`posts_freeze_counter_identity`). Executed result: every attack above returns
`ERROR: only deleted_at may be changed on a message with no sender`, the un-delete returns
`ERROR: a tombstoned message cannot be restored`, the intended write succeeds, and the
`ON DELETE SET NULL` cascade is unaffected. The "it fails open if the trigger is consolidated away"
objection is machine-guarded — `scripts/schema-fingerprint.sql:129-132` fingerprints
`pg_get_triggerdef` and schema-parity is a required check (Constitution P1 satisfied, not violated).
**The widen+trigger form is safe. The board's stated ground was answerable and the board did not
test the answer** — the shared blind spot P10 predicts.

**The reason that survives — futility, not danger.** The widening grants exactly one capability:
setting `deleted_at`. That capability is worth nothing today, on three verified grounds:
- `msg_select` does **not** filter `deleted_at`; the filter lives in the client query at
  `src/services/messages.ts:194`. A tombstone is a rendering convention, not a boundary — the text
  stays readable through PostgREST to any conversation member.
- **"Just fix `msg_select` first" is closed.** principal-data executed it: adding
  `deleted_at is null` to the SELECT policy makes the tombstone **unwritable by anyone including the
  author**, because the SELECT policy is applied to the new row whose `deleted_at` is non-null. The
  fix eats itself. If `deleted_at` is ever to become a real boundary, only a SECURITY DEFINER actor
  can write it.
- No client code can invoke it. `deleteMessage()` (`src/services/messages.ts:301`) has **zero call
  sites** — verified three ways by the critic: grep across `src lib supabase scripts .github`
  returns only its own definition; there is no `import * as` over the messages service; and
  `git log -S deleteMessage -- src` returns one commit, `b5f9a97`, the original Phase-1 chat. It was
  introduced unwired and never touched.

Also record, because it is a genuine cost of rejecting: the widen+trigger form would have closed the
orphan asymmetry cheaply. It was rejected because what it buys is not reachable by any user, not
because it is unsafe. That distinction is what a future reader needs.

## A premise the board asserted and the critic falsified

Record this explicitly, attributed, because the whole "fold into moderation" recommendation rested
on it.

**Asserted (principal-data, adopted by principal-security and principal-client):** "today no user can
remove any message from a conversation, orphaned or not" — therefore the orphan case is not special,
it is the normal case missing its usual workaround.

**Falsified by the adversarial critic, by execution:** under today's `msg_update`, as the author,
`update messages set deleted_at = now()` returns `UPDATE 1`, and `set deleted_at = null` also returns
`UPDATE 1`. **Every living author already holds the exact capability the widening would grant the
orphan.** `deleteMessage()` being unwired is a missing *button*, not missing *authority*. The correct
statement is the inverse of the board's: only the orphan lacks it. **The asymmetry the board denied
is real**, and it is precisely the kind of thing a board exists to decide.

This does not change the verdict — the widening is still futile for the reason above — but it removes
the board's stated justification for treating the ticket as purely a moderation matter.

## Live defects discovered during the debate

These were found while answering the question and are **not** consequences of it; each predates the
ticket. They grant no new authority to anyone and need no product decision, so they are separable
from the escalation below.

> **Detail withheld — held privately by human decision, 2026-07-29.**
> Five findings (four on `messages`, one accumulation issue) are recorded with their reproduction
> detail and fixes in **`kb/private/debt/proposals/0005-restore-the-messages-write-boundary.md`**.
> They are **live and unfixed in production**, and this ADR is published from a public repository —
> so the reproduction detail is not carried here. Public stub:
> [PROP-0005](../debt/proposals/0005-restore-the-messages-write-boundary.md).
>
> Summarised without method, so this ADR still says what was found:
>
> 1. The `messages` UPDATE perimeter is weaker than intended, in a way that lets a sender alter
>    another person's record of a conversation. **This is a live breach of the very PROP-0003
>    boundary this debate was organized around.** The remedy is a tightening, not a widening, and so
>    is consistent with the Decision above.
> 2. Message `kind` and `created_at` are unconstrained on insert, permitting content that renders in
>    the application's own narrator voice. Constitution P19 inverted: content from outside acquiring
>    authority.
> 3. Attacker-controlled URLs in message `metadata` are dereferenced by the renderer without user
>    action. *(principal-security **withdrew** the stronger claim that this yields server-side access
>    — `get_jam_snapshot` raises `not_conversation_member` first. The finding is a UI deception, not
>    a privilege escalation.)*
> 4. Two remedy paths discard their errors silently. A silent no-op remedy is worse than none (P41).
> 5. Zero-member conversations accumulate unfindably, and once `sender_id` is null **no column links
>    a message body to its author** — so a later erasure request cannot be satisfied by any query,
>    not even with `service_role`. This one bears directly on the escalated question.
>
> Move the detail back into the public tree once the fixes have shipped.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Widen `msg_update` to `sender_id is null AND caller is a member`** (the question as asked) | Grants the whole row, not one column — RLS is row-level. Executed: body rewrite, authorship adoption, `kind`/`metadata` forgery, `created_at` movement, `reply_to_id` repointing, cross-conversation relocation, PK rewrite, and un-delete all succeed. Un-delete is decisive: the remedy and its reversal are the same grant, so it is a symmetric edit war in the victim's inbox rather than a remedy. |
| **Widen + a `BEFORE UPDATE` freeze trigger permitting only one-way `deleted_at`** | **Rejected on futility, not danger — and it is the alternative most likely to be proposed again.** Executed by the adversarial critic: every attack above is blocked, un-delete is blocked, the cascade still works, and the trigger is fingerprinted by `schema-fingerprint.sql` so it cannot be silently removed. It is safe. It is futile because the one capability it grants — writing `deleted_at` — is not enforced by `msg_select`, cannot be made enforceable without a DEFINER actor, and is not invoked by any client code. Revisit this first if a delete-message button ever ships. |
| **Scoped DELETE policy on `messages`** | Two independent blockers. `reply_to_id uuid references messages(id)` has no `ON DELETE` clause (`chat_jam.sql:47`) so it defaults to NO ACTION — deletion fails with 23503 exactly on messages that were replied to, i.e. the ones in a live exchange. And it hands every member a unilateral, irreversible, unauditable erase of shared history, contradicting the SET-NULL-over-CASCADE reasoning of the migration this ticket descends from, and letting a hostile member destroy evidence of their own conduct before it is reported. |
| **Column-level `GRANT UPDATE (deleted_at)`** | Executed: it does restrict the SET list. **Unusable here** — `.github/workflows/ci.yml:180` runs `grant all on all tables in schema public to authenticated` after migrations; re-running that statement made the forged `set body = ...` succeed again. A control that passes its own test and then evaporates. Already recorded at `20260722000000_liv10_authorization_guards.sql:186-190`. |
| **SECURITY DEFINER `redact_orphaned_message(uuid)`** | **Deferred, not rejected.** The only mechanism whose granularity matches the requirement, and — per principal-data's finding that `msg_select` cannot be fixed — the only actor that can write a real tombstone at all. Deferred because it is a new deliberate hole (P17) serving a user need with no evidence behind it, and because it is *worse in groups*: an attacker who burns one account and keeps another can redact any null-sender content, including a departed user's message documenting their own conduct. If built, it must null `body` and `metadata` (a flag is not a redaction while `msg_select` ignores `deleted_at`), resolve membership from the row's own `conversation_id` and never from a parameter, and refresh the inbox preview from an `AFTER UPDATE` trigger at `pg_trigger_depth() = 2` — principal-data verified that writing `conversations` directly from the RPC hits `conversations_freeze_derived` at depth 1 and **aborts the whole transaction, rolling back the redaction**. The trigger must *recompute* the latest visible message, never copy `NEW.body`; the naive form would hand every author an arbitrary-inbox-preview primitive. |
| **Per-user `message_hides` table** | **Deferred, not rejected.** Security-cleanest option: zero write access to `messages`. principal-security executed principal-data's proposed insert policy and confirmed it does **not** leak message-id existence — a nonexistent id and an inaccessible one both return an identical `42501` from `ExecWithCheckOptions`, because RLS `WITH CHECK` runs before the FK's AFTER-ROW trigger. Both cost objections against it were withdrawn during cross-examination (principal-client's "six read paths" was recounted to **one**, `fetchMessages`; the AsyncStorage-resurrection objection was withdrawn because `setMessages` is a full replacement fired on every mount). Deferred because it pre-empts the design of a feature whose correct principal is "this person" and correct object is "everything from them, past and future" — i.e. blocking. One cost objection survives: a hide is per-user but `last_message_preview` is one shared column, so a per-viewer preview means abandoning the denormalization of the hottest read in the product. |
| **Wire the existing `leaveConversation()` to DMs** | Recommended independently by principal-security and principal-client in Round 1, then **withdrawn by both** — and the withdrawal was itself partly refuted. It is verified that deleting your own `conversation_members` row makes the conversation and every message unreadable **by RLS**, and that `get_or_create_dm` cannot rejoin the old thread. Withdrawn because `members_insert` lets a DM admin — and `get_or_create_dm` makes the *initiator* an admin — re-add the leaver, and because leaving is loud, inflicts a nameless inbox row on the other party, destroys the victim's own evidence in a product with no reporting, and is a chainsaw for the bereavement case. **The critic then showed the re-add is structurally unreachable in the orphan scenario**: the abuser's admin row and the friendship row both cascade away on account deletion, so after the survivor leaves, the re-add returns `ERROR: new row violates RLS`. The re-add objection therefore applies to the *living* harasser, not to this ticket. What survives as a genuine objection is bereavement and irreversibility — both product calls. **Not adopted here because it answers a different question** (how does a user exit a conversation) than the one asked. It should be its own ticket. |
| **Null the message *body* inside `delete_my_account()` before the cascade** | **Nobody proposed this in three rounds — the adversarial critic raised it in Round 4, and it is the alternative most worth recording.** A pre-cascade `update messages set body = null, metadata = null where sender_id = v_me` would **dissolve the question entirely**: no orphan carries a payload, so nothing needs removing and **no new write authority is granted to anyone**. The precedent is inside the same function — it already ends jams the user hosts, with the comment *"host_id is about to become null, and a live room with no host is unusable but still advertised"*, which describes a stale `last_message_preview` word for word. **Not adopted because it is not the board's decision to make:** it reopens PROP-0003's scope boundary from the deleter's side and decides that account deletion erases content rather than only attribution. That is escalated below. |
| **Do nothing** | Not neutral. It leaves a class of rows outside all write authority as an accident of an FK change rather than a decision, and `20260722200000:44-50` deliberately recorded the question as open — leaving it open with no dated re-entry is how an accident becomes a standing decision (P58). |
| **"Close by subsumption into the blocking/moderation work"** | This was the board's Round-2 consensus and the **chief architect does not adopt it as written.** Verified: `kb/product/` contains only `.gitkeep`; `grep -rn "LIV-15" kb/ .github/` returns zero hits; the nearest artifact is D-04 in a 40-entry debt register, which is a record, not scheduled work. A recommendation to wait for an epic nobody has committed to build is a deferral wearing a plan's clothing, and it rested on a premise the critic falsified. Subsumption is recorded only for the two genuinely-deferred mechanisms (the RPC and the hide table), each with an explicit revisit trigger. |

## Consequences

**Makes easy / preserves:** the `messages` write perimeter stays "the author, and only the author",
which is the property every read of these policies currently assumes. No new SECURITY DEFINER
surface. PROP-0003's scope boundary is not reopened by the board unilaterally. The three live
defects are separated from the product question so they can ship without waiting on it.

**Makes hard / costs:**
- **The orphan asymmetry is left in place, deliberately and with the count unknown.** A message from
  a deleted user remains immutable by everyone. If harassment content is sitting in a user's inbox
  today, this decision does not remove it, and the board could not determine whether any such rows
  exist.
- A safe, cheap mechanism (widen+trigger) is declined for a reason — futility — that stops being
  true the moment a delete-message button ships. That is a foreseeable re-open, recorded as such.
- Deferring the RPC and the hide table into moderation work means both wait on a feature with no
  owner and no schedule.

## Dissent

- **adversarial-critic dissents from the board's reasoning, and from "fold into moderation" as a
  destination.** Its position: the verdicts stand but the recorded reasons must change or the next
  reader will correctly reopen this. Specifically — "today no user can remove any message, orphaned
  or not" is false; the widening should be rejected on futility rather than danger because
  widen+trigger is demonstrably safe; and closing a ticket into an epic that does not exist is the
  fourth instance of the failure pattern the debt register already records three times (D-55, D-61,
  D-08). **The chief architect adopts this dissent** — it is the reason this ADR's reasoning differs
  from the board's Round-2 consensus.
- **principal-data dissents on the PROP-0003 anti-filter analogy.** PROP-0003 rejected per-row
  filters because "a missed one leaks a deleted user" — a confidentiality leak against a published
  commitment. A missed `message_hides` filter shows a user a message they are *already authorized to
  read* and chose to hide from themselves: a UI regression, not a leak. Recorded so nobody cites
  PROP-0003 as blanket authority against every per-user filter, because a `blocks` table will be
  exactly this shape and will be correct.
- **principal-security dissents from principal-data on the group remedy**, preferring per-user
  hide-for-me for groups; principal-data holds that this is its own withdrawn proposal and the cost
  objection applies identically. Unresolved, and it becomes live only if the hide table is built.
- **principal-client dissents on the group framing:** the adminless-group problem is not a
  message-authorization problem but a **missing admin-succession rule**. Verified client-side: when
  the last admin's row disappears, every remaining member computes `myRole === 'member'`, so the
  entire group-management UI collapses to a single exit door (`GroupInfoScreen.tsx` — no Save at
  `:382`, `editable={false}` at `:406`, no Add member at `:414`, no Remove at `:257`), and a patched
  client gains nothing because `conv_update` and `members_insert` both require `admin`. Fixing it
  needs a carve-out in `conversation_members_freeze_identity` and deserves its own argument. It
  should not be smuggled in under this ticket.
- **A fixture conflict is recorded unresolved.** principal-data and principal-security reported
  opposite results for the same isolation test (whether the widened policy's implicit `WITH CHECK`
  alone blocks relocation into a conversation the attacker is not in). The critic reproduced
  principal-data's matrix exactly and judges principal-security's result to be fixture error — most
  likely an explicit `WITH CHECK` on the test policy. The critic also holds that principal-data
  over-generalized from it: the block occurs because the *widened* policy's membership clause
  correlates to `NEW.conversation_id`, which says nothing about implicit `WITH CHECK` in general, and
  under **today's** policy the implicit check does **not** block relocation. Each principal is right
  about half.
- **principal-client's leave-the-DM withdrawal is recorded as partly mistaken**, per the critic's
  refutation above, and principal-client's own Round-2 finding that the leave modal's bullet
  "You can be added back by any admin" (`GroupInfoScreen.tsx:473-476`) is false in an adminless
  group stands as an independent P6/P40 defect.

Also record the withdrawals, because a debate that hides its corrections is advocacy:
principal-data withdrew `message_hides` as first choice and withdrew "fix `msg_select` first" as
available; principal-security withdrew the jam-invite privilege-escalation chain, withdrew
"permanently, and by RLS" as a description of leaving, and withdrew Tier 1 as standalone;
principal-client withdrew the six-read-path cost figure, the AsyncStorage-resurrection objection, the
strong form of "no message-level fix reaches the inbox preview", and leave-the-DM as the answer.

## Escalated to the human — ANSWERED 2026-07-29

> ## ⟶ RULING: **Position A — attribution only.**
>
> Given by the human maintainer at ratification, 2026-07-29. Account deletion erases the
> *attribution* of messages already sent, not their *content*. A sent DM is **the recipient's
> record** — theirs to keep, and not the sender's to retract. This confirms the ratified PROP-0003
> boundary and the `ON DELETE SET NULL` choice in `20260722200000`; Position B is **not** adopted, so
> no `update messages set body = null` is added to `delete_my_account()`.
>
> **Consequences that follow directly:**
> - The client renders `[deleted]` for a null author rather than hiding the message — the work in
>   LIV-71 and LIV-72.
> - `docs/delete-account.html` must **say so plainly** — the divergence recorded below is now a
>   documentation defect with a known correct answer, tracked as **LIV-76**.
> - Finding 5 under *Live defects* (once `sender_id` is null, no column links a body to its author,
>   so a later erasure request cannot be satisfied by any query) is **not** dissolved by this ruling
>   and remains open in PROP-0005. Under Position B it would have disappeared; under Position A it
>   is a real retention question that outlives this ADR.
>
> The original escalation is preserved below unedited, because the alternative and the reasoning are
> the record.

> **Question:** When a user deletes their account, does Livil erase the *content* of the messages
> they sent, or only their *attribution*?
>
> **Position A** (the board, following PROP-0003 and `20260722200000`): only attribution. Erasing
> content alters other people's record of a conversation they took part in, without their
> involvement — the same reasoning that chose SET NULL over CASCADE and relaxed the
> `track_collaborators` CHECK rather than cascading it. The recipient keeps their history; the
> departed user keeps their anonymity.
>
> **Position B** (adversarial-critic, raised in Round 4 and argued by nobody in Rounds 1–3): content
> too. A pre-cascade `update messages set body = null, metadata = null where sender_id = v_me` inside
> `delete_my_account()` dissolves the entire question — no orphan carries a payload, so no new write
> authority need be granted to anyone, and the precedent already exists in that same function.
>
> **Precise point of divergence:** whether a sent DM is *the recipient's record* (Position A — theirs
> to keep, and not the sender's to retract) or *the sender's content held in the recipient's inbox*
> (Position B — erasable on departure). Every mechanism the board debated is downstream of this; it
> is not an authorization question and the board cannot settle it.
>
> **What would resolve it:** (a) a product ruling from the maintainer, since `kb/product/` is empty
> and Constitution P63 forbids the board inventing one; and (b) reconciling the two published
> documents, which currently disagree. `docs/delete-account.html` §3 enumerates what is permanently
> removed — profile, email, posts and media, likes, follows, **comments**, playlists, listening
> history — and **messages are absent** (verified: the string does not appear on the page). §4
> enumerates retention grounds — "legal, security, or fraud-prevention purposes" and "content saved
> or re-shared by other users" — and a DM body retained verbatim forever fits neither.
> `docs/privacy-policy.html:487-491` is more permissive, saying "delete **or anonymize**". The two
> pages do not agree, this is the only item in this decision with an external deadline (the Play
> Store obligation behind D-62), and it is one paragraph to fix.

Three further items the human must decide or supply:

1. **The orphan count.** `select count(*) from messages where sender_id is null` — one query with
   `service_role`. All four participants named it; none could run it. principal-client stated
   explicitly that a zero count changes the ranking. **This ADR should not be ratified without it.**
2. **`'blocked'` exists in a CHECK constraint that nothing writes.**
   `00000000000000_baseline_schema.sql:185` declares
   `check (status in ('pending','accepted','blocked'))`, and no code in `supabase/` or `src/` ever
   writes `'blocked'`. Blocking was designed into the schema and never built. Whether that is
   scheduled is a product call.
3. **Schema-parity is RED on `main`.** Runs `30346948089` (2026-07-28) and `30258565355` (2026-07-27)
   report 8 function bodies differing between production and the repository, with **zero POLICY, RLS
   or TRIGGER drift** — so the `messages` analysis in this ADR does hold against production. But the
   8 drifted functions include `create_group`, `conversation_members_freeze_identity`,
   `accept_friend_request` and `reject_friend_request`. **No claim in this ADR about group admin
   structure or the friendship lifecycle should be ratified** until `pg_get_functiondef` for those
   four is dumped from production and diffed.

## Revisit when

- **A delete-message or edit-message button is proposed for the client.** The futility argument
  against widen+trigger dies at that moment, and widen+trigger becomes the leading candidate. Revisit
  this ADR before designing the authorization for it.
- **Blocking or message reporting is scheduled.** The RPC and the `message_hides` table are deferred
  into that work; if it is scheduled, both are revisited as part of its design.
- **The orphan count is non-zero and growing**, or a user reports content from a deleted account that
  they cannot remove.
- **`msg_select` is changed for any reason.** The `messages` update perimeter currently depends on the
  SELECT policy staying restrictive — undocumented and accidental. Loosening `msg_select` silently
  widens `msg_update`.
- **The human rules on the escalated question.** Position B would supersede this ADR outright rather
  than amend it.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
