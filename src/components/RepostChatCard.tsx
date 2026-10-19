import React, { useEffect, useState, type ReactNode } from 'react';
import ChatSongCard, { LockedRepostCard } from './ChatSongCard';
import { useRelationships } from '../contexts/RelationshipContext';
import { fetchPostById, type FeedPost } from '../services/posts';
import { fetchSharedRepostAuthor, type ShareableProfile } from '../services/share';
import { artistLine, useSpotifyTrack } from '../services/spotify';
import { repostLabel } from '../utils/repostShare';
import { resolveAuthorDisplay } from '../utils/authorDisplay';

/**
 * A repost shared in chat (src/utils/repostShare.ts), drawn from the REPOST ITSELF.
 *
 * Whose repost it is, its caption and the song are read from the post under the viewer's
 * RLS — never from the message, which carries whatever its sender's app wrote. Same rule as
 * the profile card in chat (kb/architecture/post-sharing.md): reading the row is what stops
 * a card showing one person's name over another's post, and makes a block apply.
 *
 * When the repost cannot be read because its reposter keeps reposts to FRIENDS (ADR-0028) and
 * the viewer is not one, the card says whose it is and nothing else — "Riya's repost · Only
 * Riya's friends can see this repost", no caption, no song — and opens Riya's profile (owner,
 * 2026-10-19). The name comes from the server (`fetchSharedRepostAuthor`), never from the
 * message. Anything else unreadable — deleted, a block, a backend without that function — is
 * drawn as the plain song card the message also is (`fallback`), so the song still arrives.
 */

/**
 * Reads are shared between the cards of one chat, but kept only briefly: each was made under
 * one account's RLS, so a block, an unfriend, a switch to friends-only reposts or a deletion
 * must reach the card without an app restart. A failed read is forgotten at once, so the next
 * mount retries. Cleared on sign-out (RootNavigator), like the profile-card cache, so the next
 * account on this phone never sees what the last one could.
 */
const REPOST_CACHE_MS = 2 * 60 * 1000;
/** `settled` is filled once the read answers, so a remount draws the card at once. */
/** `post` resolves to undefined when the read FAILED, as opposed to null: no readable row. */
type CacheEntry = { at: number; post: Promise<FeedPost | null | undefined>; settled?: { post: FeedPost | null } };
const repostCache = new Map<string, CacheEntry>();

export function clearRepostChatCache(): void {
  repostCache.clear();
  authorCache.clear();
}

function freshEntry(postId: string): CacheEntry | null {
  const hit = repostCache.get(postId);
  return hit && Date.now() - hit.at < REPOST_CACHE_MS ? hit : null;
}

function loadRepost(postId: string): Promise<FeedPost | null | undefined> {
  const hit = freshEntry(postId);
  if (hit) { return hit.post; }
  const entry: CacheEntry = { at: Date.now(), post: Promise.resolve(undefined) };
  entry.post = fetchPostById(postId).then(
    post => { entry.settled = { post }; return post; },
    () => { repostCache.delete(postId); return undefined; },
  );
  repostCache.set(postId, entry);
  return entry.post;
}

/** Who made a repost the viewer cannot read, by MESSAGE — the server answers per message. */
type AuthorEntry = {
  at: number;
  author: Promise<ShareableProfile | null>;
  settled?: { author: ShareableProfile | null };
};
const authorCache = new Map<string, AuthorEntry>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function freshAuthor(messageId: string): AuthorEntry | null {
  const hit = authorCache.get(messageId);
  return hit && Date.now() - hit.at < REPOST_CACHE_MS ? hit : null;
}

function loadAuthor(messageId: string): Promise<ShareableProfile | null> {
  // A message still being sent has a local id; it is the sender's, who can read the repost.
  if (!UUID_RE.test(messageId)) { return Promise.resolve(null); }
  const hit = freshAuthor(messageId);
  if (hit) { return hit.author; }
  const entry: AuthorEntry = { at: Date.now(), author: Promise.resolve(null) };
  entry.author = fetchSharedRepostAuthor(messageId).then(
    author => { entry.settled = { author }; return author; },
    () => { authorCache.delete(messageId); return null; },
  );
  authorCache.set(messageId, entry);
  return entry.author;
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; post: FeedPost }
  | { status: 'locked'; author: ShareableProfile }
  | { status: 'missing' };

// An id that turns out to be an upload is not a repost card — the sender's app wrote the
// metadata, so this is checked rather than assumed.
function toLoad(post: FeedPost | null): Load {
  return post && post.kind === 'repost' ? { status: 'ready', post } : { status: 'missing' };
}

