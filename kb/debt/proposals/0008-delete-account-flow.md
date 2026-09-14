---
tier: 4
owner: principal-client
consumers: [CA, TR, ALL]
last_verified: 2026-07-30
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0007, 0012, 0014]
---

# PROP-0008 — The in-app account-deletion flow

| | |
|---|---|
| **Status** | **Draft** · Ratified · Rejected · Deferred · Implemented |
| **Date** | 2026-07-30 |
| **Domain** | client (with data, security) |
| **Addresses** | [PROP-0003](0003-in-app-account-deletion.md) §3 and plan steps 3–4, D-62, the Play Store obligation behind `docs/delete-account.html` |
| **Jira** | LIV-74 (child of Epic LIV-13; follows LIV-71/PR #103 and LIV-72/PR #104) |

---

## Why this is a proposal and not a commit

Every file the flow touches is `propose_only` in
[`.claude/autonomy-config.yml`](../../../.claude/autonomy-config.yml):
`src/services/**` (:70), `src/components/**` (:67), `src/navigation/**` (:74), `src/screens/**` (:65).
The only writable path is the test file, `src/services/__tests__/deleteMyAccount.test.ts`
(`src/**/__tests__/**`, :41).

**The tests below are deliberately not committed.** They assert the behaviour of
`deleteMyAccount()`, which does not exist, so they fail to compile on `main`. Committing them
alone turns `main` red for no gain. This is the same call PROP-0006 made and is stated here so
the two stay consistent. Apply both halves together.

This proposal also does **not** touch `supabase/migrations/**`. `delete_my_account()` is already
live and correct for what it claims; nothing here changes the schema, a policy, or a function.

---

## Problem

`docs/delete-account.html` has been published since 28 June 2026 and instructs users:

> Open **Livil** and go to the **Profile** tab. Tap **Settings**. Select **Delete Account**.
> Confirm the action when prompted.

The database half shipped 2026-07-22 (`20260722200000_account_deletion.sql`, PR #74, applied to
production). The rendering half shipped as LIV-71 and LIV-72. **The flow itself still does not
exist**: `grep -rniE "delete.?account|delete_my_account" src/ lib/` returns nothing on `058ad90`.

So today a user who wants to leave follows published, step-by-step instructions to a screen that
is not there, and their only recourse is an email to one person. That is a live Play Store
compliance breach — an app offering in-app account creation must offer in-app deletion — with a
public page asserting otherwise.

## Why now

Everything this depends on is already in place. The RPC exists, is tested at the database layer
(`delete #4`–`#7` in `supabase/tests/rls/authorization.test.sql`), and takes no parameter. The
null-author rendering that deletion makes reachable is done. What remains is a service function,
a confirm modal, and one row on a screen.

It is also the last piece that makes the published page true, and the page has been false for
five weeks.

---

## Corrections to the ticket's premises

Every ticket in this epic so far carried at least one wrong fact. These were re-verified against
`058ad90`.

### 1. There is no navigation reset to write, and writing one would be a second session gate

The ticket's step 4 is "reset navigation to the auth stack." **The app does not work that way and
must not be made to.** `RootNavigator` is the session gate: it holds `session` in state, and
`supabase.auth.onAuthStateChange` sets it (`src/navigation/RootNavigator.tsx:342-367`). When
`session` is null the navigator renders exactly one screen —
`<Stack.Screen name="Auth" component={AuthNavigator} />` (`:586-588`) — and unmounts
`GlobalAudioPlayer`, `FullScreenPlayer` and `FloatingPlayer` (`:592-598`).

The existing sign-out path (`src/screens/main/ProfileScreen.tsx:399-406`) is three lines and
contains **no navigation code at all**:

```ts
setSignOutBusy(true);
playback.pauseAll();
await supabase.auth.signOut();
```

The `SIGNED_OUT` event additionally clears the chat cache and unregisters the push device
(`RootNavigator.tsx:349-355`). Deletion must reuse this, not add a `navigation.reset()` beside it.
Two paths to the same transition is exactly the "one owner per responsibility" failure
(Constitution P12), and a manual reset would race the gate's own re-render.

**What the ticket's step 4 actually reduces to: call `signOut()`.** That is the whole of it.

### 2. `playback.pauseAll()` is part of the existing path and is easy to drop

The sign-out path calls it before `signOut()`. It is not decoration: `GlobalAudioPlayer` is the
sole MediaSession owner ([ADR-0001](../../decisions/0001-single-audio-engine.md)), and the
lock-screen notification is posted natively. Deletion is worse than sign-out here, because the
file being streamed is about to be removed from storage. `pauseAll()` goes first, before the
storage calls.

### 3. What `delete_my_account()` really does — read it, do not trust the summary

`supabase/migrations/20260722200000_account_deletion.sql:188-220`, in order:

| Step | Line | Effect |
|---|---|---|
| Guard | `:197-199` | `raise 'not_authenticated'` if `auth.uid()` is null |
| Ends hosted jams | `:204-207` | `jam_rooms` where `host_id = me and status = 'active'` → `status = 'ended'` |
| Deletes storage **metadata** | `:215-216` | `delete from storage.objects where (string_to_array(name,'/'))[1] = me::text` — **all buckets**, anchored on the first path segment |
| Deletes the auth user | `:219` | `delete from auth.users where id = me`; everything else follows the cascade |

**Authorization note for review.** This function is the counter-example to the pattern this repo
has shipped wrong three times. `if v_me is null then raise` here is *sufficient*, and only
because the function takes **no parameter** — there is no resource named by the caller to
authorize against. `auth.uid()` is both the authentication check and the object of the verb. A
future change that adds a parameter invalidates that reasoning immediately.

What survives deletion, per the FKs the same migration set: `messages.body` (with `sender_id`
null), `jam_rooms` / `jam_queue` rows (`host_id`, `suggested_by`, `current_track_id`, `track_id`
nulled), `conversations.created_by`, `activity_notifications.actor_id`, and
`track_collaborators` rows as `(user_id null, custom_name null)`. **The user-facing copy must
match this list, not the ticket's summary.**

**Deleting `storage.objects` rows is not deleting the bytes.** The migration says so itself
(`:59-67`): Supabase's storage service owns the S3 objects, and removing the metadata directly
can orphan them. `docs/delete-account.html` §3 promises "your posts and uploaded media (audio and
video)" are permanently removed. **Only the client-side `storage.remove()` honours that**, which
is why it is step 1 and why a failure there must abort — PROP-0003:154-156 states this as the
condition on the page's claim being met.

