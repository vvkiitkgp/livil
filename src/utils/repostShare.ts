import type { FeedPost } from '../services/posts';
import { spotifyTrackUrl } from './spotifyLinks';

/**
 * A repost sent to a friend in chat (owner, 2026-10-19). Design:
 * kb/architecture/post-sharing.md § Reposts in chat.
 *
 * NO NEW MESSAGE KIND, and nothing changes on the server. The message is exactly what this
 * app already sends for the SONG, plus one metadata key — `repost_post_id` — that only builds
 * with the repost card read:
 *
 *   Livil repost   → `track_share` of the ORIGINAL upload (post_id = the upload), the same
 *                    payload the composer's 🎵 picker sends for a repost.
 *   Spotify repost → a TEXT message whose body is the track's Spotify link (ADR-0027).
 *
 * A build without the repost card ignores the key and draws the song card it always drew —
 * checked at release 2.1.3 (1c56cd0): a playable Livil card, or the Spotify card / link. The
 * inbox line (message_preview) and the push read the kind and body, so they are unchanged.
 *
 * Why the Livil payload names the ORIGINAL: an older build's card plays `post_id` and its
 * Repost button reposts it, and Repost takes an original upload — a repost's own id there
 * would give that build a broken button.
 */

export const REPOST_POST_ID_KEY = 'repost_post_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RepostSharePayload =
  | { kind: 'text'; body: string; metadata: { repost_post_id: string } }
  | {
      kind: 'track_share';
      metadata: {
        track_id: string;
        post_id: string;
        title: string;
        artist_name: string;
        cover_art_url: string | null;
        repost_post_id: string;
      };
    };

type RepostShareSource = Pick<
  FeedPost,
  'id' | 'kind' | 'originalPostId' | 'originalAuthor' | 'author' | 'spotifyTrackId' | 'track'
>;

/**
 * The message a repost is sent as, or null when it cannot be sent: not a repost, or an
 * ORPHANED Livil repost (its upload was deleted), whose song an older build could not play.
 */
export function repostSharePayload(post: RepostShareSource): RepostSharePayload | null {
  if (post.kind !== 'repost') { return null; }

  if (post.spotifyTrackId) {
    return {
      kind: 'text',
      body: spotifyTrackUrl(post.spotifyTrackId),
      metadata: { repost_post_id: post.id },
    };
  }

  if (!post.originalPostId) { return null; }
  // The card names who MADE the song, not who reposted it — same as toShareablePost.
  const artist = post.originalAuthor ?? post.author;
  return {
    kind: 'track_share',
    metadata: {
      track_id: post.track.id,
      post_id: post.originalPostId,
      title: post.track.title,
      artist_name: artist.displayName?.trim() || artist.username,
      cover_art_url: post.track.coverArtUrl ?? post.track.thumbnailUrl,
      repost_post_id: post.id,
    },
  };
}

/**
 * The repost a song message points at, or null. `metadata` is written by the SENDER's app and
 * the database does not check it, so the id is validated here and the card reads the post
 * itself under the viewer's RLS — it never draws whose repost it is from the message.
 */
export function sharedRepostIdFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') { return null; }
  const id = (metadata as Record<string, unknown>)[REPOST_POST_ID_KEY];
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

/** The card's top line: "Riya's repost", or "Your repost" on the reposter's own phone. */
export function repostLabel(reposterName: string, isMine: boolean): string {
  return isMine ? 'Your repost' : `${reposterName}'s repost`;
}
