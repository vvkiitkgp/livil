---
tier: 4
owner: principal-client
consumers: [CA, TR, ALL]
last_verified: 2026-07-22
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0008]
---

# PROP-0003 — In-app account deletion, to match what the live page already promises

| | |
|---|---|
| **Status** | **Draft** |
| **Date** | 2026-07-22 |
| **Domain** | client (with data) |
| **Addresses** | D-62, and the Play Store obligation attached to `docs/delete-account.html` |
| **Jira** | *(added on ratification)* |

---

## Problem

`docs/delete-account.html` has been published since **28 June 2026** and gives users
step-by-step instructions:

> Open Livil and go to the **Profile** tab. Tap **Settings**. Select **Delete Account**.
> Confirm the action when prompted.

**None of those steps exist.** There is no Settings screen in `src/screens/main/`, and
`grep -rniE "delete.?account|delete_my_account" src/ lib/` returns nothing. The page also
offers an email fallback and commits to deletion "within 30 days".

Until `20260722200000_account_deletion.sql`, **neither path could have been honoured**:
`messages.sender_id`, `jam_rooms.host_id` and `jam_queue.suggested_by` all referenced
`profiles(id)` with `NO ACTION`, so deleting anyone who had ever sent a message failed
with `23503`. The database layer is now fixed and `delete_my_account()` exists. **This
proposal is the remaining half — the part an agent may not write.**

Who it breaks, concretely:

- **A user who wants to leave** follows published instructions to a screen that is not
  there. Their only recourse is an email to one person.
- **Google Play.** An app that offers account creation in-app must offer account deletion
  in-app. This is a policy obligation with a live public page asserting compliance.
- **Anyone reading a message from a deleted user**, once the migration is applied.
  `sender_id` is now nullable in practice and the UI assumes the profile join succeeds.

## Why now

The database half is already merged and the client half is the only thing between the
product and a promise it is currently breaking. It is also the cheapest possible moment:
the RPC exists, is tested, and takes no parameter, so the client work is a screen, a
confirm modal, and one call.

The null-sender handling is **not** optional and is the reason this cannot wait long: it
becomes a live rendering concern the moment anyone deletes an account.

## Proposal

Three pieces, independently shippable in this order.

### 1. Null-author handling on every read path — FIRST

Ship before anything can produce a null. Applies wherever a profile is joined for
authorship display:

| Column | Now nullable | Surfaces |
|---|---|---|
| `messages.sender_id` | SET NULL | `ConversationScreen`, `InboxScreen` previews |
| `jam_rooms.host_id` | SET NULL | `JamRoomScreen`, jam snapshot |
| `jam_queue.suggested_by` | SET NULL | jam queue list |
| `conversations.created_by` | already SET NULL | group info |
| `activity_notifications.actor_id` | already SET NULL | `ActivityCenterScreen` |
| `track_collaborators.user_id` | already SET NULL | track credits |

Render a single shared placeholder — a `[deleted]` display name and the existing initials
fallback. Note the last two rows were **already** nullable, so this class of bug may exist
today independently of deletion; that is worth checking while in the code.

### 2. Settings screen

New `src/screens/main/SettingsScreen.tsx`, reached from the Profile tab, registered in
`src/navigation/types.ts`. Deletion is one row; the screen is the container the published
page names, so it needs to exist even if it starts nearly empty.

### 3. The deletion flow

1. `ConfirmActionModal` — never `Alert.alert` (CLAUDE.md). Copy must state it is permanent
   and that messages already sent remain visible to their recipients, because that is what
   the schema now does and the user should learn it here rather than discover it.
2. Delete the user's storage objects **before** the RPC:
   `supabase.storage.from('avatars').remove(paths)` and the same for `tracks-media`, listing
   under the `${userId}/` prefix.
3. `supabase.rpc('delete_my_account')`.
4. `supabase.auth.signOut()`, then reset navigation to the auth stack.