**The RPC is idempotent, which matters more than it looks.** `auth.uid()` reads the JWT's `sub`
claim, not a table, so calling it a second time with a still-valid token for a deleted user
re-runs three no-op statements and returns void. That is what makes a mid-flow app kill
recoverable; see *Interruption*.

### 4. `src/services/profileService.ts` exists and has no deletion code

233 lines. It owns `AVATARS_BUCKET` (`:6`), the profile read/update calls, the avatar picker, and
`uploadAvatar` (`:189`). It is the correct home for `deleteMyAccount()`: it already imports the
Supabase client and already owns one of the two buckets. It has **no tests**.

---

## The storage surface — the full enumeration

A bucket missed here is a file that survives forever, because after the RPC there is no session
with which to clean up. Enumerated from every call site that writes to storage, not from memory:
`grep -rn "storage/v1/object\|storage.from(" src/ lib/` returns **six lines across three files**.

| Bucket | Path convention | Written by | Depth under `${userId}/` |
|---|---|---|---|
| `avatars` | `${userId}/avatar_${ts}.${ext}` | `profileService.ts:195` | flat (1 level) |
| `avatars` | `${userId}/album_cover_${ts}.${ext}` | `albums.ts:382` | flat (1 level) |
| `tracks-media` | `${userId}/${trackId}/${kind}.${ext}`, `kind ∈ {audio, video, cover, thumbnail}` | `uploads.ts:204` | **nested (2 levels)** |

**Two buckets, three conventions, two depths.** `AVATARS_BUCKET = 'avatars'`
(`profileService.ts:6`) and `TRACKS_MEDIA_BUCKET = 'tracks-media'` (`uploads.ts:5`) are the only
bucket constants in the repository.

### What is *not* a third bucket — each checked, not assumed

| Candidate | Finding |
|---|---|
| **Story media** | Stories carry no media of their own. `stories` (`20260530000001_repost_and_stories.sql:24-42`) references `post_id`; the viewer resolves the underlying post's track. No upload path exists. |
| **Playlist covers** | Emoji + gradient, stored as columns (`20260616000002_playlist_emoji_cover.sql`, `20260616000003_playlist_cover_gradient.sql`). No file. |
| **Album covers** | Real files — but in `avatars`, not a bucket of their own. This is the convention drift ADR-0007 flagged and [ADR-0012](../../decisions/0012-storage-config-ratification-and-modifications.md) confirmed the `{userId}/…` predicate still covers. Counted above. |
| **Chat attachments** | None. `messages.metadata` carries `track_share` / `sticker` references, not uploads. |
| **Track waveforms** | `tracks.waveform_peaks` jsonb column. No file. |

**The nesting is the trap, and it is silent.** `storage.list(userId)` on `tracks-media` returns
**folder** entries (the track ids), not files — folders come back with `id: null`
(`@supabase/storage-js/src/lib/types.ts:80-81`: *"Unique identifier for the file (null for
folders)"*). A single non-recursive `list()` would return zero deletable paths for every track a
user has ever uploaded, `remove()` would be called with an empty array, the flow would report
success, and **every audio and video file would survive the account**. It fails silently and
looks correct.

**Second trap: `list()` returns 100 rows by default.** `DEFAULT_SEARCH_OPTIONS.limit = 100`
(`storage-js/src/packages/StorageFileApi.ts:24-31`). Unpaginated, a user with more than 100
tracks loses the remainder. Unbounded is a defect and so is silently truncated (Constitution P22).

### Dependency on PROP-0002, stated rather than assumed

[ADR-0007](../../decisions/0007-storage-policies-unversioned.md) recorded (human-verified
2026-07-21) that `storage.objects` has RLS enabled and **zero policies**, with the table owned by
`supabase_storage_admin` and `FORCE RLS` off — so whether RLS is the live enforcement mechanism
at all is not knowable from this repository. [ADR-0012](../../decisions/0012-storage-config-ratification-and-modifications.md)
§2 already anticipated this proposal by name and requires PROP-0002's scoped policies to include
`DELETE`, *"so self-service deletion is possible and no cross-user delete is."*

**This flow works under either resolution today** (owner-bypass, or the `avatars` migration's
`avatars_delete` policy on `foldername[1] = auth.uid()::text`). It breaks the day PROP-0002 ships
`INSERT`-only. That is ADR-0012's foreclosure hazard arriving, and the mitigation is already
decided — it is recorded here only so nobody has to rediscover the link.

**Not verified and not claimable:** neither `list()` nor `remove()` was executed against a live
bucket. The claims about pagination, folder-vs-file, and the short-return case below are read from
the client library's source and types. ADR-0007's live probe is what would settle them, and it has
not been run.

---

## The blocker question — LIV-82

**LIV-82 is real, its facts check out, and it is not dissolved by this proposal.**

Verified against `058ad90`:

- `messages` (`20260528000000_chat_jam.sql:35-50`) has exactly one author column: `sender_id`.
  There is no `sender_username`, no author snapshot, nothing in `metadata` (`:41-45` documents its
  four shapes; none carries the sender). Once `sender_id` is null, **no column links a body to a
  person** — correct as stated, including "not even with `service_role`".
- `conversation_members.user_id` is `on delete cascade` (`20260528000000_chat_jam.sql:27`), and
  `leaveConversation()` (`src/services/conversations.ts:113-123`) is a bare row delete. Nothing deletes a conversation
  when its last member leaves. So a zero-member conversation with intact message bodies persists
  indefinitely — correct as stated.
