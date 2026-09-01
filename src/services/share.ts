/**
 * Sharing an upload — to Livil DMs, to Instagram Stories, and to everything else.
 *
 * Design: kb/architecture/post-sharing.md.
 *
 * ── ONLY UPLOADS ARE SHAREABLE ──────────────────────────────────────────────
 * A repost is somebody else's share already, and re-sharing one publicly would put a
 * second person's clip choice on a public URL under the original artist's name.
 * `canSharePost` is what the UI asks, but it is NOT the enforcement: the database
 * function behind the public page (`shared_post_public`) has `kind = 'upload'` in its
 * WHERE clause, so a repost link fetched by hand still resolves to nothing. A hidden
 * button is not an access control.
 *
 * ── WHY THE BUILT-IN Share API IS NOT ENOUGH ────────────────────────────────
 * React Native's own `Share` handles the link case perfectly and is used for it here.
 * What it cannot do on Android is attach a FILE — it sends text and a URL, full stop.
 * Instagram Stories needs an image, so that one path (and only that one) goes through
 * `react-native-share`. Every failure inside it degrades to the plain link, which is
 * why the Story card is an enhancement and never a dependency.
 */
import { Share } from 'react-native';
import RNShare, { Social } from 'react-native-share';
import { supabase } from '../../lib/supabase';
import {
  FACEBOOK_APP_ID,
  buildPostShareMessage,
  postShareUrl,
} from '../constants/links';
import { sendMessage } from './messages';
import type { FeedPost } from './posts';

/** The subset of a post the share paths actually need. Keeps callers from having to
 *  hold a whole `FeedPost` where a player or a detail row only has fragments. */
export type ShareablePost = {
  id: string;
  kind: 'upload' | 'repost';
  trackId: string;
  title: string;
  artistName: string;
  coverArtUrl: string | null;
};

/** Result of a share attempt, so callers can toast the honest outcome rather than
 *  claiming success for a fallback. */
export type ShareOutcome = 'shared' | 'dismissed' | 'fellback';

export function toShareablePost(post: FeedPost): ShareablePost {
  // A repost displays the ORIGINAL artist, so the card and the message say who made
  // the track rather than who reposted it. Reposts are not shareable, but this
  // function is also used to describe a post in a DM, where they are.
  const artist = post.kind === 'repost' && post.originalAuthor ? post.originalAuthor : post.author;
  return {
    id: post.id,
    kind: post.kind,
    trackId: post.track.id,
    title: post.track.title,
    artistName: artist.displayName?.trim() || artist.username,
    coverArtUrl: post.track.coverArtUrl ?? post.track.thumbnailUrl,
  };
}

/** Uploads only — see the header. */
export function canSharePost(post: { kind: 'upload' | 'repost' }): boolean {
  return post.kind === 'upload';
}

/**
 * The OS share sheet with a link. Reaches WhatsApp, Telegram, Messages, Instagram DM —
 * anything installed. This is the path that always works, and the fallback for the
 * two below.
 */
export async function sharePostLink(post: ShareablePost): Promise<ShareOutcome> {
  const result = await Share.share({
    message: buildPostShareMessage(post.title, post.artistName, post.id),
  });
  return result.action === Share.sharedAction ? 'shared' : 'dismissed';
}

/**
 * Instagram Stories, with the rendered card as the story background.
 *
 * `fileUri` comes from `captureRef` on the offscreen `<StoryCard/>`; this function
 * deliberately does not know how the image was made, so the capture can be replaced
 * (or moved server-side) without touching the intent.
 *
 * EVERY FAILURE FALLS BACK TO THE PLAIN LINK, on purpose:
 *   * no Facebook App ID configured — Instagram rejects ADD_TO_STORY without one,
 *     so we do not even try rather than firing an intent we know will bounce;
 *   * Instagram not installed — the intent has no receiver;
 *   * the user cancelling inside Instagram — indistinguishable from a rejection at
 *     this layer, and offering the sheet is a better outcome than silence.
 * The caller gets 'fellback' so it can say what actually happened.
 */
export async function shareStoryCard(
  post: ShareablePost,
  fileUri: string,
): Promise<ShareOutcome> {
  if (!FACEBOOK_APP_ID) {
    await sharePostLink(post);
    return 'fellback';
  }

  try {
    await RNShare.shareSingle({
      social: Social.InstagramStories,
      appId: FACEBOOK_APP_ID,
      backgroundImage: fileUri,
      // The card fills the frame, so the surrounding gradient is only ever seen on a
      // device whose aspect ratio is taller than 9:16. Livil's deep-violet floor there
      // reads as intentional; Instagram's default white would read as a broken image.
      backgroundTopColor: '#0A0A0F',
      backgroundBottomColor: '#4C1D95',
      // The tappable link sticker Instagram attaches to the story.
      attributionURL: postShareUrl(post.id),
    });
    return 'shared';
  } catch {
    await sharePostLink(post);
    return 'fellback';
  }
}

/**
 * Share the card image itself through the normal sheet — the "save or send the card"
 * path for people who do not use Instagram, and the graceful landing spot when the
 * Story intent is unavailable but a card was successfully rendered.
 */
export async function shareCardImage(
  post: ShareablePost,
  fileUri: string,
): Promise<ShareOutcome> {
  try {
    await RNShare.open({
      url: fileUri,
      type: 'image/jpeg',
      message: buildPostShareMessage(post.title, post.artistName, post.id),
      failOnCancel: false,
    });
    return 'shared';
  } catch {
    await sharePostLink(post);
    return 'fellback';
  }
}

/**
 * Send the post as a `track_share` DM to one or more conversations.
 *
 * `messages.kind = 'track_share'` has existed since launch — declared in
 * `messages.ts`, rendered as a playable card in `ConversationScreen`, and wired into
 * push dispatch. Nothing had ever sent one. This is the sender; there is no schema
 * change and no new message type.
 *
 * NOT IDEMPOTENT, deliberately. Sending the same track to the same friend twice is a
 * thing people do, so there is no natural key to dedupe on and an idempotency key
 * would suppress a legitimate second send. The button disables itself while the send
 * is in flight, and that is the whole concurrency control a chat message needs.
 *
 * Sends are issued in parallel and settled individually: one friend's send failing
 * (a conversation left, a friendship removed between opening the sheet and tapping
 * send — `20260809030000` requires friendship for a DM write) must not silently drop
 * the other four. The caller gets the counts and decides what to say.
 */
export async function shareToConversations(
  post: ShareablePost,
  conversationIds: string[],
): Promise<{ sent: number; failed: number }> {
  const { data: userData } = await supabase.auth.getUser();
  const me = userData?.user?.id;

  // Sender info rides along so the recipient's realtime insert renders with a name and
  // avatar immediately instead of a blank row until the next fetch.
  let senderInfo: { username: string | null; displayName: string | null; avatarUrl: string | null } | undefined;
  if (me) {
    const { data } = await supabase
      .from('profiles')
      .select('username, display_name, avatar_url')
      .eq('id', me)
      .maybeSingle();
    if (data) {
      const row = data as { username: string; display_name: string | null; avatar_url: string | null };
      senderInfo = { username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url };
    }
  }

  const results = await Promise.allSettled(
    conversationIds.map(conversationId =>
      sendMessage(
        conversationId,
        {
          kind: 'track_share',
          metadata: {
            track_id: post.trackId,
            post_id: post.id,
            title: post.title,
            artist_name: post.artistName,
            cover_art_url: post.coverArtUrl,
          },
        },
        senderInfo,
      ),
    ),
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  return { sent, failed: results.length - sent };
}
