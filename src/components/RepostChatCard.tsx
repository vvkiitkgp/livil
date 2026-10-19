import React, { useEffect, useState, type ReactNode } from 'react';
import ChatSongCard from './ChatSongCard';
import { useRelationships } from '../contexts/RelationshipContext';
import { fetchPostById, type FeedPost } from '../services/posts';
import { artistLine, useSpotifyTrack } from '../services/spotify';
import { repostLabel } from '../utils/repostShare';

/**
 * A repost shared in chat (src/utils/repostShare.ts), drawn from the REPOST ITSELF.
 *
 * Whose repost it is, its caption and the song are read from the post under the viewer's
 * RLS — never from the message, which carries whatever its sender's app wrote. Same rule as
 * the profile card in chat (kb/architecture/post-sharing.md): reading the row is what stops
 * a card showing one person's name over another's post, and makes a block apply.
 *
 * When the repost cannot be read — deleted, hidden by a block, or friends-only reposts the
 * viewer may not see (ADR-0028) — the message is drawn as the plain song card it also is
 * (`fallback`), so the song still arrives.
 */

/** One read per repost per app session; a failed read is forgotten so the next mount retries. */
const repostCache = new Map<string, Promise<FeedPost | null>>();

function loadRepost(postId: string): Promise<FeedPost | null> {
  let pending = repostCache.get(postId);
  if (!pending) {
    pending = fetchPostById(postId).catch(() => {
      repostCache.delete(postId);
      return null;
    });
    repostCache.set(postId, pending);
  }
  return pending;
}

type Load = { status: 'loading' } | { status: 'ready'; post: FeedPost } | { status: 'missing' };

export default function RepostChatCard({
  repostPostId,
  fallback,
  onOpen,
  onLongPress,
}: {
  repostPostId: string;
  /** The plain song card, drawn when the repost cannot be read. */
  fallback: ReactNode;
  onOpen: (postId: string) => void;
  /** The chat bubble's long-press, passed to the card's buttons (see ChatSongCard). */
  onLongPress?: () => void;
}) {
  const { meId } = useRelationships();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    loadRepost(repostPostId).then(post => {
      if (cancelled) { return; }
      // An id that turns out to be an upload is not a repost card — the sender's app wrote
      // the metadata, so this is checked rather than assumed.
      setLoad(post && post.kind === 'repost' ? { status: 'ready', post } : { status: 'missing' });
    });
    return () => { cancelled = true; };
  }, [repostPostId]);

  const post = load.status === 'ready' ? load.post : null;
  const spotify = useSpotifyTrack(post?.spotifyTrackId ?? null);

  if (load.status === 'missing') { return <>{fallback}</>; }

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

  const reposter = post.author.displayName?.trim() || post.author.username;
  const repost = {
    label: repostLabel(reposter, !!meId && meId === post.author.id),
    avatarUrl: post.author.avatarUrl,
    initial: (reposter[0] ?? '♪').toUpperCase(),
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