- The gap is **entirely latent today**: ADR-0014 records 0 orphaned rows out of 482 messages,
  executed against production 2026-07-29. **This ticket is what makes it reachable.**

### Recommendation: ship, with two conditions, and one question that belongs to the maintainer

**Not a hard blocker on merging this. It is a hard blocker on shipping it *silently*.**

The reasoning, both directions, so it can be overruled on the evidence rather than on my summary:

**Why it does not block.** The harm LIV-82 describes is a *future* inability to satisfy a
*hypothetical* erasure request. The harm this ticket fixes is present, concrete, and affects every
user who wants to leave — a published page has instructed them to a nonexistent screen for five
weeks, against a Play Store policy obligation. Weighing a live breach against a latent one favours
shipping.

There is also a substantive argument that the gap is smaller than it looks. After deletion we can
neither locate the rows *nor identify the requester* — `auth.users` is gone, so the email is gone
too. Data that the controller can no longer link to a natural person is, on the face of it,
outside the erasure right rather than in breach of it. **That argument has a real limit and I will
not overstate it:** a DM body frequently re-identifies its author from its own content ("hey, it's
Vamsi"), which makes this pseudonymisation in practice rather than clean anonymisation. Whether
that distinction holds is a legal judgement, not an engineering one (P63), and it is the single
thing that would flip this recommendation.

**Why it might block, and this is the strongest counter-argument.** Every deletion that happens
before a mechanism exists is *irreversibly* unindexable. If the maintainer's answer to "must we be
able to satisfy a post-deletion erasure request?" is yes, then the mechanism has to be decided
**before the first production deletion**, not after — because there is no retrofit. Constitution
P4 (rigor scales with irreversibility) and P57 (debt is never acceptable in anything
unrecoverable) both point at treating it as a gate. I do not think that answer is yes, but I
cannot establish that it is no, and the cost of being wrong is one-directional.

**Two conditions I would make non-negotiable, both cheap:**

1. **LIV-76 lands with or before this.** ADR-0014's ruling already requires
   `docs/delete-account.html` to say plainly that sent messages persist without attribution.
   §3 of that page enumerates what is deleted and messages are absent; §4's retention grounds
   ("legal, security, or fraud-prevention") do not cover a DM body kept verbatim forever. Shipping
   the flow without that paragraph converts a *stale* page into an *actively false* one, at the
   exact moment users start relying on it. That is one paragraph, and it is a blocker.
2. **The confirm modal says it too** — in this proposal, §2. A user who confirms believing their
   DMs vanish has been misled by our own UI, and the page is not where they will look.

**What I would record, not build:** LIV-82 stays open with an explicit revisit trigger — *before
the first production deletion, or on the first post-deletion erasure request, whichever is first.*
Its remedies are all schema work (an erasure index, a retention window on orphaned bodies, or
Position B from ADR-0014, which the maintainer already declined). None of them belong in this
ticket, and one of them would reopen a decision ratified yesterday.

---

## Proposal

Four pieces. §1 is where the work is; §2–§4 are small.

### 1. `deleteMyAccount()` in `src/services/profileService.ts`

The whole flow, in one testable unit. `signOut()` lives here rather than in the screen so that
"storage before RPC before sign-out" is a property of one function that a test can pin — split
across two layers, the ordering is only a convention.

```diff
 import ImagePicker, {
   type Image as CroppedImage,
 } from 'react-native-image-crop-picker';
 import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../../lib/supabase';
+import { TRACKS_MEDIA_BUCKET } from './uploads';

 export const AVATARS_BUCKET = 'avatars';
```

Appended to the file:

```ts
/**
 * Both buckets namespace every object under `${userId}/`. `avatars` is flat
 * (avatars + album covers); `tracks-media` nests a folder per track.
 */
const DELETABLE_BUCKETS = [AVATARS_BUCKET, TRACKS_MEDIA_BUCKET];
const LIST_PAGE = 100;
const REMOVE_BATCH = 100;
const MAX_OBJECTS = 10_000;

/**
 * `list()` is one level deep and returns folders as entries with a null id, so
 * `tracks-media/${userId}` yields track folders rather than files. Recurse, or
 * every upload survives the account.
 */
async function listOwnedPaths(bucket: string, root: string): Promise<string[]> {
  const paths: string[] = [];
  const dirs = [root];

  while (dirs.length > 0) {
    const dir = dirs.shift() as string;
    let offset = 0;

    for (;;) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(dir, { limit: LIST_PAGE, offset });
      if (error) {
        throw new Error(`Could not read your files in ${bucket}: ${error.message}`);
      }

      const entries = data ?? [];
      for (const entry of entries) {
        const path = `${dir}/${entry.name}`;
        if (entry.id === null) { dirs.push(path); } else { paths.push(path); }
      }

      if (paths.length > MAX_OBJECTS) {
        throw new Error('You have too many files to delete from the app. Please contact support.');
      }
      if (entries.length < LIST_PAGE) { break; }
      offset += LIST_PAGE;
    }
  }

  return paths;
}

/**
 * storage-api answers 200 with only the rows it actually deleted, so a short
 * return is a refusal rather than an error. Proceeding past it would orphan
 * those files behind a deleted account, unreachable forever.
 */
async function removeOwnedPaths(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { data, error } = await supabase.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Could not delete your files in ${bucket}: ${error.message}`);
    }
    if ((data?.length ?? 0) < batch.length) {
      throw new Error(`Only some of your files in ${bucket} could be deleted.`);
    }
  }
}

/**
 * Permanent. Storage first — the RPC removes the auth user, after which there
 * is no session and the media can never be reached again (PROP-0003 §3).
 */
