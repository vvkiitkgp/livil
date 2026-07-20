---
tier: 3
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-20
verify_every: 180d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Glossary

Livil vocabulary. This document covers terms whose Livil meaning is **precise, or differs
from the industry default**. General software terms are not listed.

Every entry below was verified against the codebase, not inferred.

---

## Content

**Track**
The uploaded media itself — the row holding title, cover art, duration, media URLs, and the
waveform envelope. A track is the *artifact*. It is not what appears in a feed.

**Post**
The feed entity that references a track. A post has a `kind` of either `upload` or `repost`.
**A track is uploaded once; it can appear in many posts.** Feed queries, likes, comments, and
view counts attach to the *post*, not the track. Confusing these two is the most common
modeling mistake in this codebase.

**mediaKind**
Either `audio` or `video`, describing a track's media. Significant beyond presentation: video
is excluded from on-device waveform analysis, because decoding a video pulls the whole file
into memory and the process is killed.

**Repost**
A post of kind `repost` pointing at an original upload post. It carries its own **clip
window** and caption. A repost can outlive its original — deletion of the original nulls the
reference rather than removing the repost.

**Story**
An ephemeral repost. Expires 24 hours after creation, and its clip is capped at 10 seconds.
Visible to friends and starrers, never public.

**Clip window**
A `(clip_start_sec, clip_end_sec)` pair on a post defining which portion of a track plays.
**The player always loads the full track and never hard-clips the media** — clipping is
presentational, so the editing UI can still scrub the whole track. See
[architecture/playback.md](architecture/playback.md).

**Album** vs **Playlist**
An **album** is a creator's own collection of their own tracks — an authorship grouping. A
**playlist** is any user's curated collection of posts, with a three-state visibility
(`public`, `friends`, `private`). A track belongs to at most one album; a post can appear in
many playlists.

**Collaborator**
A profile credited on a track in a named musical role (producer, vocalist, and so on).
Credit, not ownership — collaborators do not gain edit rights.

---

## Social graph

Livil has **two independent relationship systems.** They are not variants of one another.

**Friendship**
Mutual and negotiated. Requires a request and an acceptance, has a status, and records who
initiated it. Gates access to direct messages, Jam Rooms, Stories, and listening activity.

**Follow**
One-directional and unnegotiated.

**Star**
A follow with `kind = 'star'`. **This is the term used in the product**; "follow" is the
underlying storage concept. Starring grants visibility of that user's Stories and listening
activity without requiring friendship.

> In short: **friendship is mutual and gates private surfaces; starring is one-way and gates
> ambient visibility.** A user can be starred without being a friend, and vice versa.

**Fan**
A user who has starred you. Appears in activity notifications. Not a distinct database
relation — a directional reading of a star.

---

## Listening together

**Jam Room**
A real-time synchronized listening session attached to a conversation. One **host** controls
playback; **listeners** follow. Playback state is broadcast server-side, not from the client.

**Host** / **Listener**
The two Jam Room roles, each carrying an explicit permission set (play/pause, seek, skip,
change track, suggest). The host holds all permissions; listeners may suggest only.

**Presence**
Ephemeral "who is here and what are they playing" state. Backed by a periodic heartbeat and
realtime presence channels. Distinct from a **listen session**, which is the durable record
used to build friends' activity.

---

## Playback

**The engine**
The single component that produces audio for every post and owns the OS media session. Video
posts play their audio through the engine on a hidden surface. **There is exactly one engine,
and this is a hard invariant** — a second one produces duplicate, uncancellable media
notifications. See [architecture/playback.md](architecture/playback.md).

**Media session**
The operating system's representation of what is playing — the lock screen card, notification
controls, Bluetooth and car controls. Exactly one exists.

**Absolute time** vs **clip-relative time**
**Absolute** is position within the full track, and is what the app uses everywhere
internally. **Clip-relative** is position within the clip window, and is what the lock screen
displays. Translation happens only at the OS boundary. Mixing them is a bug class, not a
style question.

**Floating player**
The small persistent control that rides above most screens, showing the waveform and basic
controls.

**Full-screen player**
The expanded view. For video posts it renders a **muted** video frame that follows the
engine's position — it is a picture surface, never an audio source.

**Waveform peaks**
A precomputed loudness and frequency envelope stored with the track, used to drive the
visualizer in sync with the music. Computed **on device**, and **only for audio**.

---

## Platform

**The patch**
The local modification to the media playback library. Substantial, spanning Kotlin, Java,
Swift, and TypeScript. It implements clip-relative presentation to the OS, native track
skipping, and background auto-advance. **"The patch" always means this one.** Upgrading the
underlying library requires re-deriving it.

**New Architecture** / **Fabric**
React Native's current rendering architecture, enabled here. Relevant because it **defers
view commands and prop changes while the app is backgrounded** — the reason certain playback
behavior had to be implemented natively rather than in JavaScript.

**Backfill**
Filling in data that was missing when a row was created — track duration, waveform peaks.
Backfills are fire-and-forget, never throw, and are idempotent. A failed backfill must never
surface to a user.

**livil Bot**
The in-product name for the activity notification feed (likes, comments, reposts, milestones,
friend outcomes). Not a chat participant and not an AI agent — a system-authored activity
stream presented in a conversation-like surface.

---

## Knowledge base

**Tier**
How a document's truth is maintained (1 generated · 2 enforced · 3 curated · 4 append-only ·
5 narrative). See [ai-org/knowledge-base-spec.md](ai-org/knowledge-base-spec.md).

**Private content**
A document whose real content lives outside this public repository, represented here by a
stub. Applies to security and incident material.

**Board**
The Architecture Board: a proposal-only body that debates decisions, produces ADRs, and
identifies debt. **It never modifies production code.**