// Never "only my friends can see this" on the reposter's own phone.
function toLocked(author: ShareableProfile | null, meId: string | null): Load {
  return author && author.userId !== meId ? { status: 'locked', author } : { status: 'missing' };
}

/** What a remount can draw straight away: a read that already answered skips the placeholder,
 *  which is shorter than the card and made the inverted chat list jump. */
function initialLoad(postId: string, messageId: string, meId: string | null): Load {
  const settled = freshEntry(postId)?.settled;
  if (!settled) { return { status: 'loading' }; }
  if (settled.post) { return toLoad(settled.post); }
  const author = freshAuthor(messageId)?.settled;
  if (!author) { return UUID_RE.test(messageId) ? { status: 'loading' } : { status: 'missing' }; }
  return toLocked(author.author, meId);
}

export default function RepostChatCard({
  repostPostId,
  messageId,
  fallback,
  onOpen,
  onOpenProfile,
  onLongPress,
}: {
  repostPostId: string;
  /** The chat message carrying it — the server says whose repost it is per message. */
  messageId: string;
  /** The plain song card, drawn when the repost cannot be read. */
  fallback: ReactNode;
  onOpen: (postId: string) => void;
  /** Opens the reposter's profile, from the friends-only card. */
  onOpenProfile: (userId: string) => void;
  /** The chat bubble's long-press, passed to the card's buttons (see ChatSongCard). */
  onLongPress?: () => void;
}) {
  const { meId } = useRelationships();
  const [load, setLoad] = useState<Load>(() => initialLoad(repostPostId, messageId, meId));

  useEffect(() => {
    let cancelled = false;
    setLoad(initialLoad(repostPostId, messageId, meId));
    loadRepost(repostPostId).then(async post => {
      // Ask whose it is only when the read ANSWERED with no row. A failed read (offline) is
      // the song card — never "only Riya's friends can see this" shown to her friend on a guess.
      const next = post === null
        ? toLocked(await loadAuthor(messageId), meId)
        : toLoad(post ?? null);
      if (!cancelled) { setLoad(next); }
    });
    return () => { cancelled = true; };
  }, [repostPostId, messageId, meId]);

  const post = load.status === 'ready' ? load.post : null;
  const spotify = useSpotifyTrack(post?.spotifyTrackId ?? null);

  if (load.status === 'missing') { return <>{fallback}</>; }

  if (load.status === 'locked') {
    const reposter = resolveAuthorDisplay(load.author);
    const userId = load.author.userId;
    return (
      <LockedRepostCard
        label={repostLabel(reposter.name, false)}
        note={`Only ${reposter.name}'s friends can see this repost`}
        avatarUrl={load.author.avatarUrl}
        initial={reposter.initial}
        onOpenProfile={() => onOpenProfile(userId)}
        onLongPress={onLongPress}
      />
    );
  }

  const open = () => onOpen(repostPostId);

  if (!post) {
    return (
      <ChatSongCard
        source="livil"
        title={null}
        artist={null}
        artUrl={null}
        loading
        onLongPress={onLongPress}
        repost={{ label: ' ', avatarUrl: null, initial: '', caption: null, onView: open }}
      />
    );
  }

  const reposter = resolveAuthorDisplay(post.author);
  const repost = {
    label: repostLabel(reposter.name, !!meId && meId === post.author.id),
    avatarUrl: post.author.avatarUrl,
    initial: reposter.initial,
    caption: post.caption?.trim() || null,
    onView: open,
  };

  if (post.spotifyTrackId) {
    const track = spotify.status === 'ready' ? spotify.track : null;
    const pending = spotify.status === 'loading';
    return (
      <ChatSongCard
        source="spotify"
        title={track ? track.title : pending ? null : 'Spotify song'}
        artist={track ? artistLine(track) : pending ? null : 'Open it in Spotify to see it'}
        artUrl={track?.imageUrl ?? null}
        loading={pending}
        onLongPress={onLongPress}
        repost={repost}
      />
    );
  }

  // The song's maker, not the reposter — the same name the feed card and the message carry.
  const maker = post.originalAuthor ?? post.author;
  return (
    <ChatSongCard
      source="livil"
      title={post.track.title}
      artist={maker.displayName?.trim() || maker.username}
      artUrl={post.track.coverArtUrl ?? post.track.thumbnailUrl}
      onLongPress={onLongPress}
      repost={repost}
    />
  );
}