export async function deleteMyAccount(): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) {
    throw new Error('You are not signed in.');
  }

  for (const bucket of DELETABLE_BUCKETS) {
    await removeOwnedPaths(bucket, await listOwnedPaths(bucket, userId));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error: rpcError } = await db.rpc('delete_my_account');
  if (rpcError) {
    throw new Error(rpcError.message);
  }

  await supabase.auth.signOut();
}
```

**Three things in that function are load-bearing and easy to "simplify" away:**

- **`userId` is resolved from the session, never taken as a parameter.** This mirrors the RPC's
  own structural defence: a caller cannot name a victim. It matters more on the client than it
  looks, because if production storage is in the owner-bypass state ADR-0007 describes, a
  caller-supplied prefix would be an arbitrary-user media-delete primitive. The parameter is not
  validated — it is absent.
- **Storage before the RPC**, and a storage failure throws before the RPC is reached.
- **The short-return check.** Without it, a refusal is indistinguishable from success.

`TRACKS_MEDIA_BUCKET` is imported from `uploads.ts` rather than re-declared. `uploads.ts:5` is
already its single definition, and a second copy is the class of drift that produced the album
covers landing in `avatars` in the first place.

`delete_my_account` is absent from `lib/database.types.ts` (`Functions:` at `:1299`), so the
`supabase as any` cast is required to call it — the same shape `claimUsername` already uses at
`profileService.ts:91-93`, including the eslint suppression.

**An earlier draft of this function guarded the removal with `if (paths.length > 0)`. It is
gone, because a mutation test proved it was decoration** — `removeOwnedPaths` with an empty array
already does nothing, so deleting the guard broke no test and changed no behaviour. Recorded
because it is the mechanism working as intended (P29), not a detail.

### 2. The confirm modal and its copy

Rendered by whichever screen owns the Delete Account row (§4). `ConfirmActionModal`
(`src/components/ConfirmActionModal.tsx`) already routes `tone="destructive"` to the `destructive`
`Button` variant (`:83-90`), which is the documented exception to the no-solid-fill rule. **Never
`Alert.alert`** — CLAUDE.md and [coding.md](../../standards/coding.md).

**The copy — final wording is the maintainer's call.** ADR-0014's ruling is *attribution only*,
so bullet 3 is the one that must not be softened.

```tsx
<ConfirmActionModal
  visible={deleteOpen}
  title="Delete your account?"
  message={
    deleteBusy
      ? 'Deleting your account…'
      : 'This permanently deletes your Livil account. It cannot be undone.'
  }
  bullets={[
    'Your uploads, cover art and avatar are deleted',
    'Your posts, playlists, likes, follows and listening history are deleted',
    'Messages you already sent stay in other people’s chats, shown as [deleted]',
    'You are signed out on this device',
  ]}
  glyph="!"
  tone="destructive"
  confirmLabel="Delete my account"
  cancelLabel="Keep my account"
  busy={deleteBusy}
  onConfirm={confirmDelete}
  onCancel={() => setDeleteOpen(false)}
