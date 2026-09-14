---
tier: 4
owner: principal-client
consumers: [CA, TR, ALL]
last_verified: 2026-07-29
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0014]
---

# PROP-0006 — Wire the deleted-author helper into the surfaces that misrender a null author

| | |
|---|---|
| **Status** | **Draft** · Ratified · Rejected · Deferred · Implemented |
| **Date** | 2026-07-29 |
| **Domain** | client (with data) |
| **Addresses** | [PROP-0003](0003-in-app-account-deletion.md) §1, [ADR-0014](../../decisions/0014-reject-widening-msg-update-for-orphaned-messages.md) ruling, D-62 |
| **Jira** | LIV-72 (follows LIV-71, merged as PR #103) |

---

## Why this is a proposal and not a commit

Every call site below is `propose_only` in [`.claude/autonomy-config.yml`](../../../.claude/autonomy-config.yml):
`src/screens/**` (:65), `src/components/**` (:67), `src/services/**` (:70). The only writable
file the change touches is `src/utils/authorDisplay.ts`, and the addition it needs there is dead
code until the propose-only half lands — so it belongs in the same commit, not ahead of it.

**The tests below are also not committed.** They assert the fixed behaviour and would fail on
`main` until the implementation lands. Apply both halves together.

---

## Problem

`20260722200000_account_deletion.sql` made five author columns `ON DELETE SET NULL`, and the
human ruling on [ADR-0014](../../decisions/0014-reject-widening-msg-update-for-orphaned-messages.md)
(2026-07-29) confirmed the product decision that follows from it: **account deletion erases
attribution, not content.** A deleted user's messages, credits and queue entries stay visible to
the people they were sent to, with no author.

LIV-71 shipped the helper that decides what to render in that case —
`resolveAuthorDisplay(identity) → { name, initial, isDeleted }` in
[`src/utils/authorDisplay.ts`](../../../src/utils/authorDisplay.ts). **Nothing calls it.** Every
surface still improvises, and each improvises differently:

- a blank name row where the sender used to be,
- a bare `?` carried around as if it were a person's name,
- a `string` type over a column that is now nullable.

The first is user-visible today the moment anyone deletes an account. The others are latent, and
the type lie is the one that will produce the next bug rather than this one.

## Why now

The helper exists, is tested, and has no callers — which is the worst state to leave it in
(Constitution P5: a well-written orphan that a future contributor will find, trust and reuse).
Either it gets wired up or it should be deleted. This proposal is the first option.

It is also the cheapest moment: the decision the rendering encodes was ratified two days ago, so
there is nothing left to argue about at each call site.

---

## The verified surface list

Every line below was re-read at `33a0be7`. **The ticket's list needed three corrections** — two
additions and one demotion. They are marked.

| # | Site | Today | After |
|---|---|---|---|
| 1 | `src/screens/main/ConversationScreen.tsx:228` | `{msg.senderDisplayName \|\| msg.senderUsername}` → **blank name row** | `[deleted]`, in italic |
| 1a | `ConversationScreen.tsx:217` | `(…\|\| '?').slice(0,1).toUpperCase()` → `?` | `?` — **unchanged, by requirement** |
| 1b | `ConversationScreen.tsx:256, :1023` | reply quote says `Unknown` for the same person the bubble calls `[deleted]` | `[deleted]`, `Unknown` retained for the not-yet-loaded case |
| 1c | **`src/screens/main/JamRoomScreen.tsx:443`** — *not in the ticket* | `{item.senderDisplayName \|\| item.senderUsername}` → **blank name row**, identical defect | `[deleted]` |
| 2 | `src/services/tracks.ts:543` → `src/components/FullScreenPlayer.tsx:322, :331, :533` | `m.displayName ?? m.username ?? '?'` | a resolved `AuthorDisplay`; the avatar still shows `?` |
| 3 | `src/services/jamRooms.ts:78` | `hostId: row.host_id as string` — a nullable column typed `string` | `string \| null` |
| 4 | `src/services/jamRooms.ts:245-246` | `suggestedByUsername: string \| null` | a resolved `AuthorDisplay` |
| 5 | **`src/services/conversations.ts`** — *no read path exists at all* | `created_by` is never selected anywhere in `src/` | a mapper that resolves it, behind the existing group-info fetch |

### Corrections to the ticket

**Addition — `JamRoomScreen.tsx:443`.** Jam chat renders messages from the same `messages` table
through the same `ChatMessage` type and carries the byte-identical expression. Fixing
`ConversationScreen` and not this leaves the same blank name in the jam tab. It costs one line.

**Addition — `ConversationScreen.tsx:256` and `:1023`.** Reply quotes fall back to `Unknown`.
Once the bubble says `[deleted]`, the quote of that same message saying `Unknown` is two names
for one person in one screen.

**Demotion — surface 2 is not the user-visible defect the ticket describes.** `CollabAvatar`
(`FullScreenPlayer.tsx:353-365`) uses its `name` prop for **exactly one thing**: `avatarInitials(name || '?')`.
`avatarInitials('?')` returns `'?'`, so a deleted collaborator renders a `?` circle today and
will still render a `?` circle after this change. **The fix here is preventative, not visible**:
it stops `'?'` from being carried as a *name*, so the next component that renders that field
prints `[deleted]` rather than a punctuation mark. Stating otherwise would overclaim.

**Correction — surface 3 changes no runtime behaviour.** `row.host_id as string` is a cast, not a
coercion; when the column is null, `hostId` is already `null` at runtime and
`state.hostId === uid` is already `false`. Further, `delete_my_account()` sets
`status = 'ended'` on the user's hosted rooms *before* the FK nulls
(`20260722200000_account_deletion.sql:204-207`), and `get_jam_snapshot` only returns
`status = 'active'` rooms — so a null `host_id` is **currently unreachable through this path**.
The fix is a type fix, enforced by `tsc`, not by a test. See *Risk*.

**Correction — surface 5 has no consumer and no read path.** `grep -rn "created_by" src/` returns
nothing, and `list_my_conversations` (`20260528000000_chat_jam.sql:374-388`) does not return the
column. Hardening it therefore means *creating* the read path. The maintainer asked for this over
the triage recommendation to drop it; §5 below implements it, and the tradeoff is stated plainly
rather than argued away.

### Checked and deliberately excluded

| Surface | Why excluded |
|---|---|
| `jam_rooms.host_id` display (`jamRooms.ts:79`) | Already degrades to `'Unknown'`. Changing that copy is a product decision. |
| `activity_notifications.actor_id` | Already degrades to `'unknown'`. Same. |
| `InboxScreen.tsx:62` | Already falls back correctly. |
| `getJamQueue`'s `trackArtist` | Not a null-author surface. `tracks.uploader_id` is `not null … on delete cascade` (`00000000000000_baseline_schema.sql:83`), so a deleted uploader's tracks are deleted, not orphaned. |
| `getGroupMembers` returning `username: ''` on a profile miss (`conversations.ts:198`) | A real defect of the same class, but it is a *join miss*, not a deleted author, and it needs its own decision about what a member row with no profile should do. Filed as follow-up. |
| The other six copies of `avatarInitials` | §1 puts one shared version in `src/utils/`; migrating the other six is a mechanical follow-up, not this change. |

---

## Proposal

Six edits, one shared helper addition, and one small extraction. Ordered so each is
independently reviewable.

### 1. `src/utils/authorDisplay.ts` — one shared `avatarInitials` *(writable)*

Two-letter initials are computed in **seven** places today. This change needs one more caller;
adding an eighth copy is the thing the standards explicitly forbid, so the shared version goes in
the file that already owns author display.

```diff
 export const DELETED_AUTHOR_NAME = '[deleted]';
 export const AUTHOR_INITIAL_FALLBACK = '?';
+
+/**
+ * Two-letter avatar initials. Falls back to `initial` for a deleted author, so the
+ * placeholder can never be sliced into an avatar circle as '[D'.
+ */
+export function avatarInitials(display: AuthorDisplay): string {
+  const parts = display.isDeleted ? [] : display.name.trim().split(/\s+/).filter(Boolean);
+  if (parts.length === 0) { return display.initial; }
+  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
+  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
+}
```

### 2. `src/services/messages.ts` — resolve a sender from the authoritative signal

**Do not call `resolveAuthorDisplay` directly at the chat render sites.** A null *name* is not the
deletion signal; a null `sender_id` is — that is the column `ON DELETE SET NULL` touches. A live
sender can have null names when the profile fetch missed, and `fetchMessages` **discards that
query's error** (`messages.ts:215`: `const { data: profileData } = await db…`). A naive
`resolveAuthorDisplay({displayName, username})` at the render site would label an entire
conversation `[deleted]` on one failed profile query.

```diff
 import { supabase } from '../../lib/supabase';
 import { sendPush } from './pushDispatch';
+import { resolveAuthorDisplay, type AuthorDisplay } from '../utils/authorDisplay';
```

Insert after the `ChatMessage` type (currently ends at `messages.ts:127`):

```ts
/**
 * `sender_id` is the deletion signal — a null name only means the profile fetch
 * missed, and fetchMessages discards that query's error.
 */
export function senderDisplay(
  msg: Pick<ChatMessage, 'senderId' | 'senderDisplayName' | 'senderUsername'>,
): AuthorDisplay {
  if (msg.senderId === null) { return resolveAuthorDisplay({}); }
  const d = resolveAuthorDisplay({
    displayName: msg.senderDisplayName,
    username: msg.senderUsername,
  });
  return d.isDeleted ? { name: '', initial: d.initial, isDeleted: false } : d;
}
```

**This is a function, not a field on `ChatMessage`.** That is deliberate: `ChatMessage[]` is
persisted to AsyncStorage under `@livil:msgs_v1_*` (`messageCache.ts:18`), and a required object
field would be `undefined` on every cached message written by a previous build — a crash on the
first chat open after update, for every existing user. A function reads old and new rows alike.

### 3. `src/screens/main/ConversationScreen.tsx`

```diff
 import { formatChatTimestamp, formatChatTimeOnly, shouldShowTimeSeparator } from '../../utils/chatTime';
```
```diff
   fetchMessages,
   sendMessage,
   addReaction,
   removeReaction,
+  senderDisplay,
   type ChatMessage,
   type SendMessagePayload,
 } from '../../services/messages';
```

In `MessageBubble`, after `const isSystem = msg.kind === 'system';` (`:189`):

```diff
   const isSystem = msg.kind === 'system';
+  const sender = senderDisplay(msg);
```

```diff
             <View style={styles.senderAvatarPlaceholder}>
               <Text style={styles.senderAvatarText}>
-                {(msg.senderDisplayName || msg.senderUsername || '?').slice(0, 1).toUpperCase()}
+                {sender.initial}
               </Text>
             </View>
```

```diff
           <View style={styles.senderNameRow}>
-            <Text style={styles.senderName}>
-              {msg.senderDisplayName || msg.senderUsername}
-            </Text>
+            <Text style={[styles.senderName, sender.isDeleted && styles.senderNameDeleted]}>
+              {sender.name}
+            </Text>
             {msg.senderId ? <AddBadge userId={msg.senderId} size="sm" /> : null}
           </View>
```

```diff
                   {repliedTo
-                    ? (repliedTo.senderDisplayName || repliedTo.senderUsername || 'Unknown')
+                    ? (senderDisplay(repliedTo).name || 'Unknown')
                     : 'Original message'}
```

```diff
                     Replying to {replyingTo.senderId === myId
                       ? 'yourself'
-                      : (replyingTo.senderDisplayName || replyingTo.senderUsername || 'Unknown')}
+                      : (senderDisplay(replyingTo).name || 'Unknown')}
```

```diff
   senderName: { color: COLORS.textSecondary, fontSize: 11, marginLeft: 2 },
+  senderNameDeleted: { fontStyle: 'italic' },
```

`senderName` is already `COLORS.textSecondary`, so italic is the whole visual distinction — which
is the intent. `[deleted]` is not an error state and should not be styled as one.

### 4. `src/screens/main/JamRoomScreen.tsx:443`

```diff
 import {
   fetchMessages,
   sendMessage,
+  senderDisplay,
   type ChatMessage,
   type SendMessagePayload,
 } from '../../services/messages';
```

```diff
           {!isMe && (
-            <Text style={styles.bubbleSender}>{item.senderDisplayName || item.senderUsername}</Text>
+            <Text style={styles.bubbleSender}>{senderDisplay(item).name}</Text>
           )}
```

### 5. `src/services/tracks.ts` — resolve the collaborator, drop the `'?'`-as-a-name

Replace `displayName` / `username` on `TrackCollaboratorInfo` rather than adding a third field.
Two representations of the same fact diverge (Constitution P3), and nothing else in `src/` reads
those two fields — `grep -rn "TrackCollaboratorInfo"` returns `tracks.ts` and `FullScreenPlayer.tsx`
only, and the three call sites all spell the same expression. `tsc` proves the migration is
complete.

```diff
+import { resolveAuthorDisplay, type AuthorDisplay } from '../utils/authorDisplay';
```

```diff
 export type TrackCollaboratorInfo = {
   /** null for custom (no-account) collaborators */
   userId: string | null;
   role: string;
-  /** Display name or custom name */
-  displayName: string | null;
-  username: string | null;
+  display: AuthorDisplay;
   avatarUrl: string | null;
 };
+
+type CollaboratorRow = { user_id: string | null; custom_name: string | null; role: string };
+type CollaboratorProfile = { username: string; display_name: string | null; avatar_url: string | null };
+
+export function toCollaboratorInfo(
+  row: CollaboratorRow,
+  profile: CollaboratorProfile | undefined,
+): TrackCollaboratorInfo {
+  if (row.user_id) {
+    return {
+      userId: row.user_id,
+      role: row.role,
+      display: resolveAuthorDisplay({
+        displayName: profile?.display_name,
+        username: profile?.username,
+      }),
+      avatarUrl: profile?.avatar_url ?? null,
+    };
+  }
+  return {
+    userId: null,
+    role: row.role,
+    display: resolveAuthorDisplay({ displayName: row.custom_name }),
+    avatarUrl: null,
+  };
+}
```

Then `fetchTrackCollaborators`'s tail (`:531-547`) collapses to:

```diff
-  return rows.map(r => {
-    if (r.user_id) {
-      const p = profileMap.get(r.user_id as string);
-      return {
-        userId: r.user_id as string,
-        role: r.role as string,
-        displayName: p?.display_name ?? null,
-        username: p?.username ?? null,
-        avatarUrl: p?.avatar_url ?? null,
-      };
-    }
-    return {
-      userId: null,
-      role: r.role as string,
-      displayName: r.custom_name as string | null,
-      username: null,
-      avatarUrl: null,
-    };
-  });
+  return (rows as CollaboratorRow[]).map(r =>
+    toCollaboratorInfo(r, r.user_id ? profileMap.get(r.user_id) : undefined),
+  );
```

**A custom-name credit is not a deleted author.** `resolveAuthorDisplay({ displayName: 'DJ Snake' })`
returns `isDeleted: false`; only `(user_id null, custom_name null)` — the state
`20260722200000` made representable by relaxing `collab_user_xor_custom` — resolves to `[deleted]`.

### 6. `src/components/FullScreenPlayer.tsx` + new `src/components/CollabAvatar.tsx`

`CollabAvatar` must stop taking a bare `name: string`; it is also the only render site in this
change that can be unit-tested, and it cannot be while it is a private function inside a
2,046-line component. Move it out. **`FullScreenPlayer.tsx` is owned by `principal-playback` —
that owner must review this hunk**, even though it touches no playback path.

New file `src/components/CollabAvatar.tsx`:

```tsx
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';
import { avatarInitials, type AuthorDisplay } from '../utils/authorDisplay';

export default function CollabAvatar({
  uri,
  display,
  size = 36,
}: {
  uri: string | null;
  display: AuthorDisplay;
  size?: number;
}) {
  return (
    <View style={[st.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={st.img} />
      ) : (
        <Text style={[st.initials, { fontSize: size * 0.35 }]}>{avatarInitials(display)}</Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
  initials: { color: COLORS.purpleLight, fontWeight: '700' },
});
```

`overflow: 'hidden'` is retained deliberately — this host clips an avatar image, which
[design-system.md](../../standards/design-system.md) names as the one legitimate case.

In `FullScreenPlayer.tsx`:

```diff
+import CollabAvatar from './CollabAvatar';
+import { resolveAuthorDisplay } from '../utils/authorDisplay';
```

```diff
-function avatarInitials(name: string): string {
-  const parts = name.trim().split(/\s+/).filter(Boolean);
-  if (parts.length === 0) { return '?'; }
-  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
-  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
-}
```

```diff
-/** Small avatar circle used in collaborator rows. */
-function CollabAvatar({ uri, name, size = 36 }: { uri: string | null; name: string; size?: number }) {
-  …
-}
-
-const avSt = StyleSheet.create({ … });
```
*(delete `:352-378` in full — `avSt` has no other reader)*

The four call sites:

```diff
-        <CollabAvatar uri={nowPlaying.authorAvatarUrl} name={nowPlaying.artistName} size={52} />
+        <CollabAvatar
+          uri={nowPlaying.authorAvatarUrl}
+          display={resolveAuthorDisplay({ displayName: nowPlaying.artistName })}
+          size={52}
+        />
```

```diff
                   <CollabAvatar
                     uri={m.avatarUrl}
-                    name={m.displayName ?? m.username ?? '?'}
+                    display={m.display}
                     size={28}
                   />
```
*(identically at `:322`, `:331` and `:533`; only the `size` differs)*

### 7. `src/services/jamRooms.ts` — the host-id type lie, and the queue suggester

```diff
+import { resolveAuthorDisplay, type AuthorDisplay } from '../utils/authorDisplay';
```

```diff
 export type JamRoomState = {
   jamRoomId: string;
-  hostId: string;
+  hostId: string | null;
   hostUsername: string;
```

```diff
 export type QueueItem = {
   id: string;
   trackId: string;
-  suggestedBy: string | null;
-  suggestedByUsername: string | null;
+  suggestedById: string | null;
+  suggestedBy: AuthorDisplay;
   position: number;
```

Both mappers become exported pure functions:

```ts
export function toJamRoomState(row: Record<string, unknown>): JamRoomState {
  return {
    jamRoomId: row.jam_room_id as string,
    hostId: (row.host_id as string | null) ?? null,
    hostUsername: (row.host_username as string | null) ?? 'Unknown',
    playbackPositionMs: Number(row.playback_position_ms ?? 0),
    isPlaying: Boolean(row.is_playing),
    hostClockAt: (row.host_clock_at as string | null) ?? null,
  };
}
```

```ts
type QueueRow = { id: string; track_id: string; suggested_by: string | null; position: number; upvotes: number };
type ProfileLite = { username: string; displayName: string | null };
type TrackLite = { title: string | null; cover_art_url: string | null; uploader_id: string | null };

export function toQueueItem(
  row: QueueRow,
  track: TrackLite | undefined,
  uploader: ProfileLite | null,
  suggester: ProfileLite | null,
): QueueItem {
  return {
    id: row.id,
    trackId: row.track_id,
    suggestedById: row.suggested_by,
    suggestedBy: resolveAuthorDisplay({
      displayName: suggester?.displayName,
      username: suggester?.username,
    }),
    position: row.position,
    upvotes: row.upvotes,
    trackTitle: track?.title ?? null,
    trackArtist: uploader ? (uploader.displayName ?? uploader.username) : null,
    trackCoverArt: track?.cover_art_url ?? null,
  };
}
```

`joinJamRoom` (`:71-81`) and `getJamQueue` (`:238-253`) then call them:

```diff
   const row = data as Record<string, unknown>;
-  return {
-    jamRoomId: row.jam_room_id as string,
-    hostId: row.host_id as string,
-    …
-  };
+  return toJamRoomState(row);
```

```diff
-  return rows.map(r => {
-    const track = trackMap.get(r.track_id);
-    const uploader = track?.uploader_id ? profileMap.get(track.uploader_id) : null;
-    const suggester = r.suggested_by ? profileMap.get(r.suggested_by) : null;
-    return { … };
-  });
+  return rows.map(r => {
+    const track = trackMap.get(r.track_id);
+    return toQueueItem(
+      r,
+      track,
+      track?.uploader_id ? profileMap.get(track.uploader_id) ?? null : null,
+      r.suggested_by ? profileMap.get(r.suggested_by) ?? null : null,
+    );
+  });
```

`JamRealtimeContext` already declares `hostId: string | null` (`:45`, `:88`) and its only use is
`state.hostId === uid` (`:184`), so the widened type needs no change there — but `tsc` is what
confirms that, not this sentence.

### 8. `src/services/conversations.ts` — give `created_by` a read path, and harden it

`created_by` is not selected anywhere in `src/`, so there is nothing to harden until a read path
exists. The one that already almost exists is in the wrong layer:
`GroupInfoScreen.tsx:104-109` queries `conversations` directly, which
[data-access.md](../../standards/data-access.md) forbids outright — *"Screens never call the
database directly. Services do."* Moving it into a service is required anyway; carrying
`created_by` through costs one column.

```diff
+import { resolveAuthorDisplay, type AuthorDisplay } from '../utils/authorDisplay';
```

```ts
export type ConversationDetails = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  createdById: string | null;
  createdBy: AuthorDisplay;
};

export function toConversationDetails(
  row: { id: string; kind: string; name: string | null; created_by: string | null },
  creator: { username: string; display_name: string | null } | null,
): ConversationDetails {
  return {
    id: row.id,
    kind: row.kind as ConversationKind,
    name: row.name,
    createdById: row.created_by,
    createdBy: resolveAuthorDisplay({
      displayName: creator?.display_name,
      username: creator?.username,
    }),
  };
}

export async function getConversationDetails(
  conversationId: string,
): Promise<ConversationDetails | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id, kind, name, created_by')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) { return null; }
  const row = data as { id: string; kind: string; name: string | null; created_by: string | null };

  if (!row.created_by) { return toConversationDetails(row, null); }

  const { data: prof } = await db
    .from('profiles')
    .select('username, display_name')
    .eq('id', row.created_by)
    .maybeSingle();
  return toConversationDetails(row, prof as { username: string; display_name: string | null } | null);
}
```

Two queries rather than a PostgREST embed, matching `fetchTrackCollaborators` and `fetchMessages`.
(`jamRealtime.ts:73` does use an embed, but only with an explicitly named FK — see the comment
there for why a bare embed throws.)

`GroupInfoScreen.tsx:104-112` becomes:

```diff
-      const { data: conv } = await db
-        .from('conversations')
-        .select('name')
-        .eq('id', conversationId)
-        .maybeSingle();
-      if (!cancelled && conv) {
-        setGroupName((conv as { name: string | null }).name ?? '');
-        setSavedName((conv as { name: string | null }).name ?? '');
-      }
+      const conv = await getConversationDetails(conversationId);
+      if (!cancelled && conv) {
+        setGroupName(conv.name ?? '');
+        setSavedName(conv.name ?? '');
+      }
```

**The tradeoff, stated plainly.** `createdBy` has no renderer. It costs one extra round-trip when
`created_by` is non-null, on group-info open only, for a value nothing displays. That is
speculative generality (P25), and the triage recommendation to drop it was not unreasonable. The
maintainer chose it anyway, and the case for it is that the mapping is where the decision lives:
whoever adds "Created by X" to group info inherits `[deleted]` instead of writing a fifth
improvisation. It is pinned by a test rather than by this paragraph, which is the only form of
assurance available for a path nothing exercises (P8).

---

## Tests

Apply with the implementation. **The four service mappers below are pure functions with no
Supabase involvement** — which is deliberate: [testing.md](../../standards/testing.md) §4 says
services are tested against a scratch database rather than mocks, because *"mocking the client
tests the mock."* Extracting the row→type mapping and testing that directly honours the rule
instead of working around it. Query construction and error mode remain untested; see *Graduation*.

### `src/services/__tests__/authorMapping.test.ts`

> One file rather than four, because these are four instances of one decision. Split it if the
> service test suites grow their own shape later.

```ts
import { toCollaboratorInfo } from '../tracks';
import { toJamRoomState, toQueueItem } from '../jamRooms';
import { toConversationDetails } from '../conversations';
import { senderDisplay } from '../messages';

describe('toCollaboratorInfo', () => {
  const role = 'Producer';

  it('shows the profile display name for a live collaborator', () => {
    const c = toCollaboratorInfo(
      { user_id: 'u1', custom_name: null, role },
      { username: 'vvk', display_name: 'Vamsi', avatar_url: 'https://a/1.png' },
    );
    expect(c.userId).toBe('u1');
    expect(c.display.name).toBe('Vamsi');
    expect(c.display.isDeleted).toBe(false);
    expect(c.avatarUrl).toBe('https://a/1.png');
  });

  it('falls back to the username when the profile has no display name', () => {
    const c = toCollaboratorInfo(
      { user_id: 'u1', custom_name: null, role },
      { username: 'vvk', display_name: null, avatar_url: null },
    );
    expect(c.display.name).toBe('vvk');
    expect(c.display.initial).toBe('V');
  });

  it('shows [deleted] for a credit whose account was deleted', () => {
    const c = toCollaboratorInfo({ user_id: null, custom_name: null, role }, undefined);
    expect(c.display.name).toBe('[deleted]');
    expect(c.display.isDeleted).toBe(true);
    expect(c.display.initial).toBe('?');
  });

  it('never derives the avatar initial from the deleted placeholder', () => {
    const c = toCollaboratorInfo({ user_id: null, custom_name: null, role }, undefined);
    expect(c.display.initial).not.toBe('[');
  });

  it('keeps a custom-name credit as a real name, not deleted', () => {
    const c = toCollaboratorInfo({ user_id: null, custom_name: 'DJ Snake', role }, undefined);
    expect(c.display.name).toBe('DJ Snake');
    expect(c.display.isDeleted).toBe(false);
    expect(c.userId).toBeNull();
  });

  it('shows [deleted] when the profile join returns nothing for a linked credit', () => {
    const c = toCollaboratorInfo({ user_id: 'u9', custom_name: null, role }, undefined);
    expect(c.display.isDeleted).toBe(true);
    expect(c.userId).toBe('u9');
  });
});

describe('toJamRoomState', () => {
  const base = {
    jam_room_id: 'j1',
    host_username: 'vvk',
    playback_position_ms: 1234,
    is_playing: true,
    host_clock_at: '2026-07-29T00:00:00Z',
  };

  it('carries a present host id through', () => {
    expect(toJamRoomState({ ...base, host_id: 'u1' }).hostId).toBe('u1');
  });

  it('reports a deleted host as null rather than claiming a string', () => {
    const s = toJamRoomState({ ...base, host_id: null });
    expect(s.hostId).toBeNull();
    expect(s.hostId).not.toBe('null');
  });

  it('treats a missing host_id key as null', () => {
    expect(toJamRoomState(base).hostId).toBeNull();
  });

  it('no user id equals a null host, so nobody is granted host control', () => {
    const s = toJamRoomState({ ...base, host_id: null });
    expect(s.hostId === 'u1').toBe(false);
    expect(s.hostId === '').toBe(false);
  });
});

describe('toQueueItem', () => {
  const row = { id: 'q1', track_id: 't1', suggested_by: 'u1', position: 0, upvotes: 2 };
  const track = { title: 'Song', cover_art_url: 'https://c/1.png', uploader_id: 'u2' };

  it('shows the suggester display name when the account is live', () => {
    const q = toQueueItem(
      row, track,
      { username: 'up', displayName: 'Uploader' },
      { username: 'vvk', displayName: 'Vamsi' },
    );
    expect(q.suggestedById).toBe('u1');
    expect(q.suggestedBy.name).toBe('Vamsi');
    expect(q.suggestedBy.isDeleted).toBe(false);
  });

  it('shows [deleted] when suggested_by was nulled by account deletion', () => {
    const q = toQueueItem(
      { ...row, suggested_by: null }, track,
      { username: 'up', displayName: 'Uploader' },
      null,
    );
    expect(q.suggestedById).toBeNull();
    expect(q.suggestedBy.name).toBe('[deleted]');
    expect(q.suggestedBy.isDeleted).toBe(true);
    expect(q.suggestedBy.initial).toBe('?');
  });

  it('shows [deleted] when the suggester profile row is gone but the id remains', () => {
    const q = toQueueItem(row, track, null, null);
    expect(q.suggestedById).toBe('u1');
    expect(q.suggestedBy.isDeleted).toBe(true);
  });

  it('leaves the track fields untouched by the author change', () => {
    const q = toQueueItem(
      { ...row, suggested_by: null }, track,
      { username: 'up', displayName: null },
      null,
    );
    expect(q.trackTitle).toBe('Song');
    expect(q.trackArtist).toBe('up');
    expect(q.trackCoverArt).toBe('https://c/1.png');
  });
});

describe('toConversationDetails', () => {
  const row = { id: 'c1', kind: 'group', name: 'Studio', created_by: 'u1' };

  it('resolves a live creator', () => {
    const d = toConversationDetails(row, { username: 'vvk', display_name: 'Vamsi' });
    expect(d.createdById).toBe('u1');
    expect(d.createdBy.name).toBe('Vamsi');
    expect(d.createdBy.isDeleted).toBe(false);
    expect(d.name).toBe('Studio');
  });

  it('shows [deleted] when created_by was nulled by account deletion', () => {
    const d = toConversationDetails({ ...row, created_by: null }, null);
    expect(d.createdById).toBeNull();
    expect(d.createdBy.name).toBe('[deleted]');
    expect(d.createdBy.isDeleted).toBe(true);
    expect(d.createdBy.initial).toBe('?');
  });

  it('shows [deleted] when the creator id survives but the profile does not', () => {
    const d = toConversationDetails(row, null);
    expect(d.createdById).toBe('u1');
    expect(d.createdBy.isDeleted).toBe(true);
  });

  it('does not confuse an unnamed group with a deleted creator', () => {
    const d = toConversationDetails({ ...row, name: null }, { username: 'vvk', display_name: 'Vamsi' });
    expect(d.name).toBeNull();
    expect(d.createdBy.isDeleted).toBe(false);
  });
});

describe('senderDisplay', () => {
  it('shows the display name of a live sender', () => {
    const d = senderDisplay({ senderId: 'u1', senderDisplayName: 'Vamsi', senderUsername: 'vvk' });
    expect(d.name).toBe('Vamsi');
    expect(d.initial).toBe('V');
    expect(d.isDeleted).toBe(false);
  });

  it('falls back to the username', () => {
    const d = senderDisplay({ senderId: 'u1', senderDisplayName: null, senderUsername: 'vvk' });
    expect(d.name).toBe('vvk');
    expect(d.initial).toBe('V');
  });

  it('shows [deleted] when sender_id was nulled by account deletion', () => {
    const d = senderDisplay({ senderId: null, senderDisplayName: null, senderUsername: null });
    expect(d.name).toBe('[deleted]');
    expect(d.isDeleted).toBe(true);
    expect(d.initial).toBe('?');
  });

  it('never derives the avatar initial from the deleted placeholder', () => {
    const d = senderDisplay({ senderId: null, senderDisplayName: null, senderUsername: null });
    expect(d.initial).not.toBe('[');
  });

  it('does not call a live sender deleted when the profile failed to load', () => {
    const d = senderDisplay({ senderId: 'u1', senderDisplayName: null, senderUsername: null });
    expect(d.isDeleted).toBe(false);
    expect(d.name).toBe('');
    expect(d.name).not.toBe('[deleted]');
    expect(d.initial).toBe('?');
  });
});
```

### `src/components/__tests__/CollabAvatar.test.tsx`

Follows the `GradientBorder` idiom — `react-test-renderer`, asserting emitted props rather than a
snapshot.

```tsx
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, Image } from 'react-native';
import CollabAvatar from '../CollabAvatar';
import { avatarInitials, resolveAuthorDisplay } from '../../utils/authorDisplay';

function textOf(props: React.ComponentProps<typeof CollabAvatar>): string | null {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<CollabAvatar {...props} />);
  });
  const texts = tree.root.findAllByType(Text);
  return texts.length === 0 ? null : (texts[0]!.props.children as string);
}

describe('avatarInitials', () => {
  it('takes two letters from a single-word name', () => {
    expect(avatarInitials(resolveAuthorDisplay({ displayName: 'Vamsi' }))).toBe('VA');
  });

  it('takes one letter from each of the first two words', () => {
    expect(avatarInitials(resolveAuthorDisplay({ displayName: 'Vamsi Bosara' }))).toBe('VB');
  });

  it('uses the ? fallback for a deleted author, never the placeholder text', () => {
    const d = resolveAuthorDisplay({ displayName: null, username: null });
    expect(avatarInitials(d)).toBe('?');
    expect(avatarInitials(d)).not.toBe('[D');
  });
});

describe('CollabAvatar', () => {
  it('renders the image and no initials when an avatar url is present', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <CollabAvatar uri="https://cdn/a.png" display={resolveAuthorDisplay({ displayName: 'Vamsi' })} />,
      );
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
  });

  it('renders initials from the display name when there is no avatar', () => {
    expect(textOf({ uri: null, display: resolveAuthorDisplay({ displayName: 'Vamsi Bosara' }) })).toBe('VB');
  });

  it('renders ? for a deleted collaborator, not a slice of [deleted]', () => {
    const rendered = textOf({
      uri: null,
      display: resolveAuthorDisplay({ displayName: null, username: null }),
    });
    expect(rendered).toBe('?');
    expect(rendered).not.toBe('[D');
  });

  it('still shows a custom-name credit as its own initials', () => {
    expect(textOf({ uri: null, display: resolveAuthorDisplay({ displayName: 'DJ Snake' }) })).toBe('DS');
  });
});
```

### Which of these fail today, and why

| Test group | On `main` today |
|---|---|
| `toCollaboratorInfo` (6) | **Fail to compile** — the function does not exist and `TrackCollaboratorInfo` has no `display` |
| `toQueueItem` (4), `toConversationDetails` (4), `senderDisplay` (5) | **Fail to compile** — same |
| `toJamRoomState` (4) | **Fail to compile**; of these, only *"treats a missing host_id key as null"* would fail on behaviour if the mapper existed with the old cast |
| `avatarInitials` (3), `CollabAvatar` (4) | **Fail to compile** — neither export exists |

### What was actually run, and what the tests catch

The mappers and `CollabAvatar` were reproduced verbatim in a scratch directory outside the
repository, importing the **real** `src/utils/authorDisplay`, and run with the project's Jest
config. **30 of 30 pass.** Each was then deliberately broken (P29):

| Mutation | Caught? |
|---|---|
| Derive the collaborator initial from `name` (`'[deleted]'.slice(0,1)`) | **Yes** — 2 failures, one asserting `not.toBe('[')` |
| Revert `suggestedBy` / `createdBy` to the raw username | **Yes** — 6 failures |
| Drop the `senderId` gate in `senderDisplay` (call `resolveAuthorDisplay` naively) | **Yes** — *"does not call a live sender deleted"* |
| Drop the `isDeleted` branch in `avatarInitials` | **Yes** — renders `[D`, 2 failures |
| **Revert `hostId` to `row.host_id as string`** | **Partially** — only the missing-key case fails. With an explicit JSON `null` the cast produces `null` at runtime either way |

That last row is the honest limit of this suite: **surface 3 cannot be defended by a runtime
test.** `tsc` is its enforcement, and the assertion that matters is that consumers are forced to
handle `null`.

---

## Implementation plan

Each step is independently reviewable; steps 2–8 all depend on step 1.

1. `avatarInitials` in `src/utils/authorDisplay.ts` + its three tests.
2. `senderDisplay` in `src/services/messages.ts` + its five tests.
3. `ConversationScreen` (4 hunks + style) and `JamRoomScreen:443`. *(Verify by hand: a message
   from a deleted account shows an italic `[deleted]` with a `?` avatar; a live sender is
   unchanged.)*
4. `tracks.ts` — `toCollaboratorInfo` + tests.
5. `CollabAvatar.tsx` extraction + tests; rewire the four `FullScreenPlayer` call sites.
   **Requires `principal-playback` review.**
6. `jamRooms.ts` — `toJamRoomState`, `toQueueItem` + tests. `npm run typecheck` is the real
   assertion for the widened `hostId`.
7. `conversations.ts` — `getConversationDetails` + tests; rewire `GroupInfoScreen`.
8. `npm run typecheck && npm run lint && npm test`.

---

## Scope boundaries

**Explicitly not included:**

- **`jam_rooms.host_id` and `activity_notifications.actor_id` display copy.** They degrade to
  `Unknown` / `unknown`. Whether those should become `[deleted]` is a copy decision, not this
  change. Only the `hostId` *type* is touched.
- **Any RLS or migration change.** No column, policy or function is altered.
- **Migrating the other six copies of `avatarInitials`** (`FollowingScreen:30`,
  `StoryViewerScreen:100`, `UserProfileScreen:73`, `ProfileScreen:92`, `PostCard:69`,
  `PostLikersSheet:34`, plus `InboxScreen:47`'s differently-named `initials`). Seven definitions
  exist today; this change deletes one and adds the shared version. Adopting it everywhere is a
  mechanical follow-up with its own diff.
- **`getGroupMembers` returning `username: ''` on a profile miss.** Same class, different cause;
  needs its own decision.
- **Hiding messages from deleted users.** Settled against by the ADR-0014 ruling.
- **Accessibility labels on `CollabAvatar`.** A screen reader announces nothing for a deleted
  credit either before or after. Worth fixing; not here.
- **Rendering `createdBy` anywhere.** §8 produces the value; no surface displays it.

---

## Risk and blast radius

**What a wrong change looks like to a user, ranked:**

1. **The worst outcome is calling a live person deleted.** A group chat where every message reads
   `[deleted]` after one failed profile query would look like mass account deletion, and users
   would reasonably conclude the app lost their friends. This is a real path — `fetchMessages`
   discards its profile-query error (`messages.ts:215`) — and it is precisely why §2 gates on
   `senderId` rather than on the name. The `senderDisplay` test *"does not call a live sender
   deleted"* is the one that defends it; a mutation confirmed it fails without the gate.
2. **A crash on chat open for every existing user.** Avoided by keeping `senderDisplay` a
   function rather than a field on the AsyncStorage-persisted `ChatMessage`. If a future change
   does add a field there, `@livil:msgs_v1_*` must be bumped to `_v2`.
3. **A `[` in an avatar circle.** Prevented structurally: `avatarInitials` reads `initial`, never
   `name`, for a deleted author.
4. **A jam room losing its host.** `hostId` widening to `string | null` means
   `state.hostId === uid` is `false` for a null host, so nobody gets host controls. That is the
   correct outcome and is already today's runtime behaviour — the change is that the type stops
   claiming otherwise.

**Blast radius is contained.** Nothing here touches playback, the native patch, authorization, or
the schema. `FullScreenPlayer.tsx` is a playback-owned file but the hunk is a credits avatar with
no path to the engine, the `<Video>` elements, or `PlaybackContext` — `principal-playback` should
confirm that reading rather than take this sentence for it.

**Reversibility: complete.** Every hunk is a revert away, and no persisted data changes shape.

---

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` clean.
- The 30 tests above pass, and the five mutations in the table above fail.
- **By hand, the assertion no test can make:** on a test account, delete an account that has (a)
  sent a message into a group, (b) a collaborator credit on someone else's track, and (c) an
  entry in a jam queue. Then, as the *other* participant, confirm the message is still there with
  an italic `[deleted]` and a `?` avatar, the credit avatar still renders, and nothing crashes.
  This is the assertion PROP-0003's verification section already called the one most worth doing
  by hand.
- **Negative check, equally important:** with a live account, confirm no surface says `[deleted]`.
  Force it by putting the device in airplane mode after the message list loads.

## Alternatives

| Alternative | Why set aside |
|---|---|
| Call `resolveAuthorDisplay` directly at the chat render sites | Labels a live sender `[deleted]` whenever the profile fetch misses, and that fetch's error is discarded. `senderId` is the authoritative signal. |
| Add `senderDisplay` as a field on `ChatMessage` | `ChatMessage[]` is persisted to AsyncStorage; every message cached by a previous build would have `undefined`, crashing chat on first open after update. A cache-key bump avoids that at the cost of discarding everyone's cache. |
| Keep `displayName`/`username` on `TrackCollaboratorInfo` and *add* `display` | Two representations of one fact, which diverge (P3). Nothing else reads the two fields, so replacing them is safe and `tsc` proves it. |
| Leave `CollabAvatar` inside `FullScreenPlayer` | Its `name: string` prop is the defect. Keeping it private also keeps the only testable render site in this change untestable. |
| Drop the `conversations.created_by` hardening | The triage recommendation, and defensible — no consumer, no read path. Overruled by the maintainer; implemented in §8 with the cost stated. |
| A PostgREST embed for the conversation creator | Saves a round-trip, but every other service here uses two queries, and a bare embed on a table with more than one path to `profiles` throws (see `jamRealtime.ts:67-70`). |
| Add `created_by` to `list_my_conversations` | Needs a migration. Out of scope, and the value is wanted on one screen, not on every inbox row. |

---

## Graduation — does this move anything to `writable`?

**No, and it should not be claimed to.** Widening `.claude/autonomy-config.yml` is a human edit
(`never_agent`, :102); this section only states what the evidence would support.

The criteria are: tests that fail when the behaviour breaks, demonstrated by mutation; running in
CI; recorded with their evidence.

| Path | Would this qualify it? |
|---|---|
| `src/utils/authorDisplay.ts` | Already `writable` under `src/utils/**`. `avatarInitials` arrives with mutation-verified tests, so it does not weaken that. |
| `src/components/CollabAvatar.tsx` | **Yes, on the merits** — same shape as `GradientBorder.tsx`, four render tests, one mutation verified. But `autonomy-config.yml` lists paths, and a per-file entry for a 30-line avatar buys almost nothing. Not worth the line. |
| `src/services/tracks.ts`, `jamRooms.ts`, `conversations.ts`, `messages.ts` | **No.** The tests cover the *mappers*. Each file also owns query construction, error mode and fire-and-forget follow-ups — `tracks.ts` alone carries uploads and waveform backfill — none of which is covered. Granting write access to the file on the strength of its mapper tests would be exactly the false assurance the config exists to prevent. |
| `src/screens/**` | **No.** Nothing here makes a screen testable. `MessageBubble` is a private function inside a 1,432-line file; a render test requires mocking navigation, Supabase, the keyboard controller and four contexts. |

**What would actually move the needle**, concretely, in increasing order of cost:

1. **Extract the service mappers into `src/services/mappers/`** and list *that* directory as
   `writable`. Pure row→type functions, fully covered, no I/O — a path where the coverage claim is
   true for every line in it. This proposal already produces five such functions; a sixth or
   seventh would justify the move.
2. **Cover the query/error half** of one service against a scratch database, as
   [testing.md](../../standards/testing.md) §4 requires. That is what a whole-file graduation of
   `src/services/tracks.ts` would need, and it is a much larger piece of work than this proposal.
3. **Extract `MessageBubble` into `src/components/chat/`** with the contexts it needs injected.
   That is the only route to `ConversationScreen` render coverage, and it is its own change —
   proposed here, not performed.

Until then the honest position is: these mappers are tested; the files that contain them are not.

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