Order matters: the RPC deletes the `auth.users` row, after which the client has no
authenticated session and **cannot** clean up storage. Storage first, always.

## Implementation plan

1. Shared `displayNameOrDeleted()` helper + apply across the six surfaces in §1. *(Verifiable:
   render a message whose `sender_id` is null and see a placeholder, not a crash or a blank.)*
2. `SettingsScreen` + route in `navigation/types.ts` + entry point on the Profile tab.
   *(Verifiable: navigate to it.)*
3. `deleteMyAccount()` in `src/services/profileService.ts` — storage cleanup, then RPC.
   *(Verifiable: unit test with a mocked client asserting storage removal is called BEFORE
   the rpc, and that a storage failure does not proceed to the rpc.)*
4. Wire the confirm modal and the sign-out/navigation reset. *(Verifiable: on a test account,
   delete and confirm the app returns to onboarding and the account cannot sign in again.)*
5. Update `docs/delete-account.html` only if the shipped flow differs from what it describes.
   Today the page is aspirational; after this it should be accurate.

## Scope boundaries

**Explicitly not included:**

- **Soft delete / 30-day grace period.** The page says "deactivated immediately and queued
  for permanent deletion… within 30 days". An immediate hard delete satisfies that window,
  and a grace period means a `deleted_at` column and filtering it out of every query — a
  much larger change. If the product wants recovery, that is its own proposal.
- **True storage byte erasure.** `delete_my_account()` removes `storage.objects` metadata,
  which unlists the files, but Supabase's storage service owns the S3 objects and deleting
  metadata directly can orphan bytes. The client-side `storage.remove()` in §3 is what
  actually erases them, which is precisely why it is in scope here and why it must run
  first. **If §3 step 2 is skipped, the page's media-deletion claim remains unmet.**
- **Deleting the user's messages from other people's conversations.** Decided in the
  migration and argued from the published page; reopening it is a product decision, not an
  implementation detail.
- **Admin-initiated deletion** for the email fallback. Still manual, still one person.
- **Rate limiting.** D-12 covers it globally.

## Risk

**The bad outcome is deleting the wrong account, and it is unrecoverable.** The RPC's
defence is structural: it takes no parameter and acts on `auth.uid()`, so the client
*cannot* name a victim. The client-side risk is narrower — a mis-wired confirm modal
deleting on the wrong tap. Mitigated by `ConfirmActionModal` with a destructive variant and
explicit copy.

**Second bad outcome: partial deletion.** Storage removal fails, the RPC succeeds, and the
user's media is orphaned and unreachable while their account is gone. Detected by the
service test in step 3; the flow must abort rather than proceed if storage cleanup fails.

**Reversibility:** none for a completed deletion, by design. The reversible part is the UI —
the entry point can be removed without touching the schema.

## Verification

- Null-author placeholder renders, on a real message whose sender was deleted.
- A test account can complete the flow end to end and cannot sign in afterwards.
- Its rows are gone: `profiles`, `posts`, `tracks`, `playlists`, `follows` — already covered
  by `delete #4`–`#7` in `supabase/tests/rls/authorization.test.sql` at the database layer.
- **Its counterpart's data is not:** the other participant in a DM still sees the
  conversation and the message, with a placeholder author. This is the assertion most worth
  performing by hand, because it is the one a CASCADE regression would silently break.
- Storage: no objects remain under `${userId}/` in either bucket.

## Alternatives

| Alternative | Why set aside |
|---|---|
| Email-only deletion, drop §1 of the page | Google Play requires in-app deletion for in-app-created accounts. It is also worse for the user and leaves one person as the queue. |
| Soft delete with a `deleted_at` flag | Every query in the product grows a filter, and a missed one leaks a deleted user. Larger, and not required by the published commitment. |
| Edge function holding `service_role` | Ruled out by ADR-0008 decision #4. Also impossible today — this project has no edge functions at all (D-54). |
| CASCADE sent messages | Argued and rejected in the migration: the published page does not promise it, and it alters other users' conversation history without their involvement. |

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