/>
```

| Element | Why this wording |
|---|---|
| Bullet 3 | The ADR-0014 ruling, said plainly. `[deleted]` is the literal string LIV-71/72 render (`DELETED_AUTHOR_NAME`), so the user sees exactly what they were told. Everything else on this list is a promise `docs/delete-account.html` §3 already makes. |
| "cannot be undone" | The page says the same. There is no grace period, by PROP-0003's scope boundary. |
| Not "deactivated and queued" | The page's §1 wording. The RPC is an immediate hard delete; describing it as queued would be false in the more alarming direction. |
| `Keep my account` over `Cancel` | On a destructive two-button modal the safe option should name the outcome. |
| `glyph="!"` | `ConfirmActionModal`'s default. The `glyph` prop is decorative text and is the documented exception to the `Icon` rule (CLAUDE.md). |

### 3. What the user sees while it runs, and what happens if the app dies

Neither is in the ticket and both are real. Deletion is a list, one-to-many removes, an RPC and a
sign-out — seconds on a good connection, longer with many files.

**During.** `ConfirmActionModal`'s `busy` prop already puts a spinner in the confirm button,
disables the cancel button, and blocks `onRequestClose` (`:57`, `:88`, `:98`) — the same mechanism
sign-out uses. The one thing it does not do is say what is happening, and a spinner with no words
for several seconds on an irreversible action reads as a hang. The component needs **no change**
and the screen needs no extra state: `message` is already a prop, so it is derived from `deleteBusy`
(§2).

```ts
const confirmDelete = useCallback(async () => {
  if (deleteBusy) { return; }
  setDeleteBusy(true);
  playback.pauseAll();
  try {
    await deleteMyAccount();
  } catch (e) {
    setDeleteBusy(false);
    showToast(e instanceof Error ? e.message : 'Could not delete your account.', { kind: 'error' });
  }
}, [deleteBusy, playback, showToast]);
```

`playback.pauseAll()` before the call, per *Correction 2*. There is deliberately **no success
path and no cleanup after `await`**: `signOut()` fires `SIGNED_OUT`, `RootNavigator` swaps to the
auth stack, and this component unmounts. Calling `setDeleteBusy(false)` afterwards is a state
update on an unmounted component. The failure path is the only one that returns.

One label, and it is true for every phase. A per-phase label ("Deleting your files…" → "Deleting
your account…") would need a progress callback threaded out of the service — more machinery than
the difference is worth, and a second thing to keep in sync with the flow.

**Interruption.** Four windows, and none of them corrupts anything:

| Killed during | Residual state | Recovery |
|---|---|---|
| Listing | Nothing changed | Retry |
| `remove()` | Some files gone, account intact, still signed in | Retry — the flow re-lists and removes the remainder |
| After the RPC, before `signOut()` | **The auth row is gone; the device still holds a valid access token** | See below |
| After `signOut()` | Complete | — |

The third is the only ugly one, and its window is one local call. The device is left holding a JWT
for a user who no longer exists: the app renders as signed in, and every query returns empty or
permission errors, until the next token refresh fails. **That self-heals rather than sticking** —
`@supabase/auth-js` calls `_removeSession()` on a non-retryable refresh error
(`GoTrueClient.ts:2810-2817`), and `_removeSession()` clears storage and emits `SIGNED_OUT`
(`:2991-3005`), which is the same event `RootNavigator` already listens for. Worst case the user
waits out the access token — one hour on Supabase's default.

**It is recoverable, and specifically because the RPC is idempotent.** `auth.uid()` reads the JWT
claim, not a table, so a second call re-runs three statements that match nothing and returns void.
A user who reopens the app and taps Delete again completes the flow rather than hitting an error.

**No client-side change closes this window** — there is no transaction spanning an RPC and a local
token clear. Two options exist and both are out of scope: `signOut()` inside the RPC's own
transaction is not possible, and a "pending deletion" flag in AsyncStorage that re-runs on next
launch is a state machine guarding a one-second window. Recorded, not built.

### 4. The entry point — owned by PROP-0007, not by this proposal

**[PROP-0007](0007-settings-screen.md) (LIV-73) was authored in parallel and now exists.** It
defines `src/screens/main/SettingsScreen.tsx`, its route, and its entry point on the Profile tab.
**This proposal does not design, redesign, or specify that screen.** It states what the Delete
Account control must *do* and defers everything about where it sits.

Nothing in §1–§3 depends on the screen's layout. If PROP-0007's shape changes in review, only this
section moves.

**Reconciled against PROP-0007 as written:**

- Its §4 renders an `Account` section containing exactly one `Button` — `Sign out`,
  `variant="secondary"` — and its `ConfirmActionModal` as a sibling of the `ScrollView`. This
  proposal adds **one more `Button`** below it and **one more modal**, which is the shape
  PROP-0007 anticipates by name (*"LIV-74 adds one more `Button`"*).
- **No `SettingsRow` abstraction.** PROP-0007 declines to build one for a single row and says a
  third row is the trigger to extract. This is the second; it is not the third. Two `Button`s
  (P25, P26).
- **`variant="destructive"` on the Delete Account button.** PROP-0007's own rule is that
  *"`destructive` is reserved for irreversible actions, and signing out is not one."* Deletion is,
  so the rule selects `destructive` here. I record a preference, explicitly as a preference and
  not as a defect: a solid-red row followed by a solid-red confirm is two heavy commitments where
  there is one, and a reviewer may reasonably want the row lighter. `Button` offers no variant
  between `secondary` and `destructive`, and inventing one is out of scope. **Maintainer's call.**
- **Label: `Delete Account`**, matching `docs/delete-account.html:311-314` verbatim. The page is
  step-by-step instructions, so the label is a published string rather than a design choice.
- Tapping it sets `deleteOpen` and nothing else. All work is in §1–§3.
- Constraints held: any icon from `Icon` (`trash` is registered, `Icon.tsx:124`); every colour a
  `COLORS` token — no hex literal is introduced; no `android_ripple` on a rounded control; no
  `Alert.alert` anywhere, keeping the repository at zero occurrences.

**One consequence for PROP-0007's test file.** Its
`src/screens/main/__tests__/SettingsScreen.test.tsx` asserts the screen's sign-out behaviour. When
this lands, that suite gains the delete cases — that the button opens the modal rather than
deleting, and that `pauseAll()` runs before the service call. Those belong in that file, not in
the service test above, and they are the implementer's step 2.

---

## Tests

`src/services/__tests__/deleteMyAccount.test.ts`. **Apply with the implementation; see the note at
the top.**

**Why a mock here, when [testing.md](../../standards/testing.md) §4 says services are tested
against a scratch database because "mocking the client tests the mock".** That rule is about query
construction and row mapping, and it is right about those. What is under test here is
**orchestration**: the order of the calls, and which of them must not happen after a failure. A
scratch Postgres has no storage service and cannot observe that ordering at all. PROP-0003's plan
step 3 asks for exactly this — *"unit test with a mocked client asserting storage removal is
called BEFORE the rpc, and that a storage failure does not proceed to the rpc"* — so the mock is
the sanctioned tool for this specific property, not a workaround. What it cannot prove is stated
in *Verification*.

```ts
/**
 * Ordering and abort tests for the account-deletion flow.
 *
 * The property under test is sequence, not queries: storage must be emptied
 * while a session still exists, because the RPC removes the auth user and
 * nothing can reach those files afterwards (PROP-0003 §3, PROP-0008).
 */

type Entry = { name: string; id: string | null };

// Everything the jest.mock factory closes over must be `mock`-prefixed, or
// babel-plugin-jest-hoist rejects the file at transform time.
const mockEnv = {
  calls: [] as string[],
  bucket: '',
  listResponses: new Map<string, Entry[]>(),
  listError: null as string | null,
  removeError: null as string | null,
  removeShortBy: 0,
  rpcError: null as string | null,
};

const mockList = jest.fn(async (prefix: string, opts: { limit: number; offset: number }) => {
  mockEnv.calls.push(`list:${mockEnv.bucket}:${prefix}:${opts.offset}`);
  if (mockEnv.listError) { return { data: null, error: { message: mockEnv.listError } }; }
  const all = mockEnv.listResponses.get(`${mockEnv.bucket}/${prefix}`) ?? [];
  return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
});

const mockRemove = jest.fn(async (paths: string[]) => {
  mockEnv.calls.push(`remove:${mockEnv.bucket}:${paths.join(',')}`);
  if (mockEnv.removeError) { return { data: null, error: { message: mockEnv.removeError } }; }
  const kept = paths.slice(0, paths.length - mockEnv.removeShortBy);
  return { data: kept.map(p => ({ name: p })), error: null };
});

// profileService imports the picker at module scope; it is a native module.
jest.mock('react-native-image-crop-picker', () => ({
  openPicker: jest.fn(),
  openCamera: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    auth: {
      getUser: jest.fn(async () => {
        mockEnv.calls.push('getUser');
        return { data: { user: { id: 'me' } }, error: null };
      }),
      signOut: jest.fn(async () => {
        mockEnv.calls.push('signOut');
        return { error: null };
      }),
    },
    rpc: jest.fn(async (name: string) => {
      mockEnv.calls.push(`rpc:${name}`);
      return { data: null, error: mockEnv.rpcError ? { message: mockEnv.rpcError } : null };
    }),
    storage: {
      from: (bucket: string) => {
        mockEnv.bucket = bucket;
        return { list: mockList, remove: mockRemove };
      },
    },
  },
}));

import { deleteMyAccount } from '../profileService';

/** Only file entries carry an id; folders come back with id: null. */
const file = (name: string): Entry => ({ name, id: `id-${name}` });
const folder = (name: string): Entry => ({ name, id: null });

const calls = () => mockEnv.calls;
const firstIndexMatching = (re: RegExp) => mockEnv.calls.findIndex(c => re.test(c));

beforeEach(() => {
  mockEnv.calls.length = 0;
  mockEnv.bucket = '';
  mockEnv.listResponses.clear();
  mockEnv.listError = null;
  mockEnv.removeError = null;
  mockEnv.removeShortBy = 0;
  mockEnv.rpcError = null;
  mockList.mockClear();
  mockRemove.mockClear();
});

describe('deleteMyAccount — ordering', () => {
  beforeEach(() => {
    mockEnv.listResponses.set('avatars/me', [file('avatar_1.jpg')]);
    mockEnv.listResponses.set('tracks-media/me', [folder('t1')]);
    mockEnv.listResponses.set('tracks-media/me/t1', [file('audio.mp3')]);
  });

  it('empties storage before calling the RPC', async () => {
    await deleteMyAccount();
    const lastRemove = calls().map(c => /^remove:/.test(c)).lastIndexOf(true);
    const rpc = firstIndexMatching(/^rpc:delete_my_account$/);
    expect(lastRemove).toBeGreaterThanOrEqual(0);
    expect(rpc).toBeGreaterThan(lastRemove);
  });

  it('signs out only after the RPC has succeeded', async () => {
    await deleteMyAccount();
    expect(firstIndexMatching(/^signOut$/))
      .toBeGreaterThan(firstIndexMatching(/^rpc:delete_my_account$/));
  });

  it('removes files from both buckets', async () => {
    await deleteMyAccount();
    expect(calls()).toContain('remove:avatars:me/avatar_1.jpg');
    expect(calls()).toContain('remove:tracks-media:me/t1/audio.mp3');
  });
});

describe('deleteMyAccount — a storage failure aborts', () => {
  it('does not call the RPC when listing fails', async () => {
    mockEnv.listError = 'network down';
    await expect(deleteMyAccount()).rejects.toThrow(/network down/);
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
    expect(calls()).not.toContain('signOut');
  });

  it('does not call the RPC when removal errors', async () => {
    mockEnv.listResponses.set('avatars/me', [file('avatar_1.jpg')]);
    mockEnv.removeError = 'permission denied';
    await expect(deleteMyAccount()).rejects.toThrow(/permission denied/);
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
  });

  it('does not call the RPC when removal silently drops files', async () => {
    mockEnv.listResponses.set('avatars/me', [file('a.jpg'), file('b.jpg')]);
    mockEnv.removeShortBy = 1;
    await expect(deleteMyAccount()).rejects.toThrow(/Only some of your files/);
    expect(calls().some(c => c.startsWith('rpc:'))).toBe(false);
  });

  it('leaves the second bucket untouched when the first fails', async () => {
    mockEnv.listResponses.set('avatars/me', [file('a.jpg')]);
    mockEnv.removeError = 'denied';
    await expect(deleteMyAccount()).rejects.toThrow();
    expect(calls().some(c => c.includes('tracks-media'))).toBe(false);
  });
});

describe('deleteMyAccount — the nested tracks-media layout', () => {
  it('descends into per-track folders instead of trying to remove them', async () => {
    mockEnv.listResponses.set('avatars/me', []);
    mockEnv.listResponses.set('tracks-media/me', [folder('t1'), folder('t2')]);
    mockEnv.listResponses.set('tracks-media/me/t1', [file('audio.mp3'), file('cover.jpg')]);
    mockEnv.listResponses.set('tracks-media/me/t2', [file('video.mp4')]);

    await deleteMyAccount();

    const removed = calls().filter(c => c.startsWith('remove:tracks-media:')).join('|');
    expect(removed).toContain('me/t1/audio.mp3');
    expect(removed).toContain('me/t1/cover.jpg');
    expect(removed).toContain('me/t2/video.mp4');
    expect(removed).not.toContain('me/t1,');
    expect(removed).not.toMatch(/me\/t1$/);
  });

  it('pages past the 100-row list default', async () => {
    const many = Array.from({ length: 150 }, (_, i) => file(`avatar_${i}.jpg`));
    mockEnv.listResponses.set('avatars/me', many);
    mockEnv.listResponses.set('tracks-media/me', []);

    await deleteMyAccount();

    const removed = calls().filter(c => c.startsWith('remove:avatars:')).join(',');
    expect(removed).toContain('me/avatar_149.jpg');
    expect(calls()).toContain('list:avatars:me:100');
  });
});

describe('deleteMyAccount — the caller cannot name a victim', () => {
  it('lists only the signed-in user’s own prefix', async () => {
    mockEnv.listResponses.set('avatars/me', [file('a.jpg')]);
    mockEnv.listResponses.set('tracks-media/me', []);
    await deleteMyAccount();
    const listed = calls().filter(c => c.startsWith('list:'));
    expect(listed.length).toBeGreaterThan(0);
    for (const c of listed) {
      expect(c.split(':')[2]).toMatch(/^me(\/|$)/);
    }
  });

  it('takes no argument, so no path can be supplied', () => {
    expect(deleteMyAccount).toHaveLength(0);
  });
});

describe('deleteMyAccount — the rest of the sequence', () => {
  it('still deletes the account when the user has no files', async () => {
    mockEnv.listResponses.set('avatars/me', []);
    mockEnv.listResponses.set('tracks-media/me', []);
    await deleteMyAccount();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(calls()).toContain('rpc:delete_my_account');
    expect(calls()).toContain('signOut');
  });

  it('does not sign out when the RPC fails, so the user can retry', async () => {
    mockEnv.listResponses.set('avatars/me', []);
    mockEnv.listResponses.set('tracks-media/me', []);
    mockEnv.rpcError = 'not_authenticated';
    await expect(deleteMyAccount()).rejects.toThrow(/not_authenticated/);
    expect(calls()).not.toContain('signOut');
  });
});
```

### What was actually run

The function in §1 and the tests above were reproduced in a scratch directory inside the working
tree (`tmp-verify/`, deleted before commit — it is not in this diff), with an equivalent module
path for the mocked client, and run with the project's own Jest config.

**13 of 13 pass.** Each of the eight mutations below was then applied to the implementation and
the suite re-run. These are executed results, not predictions:

| Mutation | Failures | Which tests caught it |
|---|---|---|
| Call the RPC before the storage loop | **4** | *empties storage before the RPC*; all three *does not call the RPC when…* |
| `try/catch` around the storage half, continue on failure | **4** | all four *a storage failure aborts* tests |
| Drop the short-return check | **1** | *does not call the RPC when removal silently drops files* |
| Drop the folder recursion (treat folders as files) | **2** | *removes files from both buckets*; *descends into per-track folders* |
| Drop pagination (one `list()` call) | **1** | *pages past the 100-row list default* |
| Forget `TRACKS_MEDIA_BUCKET` in the bucket list | **2** | *removes files from both buckets*; *descends into per-track folders* |
| `signOut()` before the RPC | **2** | *signs out only after the RPC*; *does not sign out when the RPC fails* |
| Accept `userId` as a parameter | **1** | *takes no argument, so no path can be supplied* |

**One mutation survived, and the code changed rather than the test.** Guarding the removal with
`if (paths.length > 0)` was decoration: `removeOwnedPaths(bucket, [])` already iterates zero
times, so deleting the guard broke nothing and changed no behaviour. The guard is gone from §1.

### The transform constraint that shaped the mock

`babel-plugin-jest-hoist` rejects a `jest.mock` factory that closes over a non-`mock`-prefixed
binding, at transform time — the first version of this file failed to compile for that reason,
nothing to do with the flow. Hence the single `mockEnv` object rather than seven loose `let`s.
Noted so the next person does not rediscover it.

### On `main` today, and what the suite still cannot see

Every test fails to compile against the real tree — `deleteMyAccount` is not exported from
`profileService.ts`. That is why the file is not committed.

**And a green run does not prove the thing that matters most:** nothing here exercises the real
storage API. That it pages at 100, reports folders with a null id, and answers 200 with a short
array on a refusal is read from `@supabase/storage-js` source and types, not observed against a
bucket. ADR-0007's live probe and the by-hand check in *Verification* are what close that.

---

## Implementation plan

Each step is independently reviewable. **Steps 2–3 require PROP-0007 (LIV-73) to have shipped
`SettingsScreen.tsx` first** — it is the container, and this ticket only adds to it.

1. `deleteMyAccount()` in `src/services/profileService.ts` (§1) + the test file above.
   *(Verifiable: `npm test`, then re-run the mutation table.)*
2. The `Delete Account` `Button` in `SettingsScreen.tsx`'s `Account` section (§4), plus the confirm
   modal, its copy, the busy label and the error toast (§2, §3). *(Verifiable by hand: tapping
   through on a test account.)*
3. Extend `src/screens/main/__tests__/SettingsScreen.test.tsx` — the button opens the modal rather
   than deleting, and `pauseAll()` runs before the service call.
4. **LIV-76** — `docs/delete-account.html` states plainly that sent messages persist without
   attribution. A blocker on ship, not on merge; see *LIV-82* above.
5. `npm run typecheck && npm run lint && npm test`.

---

## Scope boundaries

**Explicitly not included.** The first five are PROP-0003:144-161 restated unchanged; the rest are
new to this proposal.

- **Soft delete, a grace period, or undo.** An immediate hard delete satisfies the page's 30-day
  window. Recovery is its own proposal.
- **True storage byte erasure beyond `storage.remove()`.** What this proposal adds *is* the erasure
  step the migration could not perform. Guarantees below that call belong to Supabase.
- **Deleting the user's messages from other people's conversations.** Settled by
  [ADR-0014](../../decisions/0014-reject-widening-msg-update-for-orphaned-messages.md) —
  attribution only.
- **Admin-initiated deletion** for the email fallback. Still manual, still one person.
- **Rate limiting.** D-12 covers it globally.
- **Widening `msg_update`.** Rejected by ADR-0014. Not revisited here, in any form.
- **Any migration.** `delete_my_account()` is not touched. No new table, policy or function.
- **Designing the Settings screen.** PROP-0007 / LIV-73. §4 states only the row's behaviour.
- **Closing LIV-82.** Assessed above, recommended as a recorded follow-up with a revisit trigger.
- **A typed re-confirmation** (entering your username to confirm). `ConfirmActionModal` has no text
  input, so this is a component change, and PROP-0003's stated risk — a mis-wired confirm deleting
  on the wrong tap — is answered by the destructive variant plus two deliberate taps. Named here
  because it is the most reasonable thing a reviewer will ask for, and it is the maintainer's call
  rather than mine.
- **A progress bar or per-file progress.** One busy label, per §3.
- **Deleting the account's push device rows explicitly.** `device_tokens` cascades from `profiles`,
  and `unregisterDevice` already swallows its own errors (`pushNotifications.ts:445-447`), so the
  `SIGNED_OUT` handler's call failing against a deleted user is harmless.

---

## Risk and blast radius

**Ranked by what a wrong change does to a user:**

1. **Deleting the wrong account.** Structurally unrepresentable at both layers: the RPC takes no
   parameter and acts on `auth.uid()`; `deleteMyAccount()` takes no parameter and resolves the
   prefix from the session. Neither the client nor a patched client can name a victim. **This is
   the property to check first in review**, and it is the reason `userId` is not an argument even
   though every other function in `profileService.ts` takes one.
2. **Partial deletion — media orphaned behind a deleted account.** PROP-0003's second-named bad
   outcome and the reason for the abort rule and the short-return check. Unrecoverable once the
   RPC runs: no session, no owner, nothing to list with.
3. **Silently deleting nothing.** The failure mode of a non-recursive `list()`: every track file
   survives and the flow reports success. Caught by the nested-layout test; not visible by hand
   unless someone opens the storage browser.
4. **A user misled by the modal.** They confirm believing their DMs vanish. Answered by bullet 3,
   and by LIV-76 on the published page.
5. **A stranded session after a mid-flow kill.** Bounded by the token lifetime, self-healing, and
   safely retryable because the RPC is idempotent.

**Blast radius.** No schema, no policy, no RPC, no native code, no playback path beyond calling
the existing `pauseAll()`. One new exported function and one modal. `profileService.ts` is
imported by `RootNavigator.tsx:11` for `getUsernameSet`, so a syntax error there breaks the
session gate — the file is more load-bearing than its size suggests, and `tsc` is the guard.

**Reversibility.** The UI is a revert away; the entry point can be removed without touching the
schema. **A completed deletion is not reversible at all, by design.**

---

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` clean; the tests above pass and the mutation
  table's entries fail.
- **By hand, on a test account — this is the part the tests cannot do.** Upload at least one audio
  track *and* one video (so `tracks-media/${uid}/` has more than one folder), set an avatar,
  create an album with a cover, send a DM to a second test account, then delete.
  - The app returns to onboarding without a manual navigation call.
  - The account cannot sign in again.
  - **In the Supabase storage browser: no objects remain under `${uid}/` in either `avatars` or
    `tracks-media`.** This is the assertion that catches a non-recursive `list()`, and it is
    invisible from inside the app.
  - As the *second* account: the conversation and the message are still there, author `[deleted]`
    in italic (the LIV-71/72 rendering). This is PROP-0003's most-worth-doing-by-hand check and
    the one a CASCADE regression would silently break.
  - The lock-screen notification is gone (`pauseAll()` before sign-out).
- **The negative check:** with no uploads at all, deletion still completes. A user who signed up
  and never posted must be able to leave.
- **A failure check, forced:** airplane mode after opening the modal, then confirm. Expect an
  error toast, the account intact, and the ability to sign in again afterwards. This is the
  storage-abort rule observed rather than asserted.
- **Not verified by any of the above**, and stated so a green run does not imply it: that
  storage-api pages, reports folders, and short-returns as the mock models. Only ADR-0007's live
  probe settles that, and it has not been run.

---

## Alternatives

| Alternative | Why set aside |
|---|---|
| `navigation.reset()` to the auth stack after `signOut()` | A second session gate beside `RootNavigator`'s (P12), racing the gate's own re-render. The existing sign-out path proves it is unnecessary. |
| Put `signOut()` in the screen rather than the service | Splits the ordering across two layers, so "storage, then RPC, then sign out" stops being a testable property of anything. |
| Derive the file paths from `tracks.audio_url` / `video_url` / `cover_art_url` instead of listing | Cheaper, and wrong: it misses any object whose row insert failed after the upload succeeded — precisely the orphans that most need removing — and it parses a URL to recover a path we never stored. |
| `listV2()` for recursive listing | A newer `object/list-v2` endpoint whose availability on the deployed storage-api is unknown. A 404 here means files silently survive. `list()` plus explicit recursion is boring and proven (P13). |
| Treat a short `remove()` return as success | Makes a refusal indistinguishable from a deletion, which is the exact failure PROP-0003:154-156 says must abort. |
| Let storage failures warn and continue to the RPC | Directly contradicts PROP-0003 and leaves the published media-deletion claim unmet, with no session left to retry. |
| Do the storage cleanup inside `delete_my_account()` | Already there for the *metadata* (`:215-216`), and that is its limit — the migration's own comment (`:59-67`) explains that deleting `storage.objects` rows can orphan the bytes. The bytes need the storage API, which needs a session. |
| An edge function holding `service_role` | ADR-0008 decision #4, and this project has no edge functions (D-54). |
| A typed re-confirmation before deleting | See *Scope boundaries*. A component change; flagged for the maintainer rather than assumed. |
| Block this ticket on LIV-82 | Assessed at length above. Recommended against, with the counter-argument stated and the conditions named. |

---

## Graduation — does this move `src/services/profileService.ts` to `writable`?

**No.** Widening `.claude/autonomy-config.yml` is a human edit (`never_agent`, :101-104); this
section only says what the evidence would support.

PROP-0003's ratification note (:36-40) anticipated that this step *"can pull
`src/services/profileService.ts` toward `writable` by bringing its own tests."* Having written
them, I do not think it does, and saying otherwise would be the false assurance the config exists
to prevent.

| Criterion | Status |
|---|---|
| Tests fail when the behaviour breaks | For **`deleteMyAccount` only**, and by claim rather than by executed mutation — the function does not exist yet. |
| They run in CI | Yes, once merged. |
| Recorded with evidence | This document, with the limits marked. |

The file also owns `getUsernameSet` (whose fail-open behaviour gates onboarding and is read by
`RootNavigator`), `claimUsername`, four profile read/write calls, the image picker, and a
hand-rolled multipart upload — **none of which is covered by anything**. Granting write access to
the file on the strength of one function's ordering tests is exactly the over-claim the ladder
exists to stop.

What would actually move it: cover the query/error half against a scratch database as
[testing.md](../../standards/testing.md) §4 requires, or extract the deletion flow into its own
module (`src/services/accountDeletion.ts`) and list *that* — a file whose every line is covered.
The second is cheap and would be defensible; it is proposed here, not performed, because a
one-function module is speculative structure until there is a second reason for it (P25).

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
