import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  Pressable,
  Platform,
  ScrollViewProps,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  KeyboardGestureArea,
  KeyboardController,
} from 'react-native-keyboard-controller';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon, type IconName } from '../../components/Icon';
import FormInput from '../../components/FormInput';
import { useRelationships } from '../../contexts/RelationshipContext';
import {
  fetchMessages,
  sendMessage,
  addReaction,
  removeReaction,
  type ChatMessage,
  type SendMessagePayload,
} from '../../services/messages';
import { messageCache } from '../../services/messageCache';
import { clearConversationNotifications } from '../../services/pushNotifications';
import { requestBadgeRefresh } from '../../services/appBadge';
import {
  setActiveConversation,
  getActiveConversation,
  onConversationPing,
} from '../../services/activeConversation';
import {
  markAsRead,
  getOtherMemberReadAt,
  getConversationKind,
  markConversationDelivered,
  type ConversationKind,
} from '../../services/conversations';
import { chatReceipts, type ReceiptStatus } from '../../utils/chatReceipts';
import NowPlayingPill from '../../components/NowPlayingPill';
import { useListeningNow } from '../../hooks/useListeningNow';
import {
  subscribeToConversation,
  unsubscribeFromConversation,
} from '../../services/jamRealtime';
import { createJamRoom, bulkAddToQueue, isJamRoomEnded } from '../../services/jamRooms';
import { usePlayback } from '../../contexts/PlaybackContext';
import { usePlayFullScreen } from '../../hooks/usePlayFullScreen';
import { useJam } from '../../contexts/JamContext';
import { useToast } from '../../contexts/ToastContext';
import { fetchPostById, feedPostToNowPlaying, isPlayableInLivil, type FeedPost } from '../../services/posts';
import { resolveSharedProfile, toShareablePost } from '../../services/share';
import { ProfileLinkCard } from '../../components/ProfileLinkCard';
import SpotifyChatCard from '../../components/SpotifyChatCard';
import ChatSongCard from '../../components/ChatSongCard';
import RepostChatCard from '../../components/RepostChatCard';
import { sharedRepostIdFrom } from '../../utils/repostShare';
import { ChatReplySnippet } from '../../components/ChatReplySnippet';
import { requestNotice } from '../../components/OnboardingNotice';
import ChatSongPicker, { MusicToggleIcon, type PickedSong } from '../../components/ChatSongPicker';
import { rememberSpotifyTrack, useSpotifyAvailability } from '../../services/spotify';
import { findSpotifyLinkInText, spotifyTrackUrl } from '../../utils/spotifyLinks';
import { haptics } from '../../utils/haptics';
import { seenMustWait } from '../../utils/seenWhileAway';
import { profileHandleIfExactLink } from '../../utils/shareLinks';
import { supabase } from '../../../lib/supabase';
import AddBadge from '../../components/AddBadge';
import UsernameBadges from '../../components/UsernameBadges';
import GroupAvatarCluster from '../../components/GroupAvatarCluster';
import { useGroupFaces } from '../../hooks/useGroupFaces';
import { Button } from '../../components/Button';
import { GradientBorder } from '../../components/GradientBorder';
import ChatTimeSeparator from '../../components/ChatTimeSeparator';
import SwipeRevealRow from '../../components/SwipeRevealRow';
import SwipeReplyRow from '../../components/SwipeReplyRow';
import { SwipeRevealProvider, SwipeRevealGestureView } from '../../contexts/SwipeRevealContext';
import { formatChatTimestamp, formatChatTimeOnly, sameChatRun, shouldShowTimeSeparator } from '../../utils/chatTime';
import { mergeNewestFirst, settlePending } from '../../utils/chatOrder';
import ChatGifPicker from '../../components/ChatGifPicker';
import CommentGifCard from '../../components/CommentGifCard';
import { MAX_GIF_QUERY_LENGTH, rememberGif, useGifsEnabled, type Gif } from '../../services/gifs';
import { GIF_LABEL } from '../../services/comments';
import { chatGifFrom, chatGifMetadata } from '../../utils/chatGif';
import {
  chatMediaFrom,
  chatMediaLabel,
  chatMediaLeftMs,
  chatMediaMetadata,
  formatLeft,
  randomUuid,
} from '../../utils/chatMedia';
import { serverNow } from '../../utils/serverClock';
import { getMyUserId } from '../../services/session';
import {
  fetchChatMediaSavers,
  localChatMedia,
  prefetchChatMedia,
  queueChatMediaPrefetch,
  sendChatMedia,
  subscribeChatMediaSaves,
  useChatMediaEnabled,
  type ChatMediaSaver,
  type PickedChatMedia,
} from '../../services/chatMedia';
import { cleanPickedFile, pickChatPhoto } from '../../services/mediaPicks';
import { ChatMediaBubbleContent, ChatMediaSavedBy, useChatMediaLeft } from '../../components/ChatMediaBubble';
import ChatMediaSourceSheet, { type ChatMediaSource } from '../../components/ChatMediaSourceSheet';
import ChatMediaPreview from '../../components/ChatMediaPreview';
import { useRunAfterDismiss } from '../../hooks/useRunAfterDismiss';
import { copyText } from '../../services/clipboard';
import { copyableText } from '../../utils/chatCopy';
import { splitChatLinks, type CheckedLink } from '../../utils/chatLinks';
import { openLivilLink } from '../../services/livilLinks';
import ConfirmActionModal from '../../components/ConfirmActionModal';
const db = supabase as any;

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Conversation'>;

const QUICK_REACTIONS = ['❤️', '😂', '🔥', '😮', '😢', '👏'];
const MAX_CHARS = 250;

/** How many characters from the cap the countdown starts showing. */
const COUNTER_VISIBLE_FROM = 50;

/**
 * Second ceiling alongside MAX_CHARS. A message can sit inside the character
 * budget and still be almost entirely newlines, rendering as a bubble tall
 * enough to push the whole conversation off-screen, so line count is capped
 * independently.
 *
 * Both ceilings clamp rather than reject, matching how MAX_CHARS already behaves.
 * Note this is a composer-side guard only — `messages.body` has no equivalent
 * constraint in Postgres, so it shapes what this app sends, not what it can
 * receive.
 */
const MAX_LINES = 10;

function clampComposerInput(raw: string): string {
  const byChars = raw.slice(0, MAX_CHARS);
  const lines = byChars.split('\n');
  return lines.length <= MAX_LINES ? byChars : lines.slice(0, MAX_LINES).join('\n');
}

const MORE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😊','😇','🥰',
  '😍','🤩','😘','😗','😙','😚','🙂','🤗','🤭','🫡',
  '🤔','🫠','🤐','🤨','😐','😑','😶','😏','😒','🙄',
  '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕',
  '🥳','🤯','😤','😠','😡','🤬','😈','👿','💀','💩',
  '👋','🤚','🖐','✋','🤙','👍','👎','✊','🤜','👏',
  '🙌','🤲','🙏','💪','🫶','❤️','🧡','💛','💚','💙',
  '💜','🖤','🤍','💔','❤️‍🔥','✨','💫','⭐','🌟','🎉',
  '🎊','🎶','🎵','🔥','💯','✅','❌','⚡','💥','🌈',
];


function JamInviteBubble({
  msg,
  conversationId,
  title,
}: {
  msg: ChatMessage;
  conversationId: string;
  title: string;
}) {
  const navigation = useNavigation<Nav>();
  const { activeJam, setActiveJam } = useJam();
  const jamRoomId = msg.metadata?.jam_room_id as string | undefined;
  const [ended, setEnded] = useState(false);

  // Re-check ended status on mount AND whenever activeJam changes (e.g. host
  // ends the jam → activeJam becomes null → we re-query the DB).
  useEffect(() => {
    if (!jamRoomId) { return; }
    let cancelled = false;
    isJamRoomEnded(jamRoomId).then(v => { if (!cancelled) { setEnded(v); } });
    return () => { cancelled = true; };
  }, [jamRoomId, activeJam]);

  if (!jamRoomId) { return null; }
  const handleJoin = () => {
    if (ended) { return; }
    // Mark this jam active before navigating so the global JamRealtimeProvider
    // can subscribe + start receiving the host's playback even before
    // JamRoomScreen mounts.
    setActiveJam({ jamRoomId, conversationId, conversationTitle: title });
    navigation.navigate('JamRoom', { jamRoomId, conversationId });
  };
  return (
    <View style={[styles.jamInviteCard, ended && styles.jamInviteCardEnded]}>
      <Icon name="musicNote" size={22} color={COLORS.purpleLight} />
      <View style={styles.jamInviteInfo}>
        <Text style={styles.jamInviteTitle}>
          {ended ? 'Jam Room ended' : 'Jam Room started'}
        </Text>
        <Text style={styles.jamInviteSub}>
          {ended ? 'This session is no longer active' : 'Tap to join the listening session'}
        </Text>
      </View>
      {ended ? (
        <View style={styles.jamInviteBtnEnded}>
          <Text style={styles.jamInviteBtnEndedText}>Ended</Text>
        </View>
      ) : (
        <Button label="Join" onPress={handleJoin} variant="primary" size="sm" />
      )}
    </View>
  );
}

/** Same savers for the same messages: a lookup that changed nothing must not re-render the list. */
function sameSavers(a: Record<string, ChatMediaSaver[]>, b: Record<string, ChatMediaSaver[]>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) { return false; }
  return keys.every(k => {
    const x = a[k];
    const y = b[k];
    return !!y && x.length === y.length && x.every((s, i) => s.userId === y[i].userId);
  });
}

const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  seen: 'Seen',
  delivered: 'Delivered',
  sent: 'Sent',
  sending: 'Sending…',
};

/** A GIF in a chat bubble: a little larger than in a comment. */
const CHAT_GIF_MAX_W = 220;
const CHAT_GIF_MAX_H = 260;

function MessageBubble({
  msg,
  isMe,
  conversationId,
  conversationTitle,
  repliedTo,
  isHighlighted,
  onReply,
  onReplyQuotePress,
  onLongPress,
  onReactionToggle,
  onPlaySharedPost,
  onRepostSharedPost,
  onOpenSharedProfile,
  onOpenSharedRepost,
  onOpenReposterProfile,
  mediaSavers,
  mediaLoading,
  onOpenChatMedia,
  onOpenLink,
  onCopyLink,
  showName,
  showAvatar,
}: {
  msg: ChatMessage;
  isMe: boolean;
  /** First bubble of this person's run: their name above it. */
  showName: boolean;
  /** Last bubble of this person's run: their photo beside it (a same-width gap otherwise). */
  showAvatar: boolean;
  conversationId: string;
  conversationTitle: string;
  repliedTo: ChatMessage | null;
  isHighlighted: boolean;
  /** Who saved this message's disappearing photo/video to their phone (PROP-0011). */
  mediaSavers: ChatMediaSaver[] | undefined;
  /** Tapped while still downloading: the bubble shows a spinner until it opens. */
  mediaLoading: boolean;
  /** `origin`: where the bubble was tapped, in window coordinates — the photo grows from there. */
  onOpenChatMedia: (msg: ChatMessage, origin: { x: number; y: number }) => void;
  onReply: () => void;
  onReplyQuotePress: (originalId: string) => void;
  onLongPress: (msg: ChatMessage) => void;
  onReactionToggle: (msg: ChatMessage, emoji: string) => void;
  onPlaySharedPost: (postId: string) => void;
  onRepostSharedPost: (postId: string) => void;
  onOpenSharedProfile: (username: string) => void;
  onOpenSharedRepost: (postId: string) => void;
  /** A friends-only repost the viewer may not see opens its reposter's profile instead. */
  onOpenReposterProfile: (userId: string) => void;
  /** A link in the text, tapped (already checked: utils/chatLinks.ts). */
  onOpenLink: (link: CheckedLink) => void;
  /** A link in the text, long-pressed: its text goes on the clipboard. */
  onCopyLink: (text: string) => void;
}) {
  const hasStickerMeta = msg.kind === 'sticker' && !!msg.metadata?.sticker_url;
  // A GIF is a text message carrying the GIF in metadata (src/utils/chatGif.ts); its body is
  // '🎞 GIF', what older builds show, so the text is hidden here.
  const chatGif = msg.kind === 'text' ? chatGifFrom(msg.metadata) : null;
  // A disappearing photo/video (PROP-0011, src/utils/chatMedia.ts): a text message whose metadata
  // names the file; its body is the upgrade line older builds show, so the text is hidden.
  // Sender and recipients open it alike, only while it exists — an expired one does nothing.
  const chatMedia = msg.kind === 'text' ? chatMediaFrom(msg.metadata) : null;
  const mediaLeftMs = useChatMediaLeft(chatMedia ? msg.createdAt : null);
  const mediaExpired = chatMedia !== null && (mediaLeftMs ?? 0) <= 0;
  const canOpenMedia = chatMedia !== null && !mediaExpired && !msg.id.startsWith('opt-');
  const hasTrackMeta = msg.kind === 'track_share' && !!msg.metadata;
  /**
   * A shared track opens the post. `track_share` bubbles rendered cover art and a title
   * from the day the message kind was declared, but nothing ever SENT one — so the
   * absence of a tap handler was invisible until sharing shipped and every shared song
   * arrived as a picture you could not play.
   *
   * `post_id` is optional in the metadata contract (older senders could omit it), so an
   * unopenable card must still render rather than crash — hence the guard rather than an
   * assertion.
   */
  const sharedPostId = hasTrackMeta ? (msg.metadata!.post_id as string | undefined) : undefined;
  /**
   * A shared profile is a TEXT message whose body is exactly a profile link — sent that
   * way so builds without this card still show a readable link. Only an exact match
   * becomes a card (see profileHandleIfExactLink): a link with anything else around or
   * after it stays text, so nobody's words are hidden behind a card.
   */
  const sharedProfileHandle =
    msg.kind === 'text' && msg.body ? profileHandleIfExactLink(msg.body) : null;
  const isJamInvite = msg.kind === 'jam_invite' && !!msg.metadata?.jam_room_id;
  const isSystem = msg.kind === 'system';
  // A Spotify song link inside a text message is drawn as a card. A DIRECT link is then
  // dropped from the text (the card carries it); a short link stays in the text until the
  // card has resolved it, because it might not be a song at all.
  const spotifyLink = msg.kind === 'text' && msg.body && !chatGif ? findSpotifyLinkInText(msg.body) : null;
  const isSongBubble = hasTrackMeta || !!spotifyLink;
  // A song sent from a REPOST (src/utils/repostShare.ts) is drawn as that repost and opens
  // it; the song card underneath is only its fallback. Read off song bubbles only, so a
  // stray key on any other message is ignored.
  const sharedRepostId = isSongBubble ? sharedRepostIdFrom(msg.metadata) : null;
  const visibleText = chatGif || chatMedia
    ? null
    : spotifyLink?.id && msg.body
      ? msg.body.replace(spotifyLink.match, '').trim()
      : msg.body;
  // Links in the words: underlined, tap to open, long-press to copy. Only http(s) that pass
  // checkChatLink become links; anything else stays plain text (utils/chatLinks.ts).
  const textParts = useMemo(() => (visibleText ? splitChatLinks(visibleText) : null), [visibleText]);
  const hasLinks = !!textParts && textParts.some(p => p.link);

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{msg.body}</Text>
      </View>
    );
  }

  if (isJamInvite) {
    return (
      <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
        <JamInviteBubble msg={msg} conversationId={conversationId} title={conversationTitle} />
      </View>
    );
  }
  const hasReactions = msg.reactions.length > 0;

  return (
    <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
      {!isMe && !showAvatar && <View style={styles.senderAvatarGap} />}
      {!isMe && showAvatar && (
        <View style={styles.senderAvatarWrap}>
          {msg.senderAvatarUrl ? (
            <Image source={{ uri: msg.senderAvatarUrl }} style={styles.senderAvatar} />
          ) : (
            <View style={styles.senderAvatarPlaceholder}>
              <Text style={styles.senderAvatarText}>
                {(msg.senderDisplayName || msg.senderUsername || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.bubbleColumn, isMe && styles.bubbleColumnMe]}>
        {!isMe && showName && (
          <View style={styles.senderNameRow}>
            <Text style={styles.senderName}>
              {msg.senderDisplayName || msg.senderUsername}
            </Text>
            {/* 12, not 11 to match senderName: below about 12 the seal's scallops merge
                into the glyph and both badges read as the same grey dot. */}
            {msg.senderId ? <UsernameBadges userId={msg.senderId} size={12} /> : null}
            {msg.senderId ? <AddBadge userId={msg.senderId} size="sm" /> : null}
          </View>
        )}

        {/* Wrapper gives us the anchor point for the absolutely-positioned reaction strip */}
        <SwipeReplyRow onReply={onReply}>
        <View style={[styles.bubbleWrapper, hasReactions && styles.bubbleWrapperWithReactions]}>
          <Pressable
            onLongPress={() => onLongPress(msg)}
            onPress={
              chatMedia
                ? (canOpenMedia
                  ? (e: GestureResponderEvent) => onOpenChatMedia(msg, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })
                  : undefined)
              // A repost card handles its own taps — and when it falls back to the plain song
              // card, that card's artwork plays. The bubble's 8px rim does nothing.
              : sharedRepostId
                ? undefined
                : sharedPostId
                ? () => onPlaySharedPost(sharedPostId)
                : sharedProfileHandle
                  ? () => onOpenSharedProfile(sharedProfileHandle)
                  : undefined
            }
            // A song card has its own Play / Repost buttons. A Pressable is one accessibility
            // element by default, which folds those into the bubble so VoiceOver/TalkBack
            // can't reach them. Off for song bubbles; touch long-press is unaffected, and
            // the card's buttons carry the long-press too.
            accessible={isSongBubble ? false : undefined}
            accessibilityRole={(sharedPostId && !sharedRepostId) || sharedProfileHandle || canOpenMedia ? 'button' : undefined}
            accessibilityLabel={
              chatMedia
                ? (mediaExpired
                  ? `${chatMedia.type === 'video' ? 'Video' : 'Photo'}, expired`
                  : `${chatMedia.type === 'video' ? 'Video' : 'Photo'}, ${formatLeft(mediaLeftMs ?? 0)} left`)
              : sharedRepostId
                ? undefined
                : sharedPostId
                ? `Play ${msg.metadata!.title as string}`
                : sharedProfileHandle
                  ? `View @${sharedProfileHandle}'s profile`
                  : chatGif
                    ? 'GIF'
                    : undefined
            }
            style={[
              styles.bubble,
              isSongBubble ? styles.bubbleSong : isMe ? styles.bubbleMe : styles.bubbleThem,
              hasStickerMeta || chatGif ? styles.bubbleSticker : null,
              sharedProfileHandle ? styles.bubbleProfileCard : null,
              chatMedia
                ? (mediaExpired ? styles.bubbleMediaExpired : isMe ? styles.bubbleMedia : styles.bubbleMediaThem)
                : null,
              isHighlighted && styles.bubbleHighlighted,
            ]}
          >
            {/* Song cards (Livil or Spotify, ADR-0027) and profile cards wear Livil's glow
                outline instead of a bubble fill — on either side of the chat — so they read
                as cards, not as purple slabs around artwork. */}
            {isSongBubble || sharedProfileHandle ? <GradientBorder borderRadius={PROFILE_CARD_RADIUS} /> : null}
            {msg.replyToId && (
              <Pressable
                onPress={() => msg.replyToId && onReplyQuotePress(msg.replyToId)}
                style={[styles.replyQuote, isMe ? styles.replyQuoteMe : styles.replyQuoteThem]}
              >
                <Text
                  style={[styles.replyQuoteAuthor, isMe ? styles.replyQuoteAuthorMe : styles.replyQuoteAuthorThem]}
                  numberOfLines={1}
                >
                  {repliedTo
                    ? (repliedTo.senderDisplayName || repliedTo.senderUsername || 'Unknown')
                    : 'Original message'}
                </Text>
                {/* A song (Livil or Spotify) quotes as a small song row, not its raw link. */}
                <ChatReplySnippet message={repliedTo} tone={isMe ? 'me' : 'them'} />
              </Pressable>
            )}

            {msg.kind === 'text' && sharedProfileHandle ? (
              <ProfileLinkCard
                username={sharedProfileHandle}
                onOpen={() => onOpenSharedProfile(sharedProfileHandle)}
              />
            ) : msg.kind === 'text' && visibleText ? (
              <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : null]}>
                {hasLinks
                  ? textParts!.map((part, i) => (part.link ? (
                    <Text
                      key={i}
                      style={[styles.linkText, isMe ? styles.linkTextMe : styles.linkTextThem]}
                      onPress={() => onOpenLink(part.link!)}
                      onLongPress={() => onCopyLink(part.text)}
                      accessibilityRole="link"
                      accessibilityHint={`Opens ${part.link.host}. Long-press to copy.`}
                    >
                      {part.text}
                    </Text>
                  ) : part.text))
                  : visibleText}
              </Text>
            ) : null}

            {/* A Spotify song link in the text becomes a card (ADR-0027). Still a plain
                text message underneath — older apps keep showing the raw link. */}
            {spotifyLink ? (
              sharedRepostId ? (
                <RepostChatCard
                  repostPostId={sharedRepostId}
                  messageId={msg.id}
                  onOpen={onOpenSharedRepost}
                  onOpenProfile={onOpenReposterProfile}
                  onLongPress={() => onLongPress(msg)}
                  fallback={
                    <SpotifyChatCard
                      spotifyTrackId={spotifyLink.id}
                      shortUrl={spotifyLink.shortUrl}
                      onLongPress={() => onLongPress(msg)}
                    />
                  }
                />
              ) : (
                <SpotifyChatCard
                  spotifyTrackId={spotifyLink.id}
                  shortUrl={spotifyLink.shortUrl}
                  onLongPress={() => onLongPress(msg)}
                />
              )
            ) : null}

            {chatGif ? (
              <CommentGifCard
                gif={chatGif}
                maxWidth={CHAT_GIF_MAX_W}
                maxHeight={CHAT_GIF_MAX_H}
                style={styles.chatGif}
              />
            ) : null}

            {chatMedia ? (
              <ChatMediaBubbleContent media={chatMedia} isMe={isMe} leftMs={mediaLeftMs ?? 0} loading={mediaLoading} />
            ) : null}

            {hasStickerMeta && (
              <Image
                source={{ uri: msg.metadata!.sticker_url as string }}
                style={styles.stickerImg}
                resizeMode="contain"
              />
            )}

            {/* A shared Livil song. Same card as a Spotify song (ChatSongCard) so the two read
                as one kind of thing; "Play on Livil" plays it here, Repost opens the usual
                Repost screen. An older card without a post_id still renders, unplayable. */}
            {hasTrackMeta && (() => {
              const songCard = (
                <ChatSongCard
                  source="livil"
                  title={(msg.metadata!.title as string | undefined) ?? null}
                  artist={(msg.metadata!.artist_name as string | undefined) ?? null}
                  artUrl={(msg.metadata!.cover_art_url as string | null | undefined) ?? null}
                  onPlay={sharedPostId ? () => onPlaySharedPost(sharedPostId) : undefined}
                  onRepost={sharedPostId ? () => onRepostSharedPost(sharedPostId) : undefined}
                  onLongPress={() => onLongPress(msg)}
                />
              );
              return sharedRepostId ? (
                <RepostChatCard
                  repostPostId={sharedRepostId}
                  messageId={msg.id}
                  onOpen={onOpenSharedRepost}
                  onOpenProfile={onOpenReposterProfile}
                  onLongPress={() => onLongPress(msg)}
                  fallback={songCard}
                />
              ) : songCard;
            })()}
          </Pressable>

          {hasReactions && (
            <View style={[styles.reactionOverlay, isMe ? styles.reactionOverlayMe : styles.reactionOverlayThem]}>
              {msg.reactions.map(r => (
                <TouchableOpacity
                  key={r.emoji}
                  style={[styles.reactionChip, r.reactedByMe && styles.reactionChipActive]}
                  activeOpacity={0.7}
                  onPress={() => onReactionToggle(msg, r.emoji)}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  {r.count > 1 && <Text style={styles.reactionCount}>{r.count}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {chatMedia && mediaSavers ? <ChatMediaSavedBy savers={mediaSavers} alignEnd={isMe} /> : null}
        </SwipeReplyRow>
      </View>
    </View>
  );
}

/** A row under the reactions in the long-press menu (Copy, …). */
type MessageMenuAction = {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
};

/**
 * The long-press menu: quick reactions on top (the "+" opens every emoji), then what can be
 * done with the message — `actions`, built for the pressed message by the screen.
 */
function MessageMenu({
  visible,
  onPick,
  onClose,
  actions,
}: {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
  actions: MessageMenuAction[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (!visible) { return null; }

  return (
    <Pressable style={styles.reactionPickerOverlay} onPress={onClose}>
      <View style={styles.reactionPickerCard}>
        {/* Quick row */}
        <View style={styles.reactionPickerRow}>
          {QUICK_REACTIONS.map(emoji => (
            <TouchableOpacity
              key={emoji}
              style={styles.reactionPickerBtn}
              activeOpacity={0.7}
              onPress={() => onPick(emoji)}
            >
              <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.reactionPickerBtn, styles.reactionPickerMoreBtn, expanded && styles.reactionPickerMoreBtnActive]}
            activeOpacity={0.7}
            onPress={() => setExpanded(e => !e)}
          >
            <Text style={styles.reactionPickerMoreIcon}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Expanded emoji grid */}
        {expanded && (
          <View style={styles.emojiGrid}>
            {MORE_EMOJIS.map((emoji, i) => (
              <TouchableOpacity
                key={`${emoji}-${i}`}
                style={styles.emojiGridBtn}
                activeOpacity={0.7}
                onPress={() => onPick(emoji)}
              >
                <Text style={styles.emojiGridEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* What can be done with the message. Hidden while the full emoji grid is open, so
            the card never outgrows a small screen. */}
        {!expanded && actions.length > 0 ? (
          <View style={styles.menuActions}>
            {actions.map(a => (
              <Pressable
                key={a.key}
                onPress={a.onPress}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={({ pressed }) => [styles.menuAction, pressed && styles.menuActionPressed]}
              >
                <Icon name={a.icon} size={20} color={a.destructive ? COLORS.error : COLORS.white} />
                <Text style={[styles.menuActionLabel, a.destructive && styles.menuActionLabelDanger]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * How long to wait before the single retry of a failed first-page load.
 *
 * Opening a chat from a notification tap fires the load in the first instant
 * after iOS resumes the app, before its network connections are usable again;
 * that request fails with "Network request failed". Without a retry the screen
 * kept showing the cached (older) page until the chat was reopened.
 */
const FIRST_PAGE_RETRY_MS = 1000;

/** First page of messages, retried once if the request fails. */
async function fetchFirstPageWithRetry(
  conversationId: string,
): Promise<Awaited<ReturnType<typeof fetchMessages>>> {
  try {
    return await fetchMessages(conversationId);
  } catch {
    await new Promise<void>(resolve => setTimeout(resolve, FIRST_PAGE_RETRY_MS));
    return fetchMessages(conversationId);
  }
}

/**
 * Save the read marker, THEN have Home re-count the icon badge. Reading here is
 * what changes the unread total, and Home cannot see it happen; a user who
 * leaves the app from this screen would otherwise keep the old number.
 */
async function markReadAndRefreshBadge(conversationId: string): Promise<void> {
  try {
    await markAsRead(conversationId);
  } catch {
    // markAsRead is best-effort; re-count anyway, it is harmless.
  }
  requestBadgeRefresh();
}

/** What a chat row can do. One stable object per chat (rowActions), so it never breaks MessageRow's memo. */
type RowActions = {
  onReply: (msg: ChatMessage) => void;
  onReplyQuotePress: (originalId: string) => void;
  onLongPress: (msg: ChatMessage) => void;
  onReactionToggle: (msg: ChatMessage, emoji: string) => void;
  onPlaySharedPost: (postId: string) => void;
  onRepostSharedPost: (postId: string) => void;
  onOpenSharedProfile: (username: string) => void;
  onOpenSharedRepost: (postId: string) => void;
  onOpenReposterProfile: (userId: string) => void;
  onOpenChatMedia: (msg: ChatMessage, origin: { x: number; y: number }) => void;
  onOpenLink: (link: CheckedLink) => void;
  onCopyLink: (text: string) => void;
};

type MessageRowProps = {
  item: ChatMessage;
  isMe: boolean;
  showSep: boolean;
  showName: boolean;
  showAvatar: boolean;
  conversationId: string;
  conversationTitle: string;
  repliedTo: ChatMessage | null;
  isHighlighted: boolean;
  /** A DM's Sending / Sent / Delivered / Seen, on the one message each applies to (utils/chatReceipts.ts). */
  readStatus: ReceiptStatus | null;
  mediaSavers: ChatMediaSaver[] | undefined;
  mediaLoading: boolean;
  actions: RowActions;
};

/**
 * One chat row: time separator, swipe-to-see-time, the bubble, the read status. Memoised,
 * so a change to the list re-renders only the rows it touches. Without it, every new page,
 * message or status re-rendered every bubble (with its gestures and animated styles): on the
 * owner's Android test phone that held the JS thread for ~3 s after a chat's messages had
 * already arrived, so the newest message showed seconds late (CPU profile, 2026-11-03).
 */
const MessageRow = React.memo(function ChatRow({
  item,
  isMe,
  showSep,
  showName,
  showAvatar,
  conversationId,
  conversationTitle,
  repliedTo,
  isHighlighted,
  readStatus,
  mediaSavers,
  mediaLoading,
  actions,
}: MessageRowProps) {
  return (
    <>
      {showSep ? <ChatTimeSeparator label={formatChatTimestamp(item.createdAt)} /> : null}
      <SwipeRevealRow timestamp={formatChatTimeOnly(item.createdAt)}>
        <MessageBubble
          msg={item}
          isMe={isMe}
          // A run of one person's bubbles: name on the first, photo beside the last.
          showName={showName}
          showAvatar={showAvatar}
          conversationId={conversationId}
          conversationTitle={conversationTitle}
          repliedTo={repliedTo}
          isHighlighted={isHighlighted}
          onReply={() => actions.onReply(item)}
          onReplyQuotePress={actions.onReplyQuotePress}
          onLongPress={actions.onLongPress}
          onReactionToggle={actions.onReactionToggle}
          onPlaySharedPost={actions.onPlaySharedPost}
          onRepostSharedPost={actions.onRepostSharedPost}
          onOpenSharedProfile={actions.onOpenSharedProfile}
          onOpenSharedRepost={actions.onOpenSharedRepost}
          onOpenReposterProfile={actions.onOpenReposterProfile}
          mediaSavers={mediaSavers}
          mediaLoading={mediaLoading}
          onOpenChatMedia={actions.onOpenChatMedia}
          onOpenLink={actions.onOpenLink}
          onCopyLink={actions.onCopyLink}
        />
        {readStatus ? (
          <Text style={styles.readStatus}>
            {RECEIPT_LABEL[readStatus]}
          </Text>
        ) : null}
      </SwipeRevealRow>
    </>
  );
}, sameRow);

/**
 * MessageRow's memo test. A refetch hands back NEW objects for unchanged messages, so the
 * message (and the one it replies to) is compared by what a bubble shows, everything else
 * by identity.
 */
function sameRow(a: MessageRowProps, b: MessageRowProps): boolean {
  return (
    sameMessage(a.item, b.item)
    && (a.repliedTo === b.repliedTo || (!!a.repliedTo && !!b.repliedTo && sameMessage(a.repliedTo, b.repliedTo)))
    && a.isMe === b.isMe
    && a.showSep === b.showSep
    && a.showName === b.showName
    && a.showAvatar === b.showAvatar
    && a.conversationId === b.conversationId
    && a.conversationTitle === b.conversationTitle
    && a.isHighlighted === b.isHighlighted
    && a.readStatus === b.readStatus
    && a.mediaSavers === b.mediaSavers
    && a.mediaLoading === b.mediaLoading
    && a.actions === b.actions
  );
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  if (a === b) { return true; }
  return (
    a.id === b.id
    && a.kind === b.kind
    && a.body === b.body
    && a.createdAt === b.createdAt
    && a.deletedAt === b.deletedAt
    && a.replyToId === b.replyToId
    && a.senderId === b.senderId
    && a.senderUsername === b.senderUsername
    && a.senderDisplayName === b.senderDisplayName
    && a.senderAvatarUrl === b.senderAvatarUrl
    && JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
    && a.reactions.length === b.reactions.length
    && a.reactions.every((r, i) => {
      const o = b.reactions[i];
      return r.emoji === o.emoji && r.count === o.count && r.reactedByMe === o.reactedByMe
        && r.users.join() === o.users.join();
    })
  );
}

export default function ConversationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { conversationId, title, kind: kindParam } = route.params;
  // Opened from a notification on Android, the chat arrives without its kind
  // (handleNotificationPress drops the push's own `kind`, which is not the chat's): look
  // it up. Every in-app route passes it, so this never runs for them.
  const [fetchedKind, setFetchedKind] = useState<{ id: string; kind: ConversationKind } | null>(null);
  const kind = kindParam ?? (fetchedKind?.id === conversationId ? fetchedKind.kind : undefined);
  useEffect(() => {
    if (kindParam) { return; }
    let cancelled = false;
    void getConversationKind(conversationId).then(k => {
      if (!cancelled && k) { setFetchedKind({ id: conversationId, kind: k }); }
    });
    return () => { cancelled = true; };
  }, [conversationId, kindParam]);
  const isGroup = kind === 'group';

  const { nowPlaying, queueRef, activePostId, handlersRef, requestPlay, setNowPlaying, markSeekTarget } =
    usePlayback();
  const openFullScreen = usePlayFullScreen();
  const { activeJam, setActiveJam } = useJam();
  const { showToast } = useToast();
  const [startingJam, setStartingJam] = useState(false);
  const insets = useSafeAreaInsets();

  // Leaving the screen must take the keyboard with it.
  //
  // On Android the IME hides on its own when the focused TextInput is torn down.
  // iOS does not: UIKit keeps the keyboard up across a pop while the composer is
  // still mounted behind the transition (KeyboardStickyView keeps it alive), so
  // the user lands back on the conversation list with a keyboard covering half of
  // it and nothing focused to dismiss it.
  //
  // Hooked to `beforeRemove` rather than the back button's onPress so every exit
  // path is covered by one handler: the header button, the iOS interactive
  // swipe-back, and the Android hardware back. We never block removal here, only
  // dismiss.
  //
  // `beforeRemove` alone is too late for the iOS swipe-back, though: native-stack
  // only dispatches the pop (and so `beforeRemove`) from `onDismissed`, after the
  // screen has left the window. The composer carries KeyboardGestureArea's
  // invisible accessory view, whose resign keyboard-controller postpones by a
  // frame; on iOS 26+ UIKit resigns only as it detaches the screen, so the
  // postponed resign lands on a detached view and fails. Fabric then recycles
  // that still-focused text view into the next conversation, where a tap never
  // reaches `becomeFirstResponder`: only the Paste/AutoFill callout appears and
  // the keyboard opens on the SECOND tap (keyboard-controller #1675, fixed
  // natively by #1678 in a later release). Resigning when the screen starts to
  // disappear (`transitionStart` with `closing`, from `onWillDisappear`) does it
  // while the input is still in the window. It also covers a screen pushed on
  // top of the chat, which detaches the composer the same way.
  //
  // iOS only. The bug is UIKit's, and on Android the extra dismiss broke the
  // open chat: after a send (and sometimes mid-typing) the composer dropped
  // behind a keyboard that stayed up, and typing went nowhere until the
  // keyboard was closed and the field tapped again.
  useEffect(() => {
    const unsubRemove = navigation.addListener('beforeRemove', () => { KeyboardController.dismiss(); });
    if (Platform.OS !== 'ios') return unsubRemove;
    const unsubTransition = navigation.addListener('transitionStart', e => {
      if (e.data.closing) KeyboardController.dismiss();
    });
    return () => {
      unsubRemove();
      unsubTransition();
    };
  }, [navigation]);

  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  // The keyboard's space below the newest message, as KeyboardChatScrollView
  // applies it: a content inset on the inverted list's top edge (= its visual
  // bottom), on both platforms. While it is non-zero the list's resting
  // "showing the latest" position is offset -inset, not 0.
  const keyboardInsetRef = useRef(0);
  const onContentInsetChange = useCallback((i: { top?: number }) => {
    keyboardInsetRef.current = i.top ?? 0;
  }, []);

  // Return to where the newest message rests when the chat is opened: 200pt of
  // `paddingTop` (visual bottom) above the composer, lifted by the keyboard.
  //
  // NOT scrollToIndex({ index: 0 }). Index 0's measured offset includes that
  // 200pt padding, so it scrolled 200pt PAST the resting position — the
  // newest bubble landed on the list's bottom edge, behind the composer and
  // keyboard. Short threads hid it only "sometimes": they cannot scroll that
  // far, so the jump clamped early.
  const scrollToLatest = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: -keyboardInsetRef.current, animated: true });
  }, []);


  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Read by refreshLatest to decide, synchronously, whether a catch-up found
  // anything new (a setMessages updater runs later, at render).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  // 🎵 song search in the composer (ADR-0027). Its own query, so a half-typed message is
  // still there when you come back from picking a song.
  const [songMode, setSongMode] = useState(false);
  const [songQuery, setSongQuery] = useState('');
  // GIF search in the composer, the same way (owner, 2026-10-19). Shown only while the gifs
  // function answers `enabled`.
  const gifsOn = useGifsEnabled();
  // Disappearing photos and videos (PROP-0011): the camera button, its sheet, the picked photo
  // waiting in the preview, and who saved what.
  const chatMediaOn = useChatMediaEnabled();
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ media: PickedChatMedia; source: ChatMediaSource } | null>(null);
  const [mediaSavers, setMediaSavers] = useState<Record<string, ChatMediaSaver[]>>({});
  /** The first page came back from the network (or failed): photo downloads may start. */
  const [firstPageIn, setFirstPageIn] = useState(false);
  const { runAfterDismiss: runAfterMediaSheet, onDismiss: onMediaSheetDismiss } = useRunAfterDismiss();
  const [gifMode, setGifMode] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const searchMode = songMode || gifMode;
  const [composerHeight, setComposerHeight] = useState(64);
  const { search: spotifySearchOn } = useSpotifyAvailability();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [myProfile, setMyProfile] = useState<{ username: string | null; displayName: string | null; avatarUrl: string | null }>({ username: null, displayName: null, avatarUrl: null });
  const myProfileRef = useRef(myProfile);
  myProfileRef.current = myProfile;
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherUserAvatarUrl, setOtherUserAvatarUrl] = useState<string | null>(null);
  // Groups: the members ARE the picture. One random arrangement per visit to this
  // screen; faces reorder live as messages arrive (useGroupFaces).
  const [groupVisitSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const groupFaceIds = useMemo(() => (isGroup ? [conversationId] : []), [isGroup, conversationId]);
  const groupFaces = useGroupFaces(groupFaceIds).get(conversationId);
  const rel = useRelationships();

  /**
   * Why the composer may be unavailable, or null when it is fine.
   *
   * MIRRORS `can_write_to_conversation` (20260809030000) — it does not create
   * the rule. The server refuses these sends either way; without this the user
   * types a whole message, hits send, and gets "Couldn't send message. Please
   * try again." — advice that cannot work, for a reason never stated.
   *
   * DMs only. A group is authorized by membership, so friendship between every
   * pair would break every group containing two strangers.
   */
  const sendBlock = useMemo<null | 'blocked' | 'not-friends'>(() => {
    if (kind !== 'dm' || !otherUserId) { return null; }
    const status = rel.status(otherUserId);
    if (status === 'blocked') { return 'blocked'; }
    if (status === 'friend' || status === 'me') { return null; }
    return 'not-friends';
  }, [kind, otherUserId, rel]);
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // When the user taps a reply quote we scroll to the original and pulse it
  // for ~1.5s. Cleared by the timer or by a fresh tap.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The other DM participant's last_read_at and last_delivered_at — how far they have read,
  // and how far their app has received (utils/chatReceipts.ts). Null until fetched; the
  // delivered stamp stays null when their app never writes it (an old build) or the
  // migration is not applied, and the receipts then fall back to today's "Delivered".
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [otherDeliveredAt, setOtherDeliveredAt] = useState<string | null>(null);

  // Memoised lookup so MessageBubble can render the quoted-context strip for
  // any message whose `replyToId` resolves into the loaded list. Falls back
  // gracefully — if the original is missing (e.g. loaded later via pagination),
  // the bubble just shows a generic "Replied to a message" caption.
  const messagesById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) { map.set(m.id, m); }
    return map;
  }, [messages]);

  // Seen under my last message they have read, Delivered under my last one that reached
  // their phone, Sent / Sending… under my newest when it is neither — DMs only (a group has
  // no single reader). Message id → label.
  const receipts = useMemo<Map<string, ReceiptStatus>>(
    () => (kind === 'dm' ? chatReceipts(messages, myId, otherReadAt, otherDeliveredAt) : new Map()),
    [kind, messages, myId, otherReadAt, otherDeliveredAt],
  );

  const handleReplyQuotePress = useCallback((originalId: string) => {
    const idx = messages.findIndex(m => m.id === originalId);
    if (idx < 0) {
      // Original isn't in the loaded window — surface a toast and bail.
      showToast("Original message isn't loaded yet — scroll up to find it.", { kind: 'info' });
      return;
    }
    flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
    setHighlightedMessageId(originalId);
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1500);
  }, [messages, showToast]);

  useEffect(() => () => {
    // On unmount, clear any pending highlight timer.
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); }
  }, []);

  // Initial load — stale-while-revalidate
  useEffect(() => {
    let cancelled = false;

    // ── Profile (fire-and-forget, non-blocking) ──────────────────────────────
    // The id from the session on the phone, at once: a server round trip here (`getUser()`)
    // left myId empty for the first second, so the chat's realtime channel joined twice.
    getMyUserId().catch(() => null).then(async found => {
      const uid = found ?? '';
      if (!cancelled) { setMyId(uid); }
      if (uid) {
        const { data: prof } = await db
          .from('profiles')
          .select('username, display_name, avatar_url')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled && prof) {
          setMyProfile({
            username: (prof as { username: string | null }).username,
            displayName: (prof as { display_name: string | null }).display_name,
            avatarUrl: (prof as { avatar_url: string | null }).avatar_url,
          });
        }
      }
    });

    // ── Messages: start network fetch immediately, read cache in parallel ────
    const openedAt = Date.now();
    let serverPageIn = false;
    const networkPromise = fetchFirstPageWithRetry(conversationId);

    // Show cached messages instantly (no spinner if cache hit) — but never AFTER the server's
    // page: on Android the saved copy can be the slower of the two, and showing it then put
    // the older page back, hiding the newest message until a catch-up (2026-11-03).
    messageCache.getMessages(conversationId).then(cached => {
      if (cancelled) { return; }
      if (serverPageIn) {
        console.log(`[chat] open: saved copy came after the server page (${Date.now() - openedAt} ms) — ignored`);
        return;
      }
      if (cached && cached.length > 0) {
        setMessages(cached);
        setLoading(false);
      }
    });

    // Merge fresh data when network responds
    networkPromise
      .then(({ messages: msgs, nextCursor: cursor }) => {
        if (!cancelled) {
          serverPageIn = true;
          console.log(`[chat] open: server page in ${Date.now() - openedAt} ms`);
          setMessages(msgs);
          setNextCursor(cursor);
          setLoading(false);
          setFirstPageIn(true);
          // This phone now holds the chat up to its newest message: "Delivered" for the sender.
          void markConversationDelivered(conversationId, msgs[0]?.createdAt ?? null);
          // Write-through: persist first page so next open is instant
          void messageCache.setMessages(conversationId, msgs);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setFirstPageIn(true);
          console.warn('[chat] fetchMessages failed', err);
          showToast("Couldn't load messages. Please try again.", { kind: 'error' });
        }
      });

    void markReadAndRefreshBadge(conversationId);
    // Reading the chat makes its notifications stale — including ones the user
    // did not tap (two messages → two iOS rows, a tap removes only one).
    void clearConversationNotifications(conversationId);

    return () => { cancelled = true; };
  }, [conversationId, showToast]);

  // Fetch the latest page and MERGE unseen messages onto the top. The one
  // catch-up path for everything realtime can miss:
  //   • back from the background onto this chat (realtime was paused);
  //   • a push for this chat arrived while it is open (pushNotifications pings
  //     instead of showing a banner — the push path is the backup);
  //   • the realtime channel re-joined after a drop, or failed to deliver one.
  // Merging (not replacing) keeps older pages the user scrolled back through,
  // and the cursor. Retried once: the resume path fires the instant iOS wakes
  // the app, when the first request typically fails.
  // Mark this chat read and clear its notifications — unless seenMustWait() (Android,
  // backgrounded: the socket stays open there, so messages land with nobody looking).
  // Then it is remembered and done on the way back: resume, or focus for a chat that
  // was under another screen.
  const missedSeenRef = useRef(false);
  const markSeenOrWait = useCallback(() => {
    if (seenMustWait()) {
      missedSeenRef.current = true;
      return;
    }
    missedSeenRef.current = false;
    void markReadAndRefreshBadge(conversationId);
    void clearConversationNotifications(conversationId);
  }, [conversationId]);

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const refreshLatest = useCallback(async (reason: string) => {
    try {
      const { messages: latest } = await fetchFirstPageWithRetry(conversationId);
      if (!aliveRef.current) { return; }
      const onScreen = new Set(messagesRef.current.map(m => m.id));
      const added = latest.filter(m => !onScreen.has(m.id)).length;
      // In server order, not on top: a catch-up can bring an older message in after newer
      // ones (utils/chatOrder.ts).
      setMessages(prev => mergeNewestFirst(prev, latest));
      void markConversationDelivered(conversationId, latest[0]?.createdAt ?? null);
      if (added > 0) {
        console.log(`[chat] catch-up (${reason}) added ${added} message(s)`);
        setTimeout(scrollToLatest, 50);
      }
      // After the fetch, not before: a read marker sent in the first instant
      // after resume can fail the same way the load did.
      markSeenOrWait();
    } catch (err) {
      console.warn(`[chat] catch-up (${reason}) failed`, err);
    }
  }, [conversationId, scrollToLatest, markSeenOrWait]);

  // This chat is "the open chat" while it is the focused screen, so a push for
  // it pings refreshLatest instead of showing a banner (see activeConversation).
  // Coming back to it also marks what arrived while the app was away and this
  // chat sat under another screen — the resume path skips an unfocused chat.
  useFocusEffect(
    useCallback(() => {
      setActiveConversation(conversationId);
      if (missedSeenRef.current) { markSeenOrWait(); }
      return () => {
        if (getActiveConversation() === conversationId) { setActiveConversation(null); }
      };
    }, [conversationId, markSeenOrWait]),
  );

  useEffect(
    () => onConversationPing(conversationId, () => { void refreshLatest('push'); }),
    [conversationId, refreshLatest],
  );

  // Back from the background onto this chat: the mount effect above does not
  // re-run. Only when this chat is the screen on top, not when it sits under
  // another one in the stack.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active' || !navigation.isFocused()) { return; }
      void clearConversationNotifications(conversationId);
      void refreshLatest('resume');
    });
    return () => sub.remove();
  }, [conversationId, navigation, refreshLatest]);

  // DM read-receipt source: the other participant's last_read_at. Fetched
  // once when the conversation opens and kept fresh by a realtime sub on
  // conversation_members UPDATEs scoped to this conversation. Only matters
  // for DMs — groups would need multi-member fanout we haven't built yet.
  useEffect(() => {
    if (kind !== 'dm') { return; }
    let cancelled = false;
    void (async () => {
      const row = await getOtherMemberReadAt(conversationId);
      if (!cancelled && row) {
        setOtherReadAt(row.lastReadAt);
        setOtherDeliveredAt(row.lastDeliveredAt);
      }
    })();
    console.log('[realtime] conv-read subscribing', { conversationId });
    const channel = supabase
      .channel(`conv-read:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: { user_id?: string; last_read_at?: string | null; last_delivered_at?: string | null } }) => {
          const row = payload.new;
          if (!row || !row.user_id || row.user_id === myId) { return; }
          if (row.last_read_at) {
            console.log('[realtime] conv-read got other last_read_at', row.last_read_at);
            setOtherReadAt(row.last_read_at);
          }
          if (row.last_delivered_at) { setOtherDeliveredAt(row.last_delivered_at); }
        },
      )
      .subscribe(status => {
        console.log('[realtime] conv-read status', status);
      });
    return () => {
      cancelled = true;
      console.log('[realtime] conv-read unsubscribing');
      void supabase.removeChannel(channel);
    };
  }, [conversationId, kind, myId]);

  // Realtime subscription
  useEffect(() => {
    console.log(`[realtime] ConversationScreen subscribing conv=${conversationId} myId=${myId}`);
    subscribeToConversation(
      conversationId,
      msg => {
        console.log(`[realtime] ConversationScreen onMessage id=${msg.id} sender=${msg.senderId}`);
        setMessages(prev => {
          // Defensive: skip if already in list (e.g. own optimistic message that
          // already has the real DB id, or duplicate from a re-subscribe burst).
          if (prev.some(m => m.id === msg.id)) {
            console.log(`[realtime] ConversationScreen duplicate id=${msg.id} — skipping`);
            return prev;
          }
          console.log(`[realtime] ConversationScreen setMessages adding id=${msg.id} (was ${prev.length} msgs)`);
          return mergeNewestFirst(prev, [msg]);
        });
        setTimeout(scrollToLatest, 50);
        // Keep cache warm so the next open of this conversation shows the new msg
        void messageCache.prependMessages(conversationId, [msg]);
        // Re-mark read whenever an incoming message lands while the chat is
        // open. Without this, the receiver's last_read_at only advances at
        // mount, so the SENDER's "Seen" indicator wouldn't catch up to
        // messages that arrive while both are actively chatting. Skip our
        // own outbound — markAsRead for our own message is a no-op and
        // wastes a round trip. The push for this message may already be on
        // screen while the user is reading it here, hence the clear.
        if (msg.senderId && msg.senderId !== myId) {
          // Received, whether or not anyone is looking (Android keeps the socket open in
          // the background): "Delivered" now; "Seen" may have to wait.
          void markConversationDelivered(conversationId, msg.createdAt);
          markSeenOrWait();
        }
      },
      async messageId => {
        // Refresh reactions for that message
        const { data } = await db
          .from('message_reactions')
          .select('emoji, user_id')
          .eq('message_id', messageId);
        if (!data) { return; }
        const rxns = data as { emoji: string; user_id: string }[];
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== messageId) { return m; }
            const reactionMap = new Map<string, { count: number; reactedByMe: boolean; users: string[] }>();
            for (const r of rxns) {
              const ex = reactionMap.get(r.emoji) ?? { count: 0, reactedByMe: false, users: [] };
              ex.count += 1;
              ex.users.push(r.user_id);
              if (r.user_id === myId) { ex.reactedByMe = true; }
              reactionMap.set(r.emoji, ex);
            }
            return {
              ...m,
              reactions: Array.from(reactionMap.entries()).map(([emoji, v]) => ({
                emoji,
                count: v.count,
                reactedByMe: v.reactedByMe,
                users: v.users,
              })),
            };
          }),
        );
      },
      () => { void refreshLatest('realtime'); },
    );

    return () => unsubscribeFromConversation(conversationId);
  }, [conversationId, myId, scrollToLatest, refreshLatest, markSeenOrWait]);

  // For groups: fetch member count. For DMs: resolve the other member (their avatar,
  // and whose listening status the now-playing pill follows).
  const headerLoadedRef = useRef(false);
  useEffect(() => {
    // Not before the kind is known: the DM branch latches headerLoadedRef, so guessing
    // "DM" for a group would leave it with one member's face for good.
    if (!kind || headerLoadedRef.current) { return; }
    if (isGroup) {
      // Fetch member count for group header subtitle
      db
        .from('conversation_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .then(({ count }: { count: number | null }) => {
          headerLoadedRef.current = true;
          if (count !== null) { setMemberCount(count); }
        });
    } else {
      // DM: resolve the other member
      db
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', myId || 'x')
        .limit(1)
        .maybeSingle()
        .then(async ({ data }: { data: { user_id: string } | null }) => {
          if (!data?.user_id) { return; }
          headerLoadedRef.current = true;
          setOtherUserId(data.user_id);
          const profileRes = await db.from('profiles').select('avatar_url').eq('id', data.user_id).maybeSingle();
          const avatarUrl = (profileRes.data as { avatar_url: string | null } | null)?.avatar_url ?? null;
          if (avatarUrl) { setOtherUserAvatarUrl(avatarUrl); }
        });
    }
  }, [conversationId, myId, isGroup, kind]);

  // Refs, not state: onEndReached can fire again before a re-render, and with state both
  // calls passed the guard and fetched — and appended — the same page: every bubble twice,
  // and a late duplicate brought "load more" back after "No older messages" (2026-11-03).
  const loadingMoreRef = useRef(false);
  const nextCursorRef = useRef(nextCursor);
  nextCursorRef.current = nextCursor;
  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) { return; }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const { messages: older, nextCursor: next } = await fetchMessages(conversationId, cursor);
      // Merged, not appended: anything already on screen is skipped.
      setMessages(prev => mergeNewestFirst(prev, older));
      nextCursorRef.current = next;
      setNextCursor(next);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [conversationId]);

  const sendDisabled = !text.trim() || sending;

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) { return; }
    setText('');
    setSending(true);
    // Capture the reply target locally so the closure isn't affected if the
    // user starts a new reply while this one is in flight.
    const replyTarget = replyingTo;
    setReplyingTo(null);

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myId,
      kind: 'text',
      body,
      metadata: null,
      replyToId: replyTarget?.id ?? null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      senderUsername: null,
      senderDisplayName: null,
      senderAvatarUrl: null,
      reactions: [],
    };
    setMessages(prev => [optimistic, ...prev]);
    setTimeout(scrollToLatest, 50);

    try {
      const payload: SendMessagePayload = replyTarget
        ? { kind: 'text', body, replyToId: replyTarget.id }
        : { kind: 'text', body };
      const real = await sendMessage(conversationId, payload, myProfile);
      setMessages(prev =>
        settlePending(prev, optimistic.id, real),
      );
      // Update cache: replace optimistic with the confirmed message
      void messageCache.prependMessages(conversationId, [real]);
    } catch (err) {
      console.warn('[chat] sendMessage failed', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setText(body);
      // Restore the reply target so the user doesn't have to swipe again on retry.
      setReplyingTo(replyTarget);
      showToast("Couldn't send message. Please try again.", { kind: 'error' });
    } finally {
      setSending(false);
    }
  }, [text, sending, replyingTo, conversationId, myId, myProfile, showToast, scrollToLatest]);

  /**
   * 🎵 off. The query is NOT cleared here: the popover keeps drawing it while it shrinks
   * away (~170ms), and clearing it in the same render flipped the panel to "Recently
   * played" mid-close. openSongSearch starts the next search empty instead.
   */
  const closeSongSearch = useCallback(() => {
    setSongMode(false);
  }, []);

  /**
   * 🎵 on. Drops an armed reply: a song goes out as its own message (a track_share carries
   * no reply), and a banner left armed sat over the popover's bottom rows, then threaded
   * the NEXT typed message onto the old target.
   */
  const openSongSearch = useCallback(() => {
    setReplyingTo(null);
    setGifMode(false);
    setSongQuery('');
    setSongMode(true);
  }, []);

  /** GIF search off. As with songs, the query stays while the popover shrinks away. */
  const closeGifSearch = useCallback(() => {
    setGifMode(false);
  }, []);

  /** GIF search on — drops an armed reply for the same reason song search does. */
  const openGifSearch = useCallback(() => {
    setReplyingTo(null);
    setSongMode(false);
    setGifQuery('');
    setGifMode(true);
  }, []);

  /**
   * Tap a GIF → it is sent at once, as a song is. A plain text message reading '🎞 GIF' with
   * the GIF in its metadata (src/utils/chatGif.ts): this build draws the GIF, older builds
   * and the inbox line show the text, and nothing changes on the server.
   */
  const handlePickGif = useCallback(async (gif: Gif) => {
    closeGifSearch();
    KeyboardController.dismiss();
    rememberGif(gif);
    const payload: SendMessagePayload = { kind: 'text', body: GIF_LABEL, metadata: chatGifMetadata(gif) };
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myId,
      kind: 'text',
      body: GIF_LABEL,
      metadata: payload.metadata as Record<string, unknown>,
      replyToId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      senderUsername: null,
      senderDisplayName: null,
      senderAvatarUrl: null,
      reactions: [],
    };
    setMessages(prev => [optimistic, ...prev]);
    setTimeout(scrollToLatest, 50);
    try {
      const real = await sendMessage(conversationId, payload, myProfile);
      setMessages(prev => settlePending(prev, optimistic.id, real));
      void messageCache.prependMessages(conversationId, [real]);
    } catch (err) {
      console.warn('[chat] gif send failed', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      showToast("Couldn't send that GIF. Please try again.", { kind: 'error' });
    }
  }, [closeGifSearch, conversationId, myId, myProfile, showToast, scrollToLatest]);

  /**
   * Tap a song in the composer's song search → it is sent at once (no preview step).
   *
   *   Livil  → the existing `track_share` message: every app version draws it as a song
   *            card and plays it in Livil. A repost is sent as its ORIGINAL upload, so the
   *            card names the artist and its Repost button reposts the original.
   *   Spotify → a plain text message holding the track's URL: this app draws it as the
   *            Spotify card, an older app shows the link. Nothing new on the server.
   */
  // ── Disappearing photos and videos (PROP-0011) ────────────────────────────

  /**
   * Camera button → the sheet, at once. The keyboard goes first when it is up (the sheet is a
   * modal); waiting on a dismiss when it is already down only delayed the sheet.
   */
  const openMediaSheet = useCallback(async () => {
    setReplyingTo(null);
    if (KeyboardController.isVisible()) {
      await KeyboardController.dismiss().catch(() => {});
    }
    setMediaSheetOpen(true);
  }, []);

  /**
   * Camera / gallery → the native screen, once the sheet has closed (on iOS it opens into
   * nothing otherwise — useRunAfterDismiss), then the preview.
   */
  const pickMedia = useCallback((source: ChatMediaSource) => {
    setMediaSheetOpen(false);
    runAfterMediaSheet(async () => {
      try {
        const media = await pickChatPhoto(source);
        if (media) { setPendingMedia({ media, source }); }
      } catch (e) {
        console.warn('[chat] pick media failed', e);
        showToast(source === 'camera' ? "Couldn't open the camera." : "Couldn't open your photos.", { kind: 'error' });
      }
    });
  }, [runAfterMediaSheet, showToast]);

  /** Retake / pick again from where the photo came from, without leaving the preview. */
  const retakeMedia = useCallback(async () => {
    if (!pendingMedia) { return; }
    const { source, media: previous } = pendingMedia;
    try {
      const media = await pickChatPhoto(source);
      if (media) {
        cleanPickedFile(previous.uri);
        setPendingMedia({ media, source });
      }
    } catch (e) {
      console.warn('[chat] retake failed', e);
    }
  }, [pendingMedia]);

  /** ✕ on the preview: the photo is thrown away, file included. */
  const discardMedia = useCallback(() => {
    if (pendingMedia) { cleanPickedFile(pendingMedia.media.uri); }
    setPendingMedia(null);
  }, [pendingMedia]);

  /**
   * Send from the preview. The bubble appears at once (optimistic) while the file uploads;
   * the message itself is sent only after the upload, so a recipient never gets a bubble
   * whose file is not there.
   */
  const handleSendMedia = useCallback(async () => {
    if (!pendingMedia) { return; }
    const { media } = pendingMedia;
    setPendingMedia(null);
    const placeholderObject = `${conversationId}/${randomUuid()}.jpg`;
    const metadata = chatMediaMetadata({ ...media, object: placeholderObject });
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myId,
      kind: 'text',
      body: chatMediaLabel(media.type),
      metadata,
      replyToId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      senderUsername: null,
      senderDisplayName: null,
      senderAvatarUrl: null,
      reactions: [],
    };
    setMessages(prev => [optimistic, ...prev]);
    setTimeout(scrollToLatest, 50);
    try {
      // The picker's file is this phone's copy for the 20 minutes, then it is deleted.
      const real = await sendChatMedia(conversationId, media, myProfile, () => cleanPickedFile(media.uri));
      setMessages(prev => settlePending(prev, optimistic.id, real));
      void messageCache.prependMessages(conversationId, [real]);
    } catch (err) {
      console.warn('[chat] media send failed', err);
      cleanPickedFile(media.uri);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      showToast(
        media.type === 'video' ? "Couldn't send that video. Please try again." : "Couldn't send that photo. Please try again.",
        { kind: 'error' },
      );
    }
  }, [pendingMedia, conversationId, myId, myProfile, showToast, scrollToLatest]);

  /**
   * Opens the viewer on this photo, with the same sender's other live photos in this chat
   * (oldest first) so a tap moves on to the next one, as in stories.
   */
  const handleOpenChatMedia = useCallback((msg: ChatMessage, origin: { x: number; y: number }) => {
    const now = serverNow();
    const fromSender = messagesRef.current
      .filter(m =>
        m.senderId === msg.senderId
        && !m.deletedAt
        && !m.id.startsWith('opt-')
        && m.kind === 'text'
        && chatMediaFrom(m.metadata) !== null
        && (m.id === msg.id || chatMediaLeftMs(m.createdAt, now) > 0))
      // `messages` is newest first; the viewer goes oldest → newest.
      .reverse();
    const index = Math.max(0, fromSender.findIndex(m => m.id === msg.id));
    // myName titles the chat a save notification opens (a DM is named after the person).
    // Read from a ref: as a dependency, the profile arriving re-rendered every bubble on open.
    const me = myProfileRef.current;
    const myName = me.displayName || me.username || '';
    navigation.navigate('ChatMediaViewer', { messages: fromSender, index, origin, myId, myName });
  }, [navigation, myId]);

  /**
   * "Tap to view". Downloaded → the viewer opens at once. Still downloading → a spinner in
   * THIS bubble until it is ready, then the viewer opens (never onto a full-screen spinner).
   */
  const [openingMediaId, setOpeningMediaId] = useState<string | null>(null);
  const openingMediaRef = useRef<string | null>(null);
  const handleTapChatMedia = useCallback((msg: ChatMessage, origin: { x: number; y: number }) => {
    if (localChatMedia(msg.id)) {
      handleOpenChatMedia(msg, origin);
      return;
    }
    if (openingMediaRef.current === msg.id) { return; }
    openingMediaRef.current = msg.id;
    setOpeningMediaId(msg.id);
    void prefetchChatMedia(msg).then(uri => {
      // A later tap on another photo took over, or this one already finished.
      if (openingMediaRef.current !== msg.id) { return; }
      openingMediaRef.current = null;
      setOpeningMediaId(null);
      if (uri) {
        if (navigation.isFocused()) { handleOpenChatMedia(msg, origin); }
      } else if (chatMediaLeftMs(msg.createdAt, serverNow()) > 0) {
        showToast("Couldn't open this photo. Please try again.", { kind: 'error' });
      }
    });
  }, [handleOpenChatMedia, navigation, showToast]);

  // Photos are fetched the moment they are on screen, so they open instantly — and offline —
  // for as long as they exist (leaving the app deletes them; they are fetched again on
  // return — services/chatMedia.ts). Your own included: this phone holds what it just sent, but
  // not what you sent from another device or before a restart. Quiet and idempotent.
  // One at a time (queueChatMediaPrefetch), and only once the chat's own first page is in, so
  // they never hold up its messages.
  useEffect(() => {
    if (!firstPageIn) { return; }
    for (const m of messages) {
      if (m.kind === 'text' && chatMediaFrom(m.metadata)) {
        queueChatMediaPrefetch(m);
      }
    }
  }, [messages, firstPageIn]);

  // "Saved to phone by": loaded for every media message on screen, and kept live.
  const mediaIdsKey = useMemo(
    () => messages
      .filter(m => !m.id.startsWith('opt-') && m.kind === 'text' && chatMediaFrom(m.metadata))
      .map(m => m.id)
      .join(','),
    [messages],
  );
  useEffect(() => {
    if (!mediaIdsKey) { return; }
    let cancelled = false;
    void fetchChatMediaSavers(mediaIdsKey.split(',')).then(found => {
      // Unchanged (most chats: nobody saved anything) → keep the same object, or every
      // bubble re-renders for nothing while the chat opens.
      if (!cancelled) { setMediaSavers(prev => (sameSavers(prev, found) ? prev : found)); }
    });
    return () => { cancelled = true; };
  }, [mediaIdsKey]);
  useEffect(() => {
    if (!chatMediaOn) { return; }
    return subscribeChatMediaSaves(messageId => {
      if (!messagesRef.current.some(m => m.id === messageId)) { return; }
      void fetchChatMediaSavers([messageId]).then(found => {
        setMediaSavers(prev => ({ ...prev, ...found }));
      });
    });
  }, [chatMediaOn]);

  const handlePickSong = useCallback(async (song: PickedSong) => {
    closeSongSearch();
    KeyboardController.dismiss();

    let payload: SendMessagePayload;
    if (song.kind === 'spotify') {
      rememberSpotifyTrack(song.track);
      payload = { kind: 'text', body: spotifyTrackUrl(song.track.id) };
    } else {
      // The popover has already closed, so a failed lookup must still say so — otherwise
      // the tap just looks ignored.
      let post: FeedPost | null;
      try {
        post = song.kind === 'livil' ? song.post : await fetchPostById(song.postId);
        if (post && post.kind === 'repost' && post.originalPostId) {
          post = (await fetchPostById(post.originalPostId)) ?? post;
        }
      } catch (err) {
        console.warn('[chat] song lookup failed', err);
        showToast("Couldn't send that song. Please try again.", { kind: 'error' });
        return;
      }
      // Still a repost here = its original is gone or hidden from us (orphaned, deleted).
      // Sending the repost's own id would give the recipient a card whose Repost button
      // fails, because Repost takes an ORIGINAL upload.
      if (!post || post.kind === 'repost' || !isPlayableInLivil(post)) {
        showToast('That song is no longer available', { kind: 'info' });
        return;
      }
      const shareable = toShareablePost(post);
      payload = {
        kind: 'track_share',
        metadata: {
          track_id: shareable.trackId,
          post_id: shareable.id,
          title: shareable.title,
          artist_name: shareable.artistName,
          cover_art_url: shareable.coverArtUrl,
        },
      };
    }

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      conversationId,
      senderId: myId,
      kind: payload.kind,
      body: payload.kind === 'text' ? payload.body : null,
      metadata: payload.kind === 'track_share' ? (payload.metadata as Record<string, unknown>) : null,
      replyToId: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      senderUsername: null,
      senderDisplayName: null,
      senderAvatarUrl: null,
      reactions: [],
    };
    setMessages(prev => [optimistic, ...prev]);
    setTimeout(scrollToLatest, 50);

    try {
      const real = await sendMessage(conversationId, payload, myProfile);
      setMessages(prev => settlePending(prev, optimistic.id, real));
      void messageCache.prependMessages(conversationId, [real]);
    } catch (err) {
      console.warn('[chat] song send failed', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      showToast("Couldn't send that song. Please try again.", { kind: 'error' });
    }
  }, [closeSongSearch, conversationId, myId, myProfile, showToast, scrollToLatest]);

  /**
   * PLAY the shared track. The card says "Tap to listen", so it plays — it does not
   * navigate somewhere the song might be.
   *
   * The first version of this opened the author's profile focused on the post, copying
   * what an ActivityCenter notification tap does. That is right for "someone liked your
   * post" and wrong here: a song someone sent you in a chat is a song, and making the
   * listener find it on a profile is a worse version of the thing they asked for.
   *
   * Playback is started exactly the way PostCard starts it — setNowPlaying, mark the
   * clip start as the seek target, then requestPlay — so the single engine
   * (GlobalAudioPlayer) picks it up and the floating player appears over the chat. The
   * user stays in the conversation; tapping the floating player expands it. A video's
   * audio plays through the same engine, which is the documented single-engine design.
   */
  const handlePlaySharedPost = useCallback(async (postId: string) => {
    // Already the loaded track: toggle rather than restart, so tapping a card you are
    // already listening to does not jump back to the beginning. Through the engine's own
    // handlers, as the floating player does: requestPlay alone only marks the post active,
    // and GlobalAudioPlayer treats "active is the one I hold" as already playing, so a
    // paused song stayed silent while the player said playing (same bug and fix as
    // CommentSongCard, 2026-10-16).
    if (nowPlaying?.postId === postId && handlersRef.current) {
      if (activePostId === postId) { handlersRef.current.pause(); }
      else { handlersRef.current.play(); }
      return;
    }

    const post = await fetchPostById(postId);
    if (!post) {
      showToast('That track is no longer available', { kind: 'info' });
      return;
    }
    // A track_share is sent by the app for Livil uploads only, but the message row is
    // client-written: never hand the engine a post it cannot play (e.g. a Spotify repost).
    if (!isPlayableInLivil(post)) {
      showToast("That track can't be played here", { kind: 'info' });
      return;
    }
    const clipStart = post.clipStartSec ?? 0;
    setNowPlaying(feedPostToNowPlaying(post));
    markSeekTarget(clipStart);
    requestPlay(post.id);
    openFullScreen();
  }, [nowPlaying, activePostId, handlersRef, requestPlay, setNowPlaying, markSeekTarget, showToast, openFullScreen]);

  /** Repost a song someone shared here — the usual Repost screen, as from a feed card. */
  const handleRepostSharedPost = useCallback((postId: string) => {
    navigation.navigate('Repost', { originalPostId: postId });
  }, [navigation]);

  // A profile card opens that person's profile — resolved under the viewer's own RLS, so
  // a block or a vanished account is a toast rather than an empty profile screen.
  /** A repost someone sent here opens on its own page — play, like and repost happen there. */
  const handleOpenSharedRepost = useCallback((postId: string) => {
    navigation.navigate('PostDetail', { postId });
  }, [navigation]);

  /** …and one from someone whose reposts the viewer may not see opens that person. */
  const handleOpenReposterProfile = useCallback((userId: string) => {
    navigation.navigate('UserProfile', { userId });
  }, [navigation]);

  const handleOpenSharedProfile = useCallback(async (username: string) => {
    const target = await resolveSharedProfile(username);
    if (!target) {
      showToast('That profile is no longer available', { kind: 'info' });
      return;
    }
    navigation.navigate('UserProfile', { userId: target.userId });
  }, [navigation, showToast]);

  // ── Links in messages (utils/chatLinks.ts) ───────────────────────────────
  // Livil and open.spotify.com open at once — a Livil post or profile inside the app, the way
  // an incoming link does. Any other site asks first, naming its real host.
  const [pendingLink, setPendingLink] = useState<CheckedLink | null>(null);
  // The dialog keeps its words while it fades out after a choice.
  const shownLinkRef = useRef<CheckedLink | null>(null);
  if (pendingLink) { shownLinkRef.current = pendingLink; }
  const openOutside = useCallback((href: string) => {
    Linking.openURL(href).catch(() => {
      showToast("Couldn't open that link.", { kind: 'error' });
    });
  }, [showToast]);
  const handleOpenLink = useCallback(async (link: CheckedLink) => {
    if (link.trust === 'livil' && (await openLivilLink(link.href))) { return; }
    if (link.trust) {
      openOutside(link.href);
      return;
    }
    if (KeyboardController.isVisible()) {
      await KeyboardController.dismiss().catch(() => {});
    }
    setPendingLink(link);
  }, [openOutside]);
  const handleCopyLink = useCallback((linkText: string) => {
    try {
      copyText(linkText);
      haptics.select();
      showToast('Link copied', { kind: 'success' });
    } catch (e) {
      console.warn('[chat] copy link failed', e);
      showToast("Couldn't copy that link.", { kind: 'error' });
    }
  }, [showToast]);

  const handleLongPress = useCallback((msg: ChatMessage) => {
    // Firm tick when the picker opens — the same intent swipe-to-reply uses at
    // its threshold, so activation feels consistent across gestures.
    haptics.impact();
    setReactionTarget(msg);
  }, []);

  const handleReactionToggle = useCallback(async (msg: ChatMessage, emoji: string) => {
    const myCurrentReaction = msg.reactions.find(r => r.users.includes(myId));
    const isSameEmoji = myCurrentReaction?.emoji === emoji;

    // Compute updated reactions once — reuse for state update AND cache patch
    let reactions = [...msg.reactions];
    if (myCurrentReaction) {
      reactions = reactions
        .map(r => r.emoji === myCurrentReaction.emoji
          ? { ...r, count: r.count - 1, reactedByMe: false, users: r.users.filter(u => u !== myId) }
          : r)
        .filter(r => r.count > 0);
    }
    if (!isSameEmoji) {
      const target = reactions.find(r => r.emoji === emoji);
      if (target) {
        reactions = reactions.map(r => r.emoji === emoji
          ? { ...r, count: r.count + 1, reactedByMe: true, users: [...r.users, myId] }
          : r);
      } else {
        reactions = [...reactions, { emoji, count: 1, reactedByMe: true, users: [myId] }];
      }
    }
    const updatedMsg = { ...msg, reactions };

    // Optimistic state update (instant, no network wait)
    setMessages(prev => prev.map(m => m.id === msg.id ? updatedMsg : m));

    // Patch cache so next cold-open shows correct reactions
    void messageCache.patchMessage(conversationId, updatedMsg);

    // Persist to DB — addReaction does delete-then-insert for one-per-user
    if (isSameEmoji) {
      await removeReaction(msg.id, emoji);
    } else {
      await addReaction(msg.id, emoji);
    }
  }, [myId, conversationId]);

  // The long-press menu's rows for the pressed message.
  const menuActions = useMemo<MessageMenuAction[]>(() => {
    const msg = reactionTarget;
    if (!msg) { return []; }
    const actions: MessageMenuAction[] = [];
    const copyable = copyableText(msg);
    if (copyable) {
      actions.push({
        key: 'copy',
        label: 'Copy',
        icon: 'copy',
        onPress: () => {
          setReactionTarget(null);
          try {
            copyText(copyable);
            haptics.select();
            showToast('Copied', { kind: 'success' });
          } catch (e) {
            console.warn('[chat] copy failed', e);
            showToast("Couldn't copy that message.", { kind: 'error' });
          }
        },
      });
    }
    return actions;
  }, [reactionTarget, showToast]);

  const handlePickReaction = useCallback(async (emoji: string) => {
    if (!reactionTarget) { return; }
    // Lighter tick for the selection itself, so choosing an emoji doesn't feel
    // like opening the picker again.
    haptics.select();
    const msg = reactionTarget;
    setReactionTarget(null);
    await handleReactionToggle(msg, emoji);
  }, [reactionTarget, handleReactionToggle]);

  const handleStartJam = useCallback(async () => {
    if (activeJam) {
      showToast('End the current Jam Room first.', { kind: 'info' });
      return;
    }
    if (startingJam) { return; }
    setStartingJam(true);
    try {
      const jamRoomId = await createJamRoom(conversationId, nowPlaying);
      // Seed jam queue with the host's current playback queue (fire-and-forget)
      const trackIds = queueRef.current.map(item => item.trackId).filter(Boolean);
      if (trackIds.length > 0) {
        void bulkAddToQueue(jamRoomId, trackIds).catch(() => {});
      }
      setActiveJam({ jamRoomId, conversationId, conversationTitle: title });
      navigation.navigate('JamRoom', { jamRoomId, conversationId });
    } catch (err) {
      console.warn('[jam] createJamRoom failed', err);
      showToast("Couldn't start Jam Room. Please try again.", { kind: 'error' });
    } finally {
      setStartingJam(false);
    }
  }, [activeJam, startingJam, conversationId, nowPlaying, queueRef, setActiveJam, title, navigation, showToast]);

  const renderChatScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <KeyboardChatScrollView
        {...props}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        offset={insets.bottom}
        onContentInsetChange={onContentInsetChange}
        inverted
      />
    ),
    [insets.bottom, onContentInsetChange],
  );

  // The latest handlers, read by rowActions at call time: rowActions itself never changes, so
  // passing it keeps MessageRow's memo intact (see MessageRow).
  const latestRowActions = useRef<RowActions | null>(null);
  latestRowActions.current = {
    // Arming a reply leaves song search: a picked song can't be a reply.
    onReply: msg => { closeSongSearch(); closeGifSearch(); setReplyingTo(msg); },
    onReplyQuotePress: handleReplyQuotePress,
    onLongPress: handleLongPress,
    onReactionToggle: handleReactionToggle,
    onPlaySharedPost: handlePlaySharedPost,
    onRepostSharedPost: handleRepostSharedPost,
    onOpenSharedProfile: handleOpenSharedProfile,
    onOpenSharedRepost: handleOpenSharedRepost,
    onOpenReposterProfile: handleOpenReposterProfile,
    onOpenChatMedia: handleTapChatMedia,
    onOpenLink: handleOpenLink,
    onCopyLink: handleCopyLink,
  };
  const rowActions = useMemo<RowActions>(() => {
    const now = () => latestRowActions.current!;
    return {
      onReply: msg => now().onReply(msg),
      onReplyQuotePress: id => now().onReplyQuotePress(id),
      onLongPress: msg => now().onLongPress(msg),
      onReactionToggle: (msg, emoji) => now().onReactionToggle(msg, emoji),
      onPlaySharedPost: id => now().onPlaySharedPost(id),
      onRepostSharedPost: id => now().onRepostSharedPost(id),
      onOpenSharedProfile: username => now().onOpenSharedProfile(username),
      onOpenSharedRepost: id => now().onOpenSharedRepost(id),
      onOpenReposterProfile: userId => now().onOpenReposterProfile(userId),
      onOpenChatMedia: (msg, origin) => now().onOpenChatMedia(msg, origin),
      onOpenLink: link => now().onOpenLink(link),
      onCopyLink: linkText => now().onCopyLink(linkText),
    };
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      // FlatList is inverted, so `messages` is ordered newest→oldest.
      // The chronologically earlier message — the one rendered visually
      // ABOVE this row — sits at `index + 1`. Show a separator above the
      // bubble when this row begins a new time group (oldest msg, or a
      // gap of more than ~1h since the previous one).
      const prev = messages[index + 1] ?? null;
      const next = index > 0 ? messages[index - 1] : null;
      return (
        <MessageRow
          item={item}
          isMe={item.senderId === myId}
          showSep={shouldShowTimeSeparator(item.createdAt, prev?.createdAt ?? null)}
          showName={!prev || !sameChatRun(prev, item)}
          showAvatar={!next || !sameChatRun(item, next)}
          conversationId={conversationId}
          conversationTitle={title}
          repliedTo={item.replyToId ? messagesById.get(item.replyToId) ?? null : null}
          isHighlighted={item.id === highlightedMessageId}
          readStatus={receipts.get(item.id) ?? null}
          mediaSavers={mediaSavers[item.id]}
          mediaLoading={openingMediaId === item.id}
          actions={rowActions}
        />
      );
    },
    [myId, conversationId, title, messages, messagesById, highlightedMessageId, receipts, mediaSavers, openingMediaId, rowActions],
  );

  // The other person's now-playing, live. Only "playing music now" is ever shown —
  // whether they have the app open is deliberately not indicated anywhere. Groups
  // are skipped: a group has no single person to show.
  const listeningIds = useMemo(() => (!isGroup && otherUserId ? [otherUserId] : []), [isGroup, otherUserId]);
  // Re-read on return from a screen opened over the chat (a profile, the player).
  const [listeningFocus, setListeningFocus] = useState(0);
  useFocusEffect(useCallback(() => { setListeningFocus(n => n + 1); }, []));
  const otherListening = useListeningNow(listeningIds, listeningFocus).get(otherUserId ?? '') ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Icon name="back" size={28} color={COLORS.purple} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerInfo}
          activeOpacity={0.7}
          onPress={
            isGroup
              ? () => navigation.navigate('GroupInfo', { conversationId })
              : otherUserId
                ? () => navigation.navigate('UserProfile', { userId: otherUserId })
                : undefined
          }
        >
          <View style={styles.headerTitleRow}>
            {isGroup && (
              <GroupAvatarCluster
                conversationId={conversationId}
                faces={groupFaces}
                size={32}
                visitSeed={groupVisitSeed}
                fallbackLabel={title}
              />
            )}
            {!isGroup && (
              otherUserAvatarUrl ? (
                <Image source={{ uri: otherUserAvatarUrl }} style={styles.headerAvatar} />
              ) : (
                <View style={styles.headerAvatarPlaceholder}>
                  <Text style={styles.headerAvatarText}>{title.slice(0, 1).toUpperCase()}</Text>
                </View>
              )
            )}
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            {/* DM only — a group title is not a person. headerTitleRow sets gap: 8. */}
            {!isGroup && otherUserId ? <UsernameBadges userId={otherUserId} size={15} /> : null}
          </View>
          {isGroup ? (
            memberCount !== null ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {memberCount} member{memberCount !== 1 ? 's' : ''}
              </Text>
            ) : null
          ) : null}
        </TouchableOpacity>
        {/* Same gate as the composer: a jam is a shared listening session, so offering
            one to somebody you cannot even message is incoherent.
            `sendBlock` is null for groups, which keep their Jam button, and it covers
            'blocked' as well as 'not-friends'.

            NOTE, and it is the opposite of what it looks like: the server does NOT
            refuse this. jmem_insert (20260721120000) gates on CONVERSATION membership,
            not friendship, and both parties to a DM are conversation members whatever
            their friend status. So this button worked — it would create a live jam with
            someone who cannot send you a message. This hides the entry point; closing
            the door itself is a policy change and a separate decision. */}
        {sendBlock === null && (
          <TouchableOpacity
            style={styles.jamBtn}
            activeOpacity={0.7}
            // "Jams play Livil songs only" first (unless dismissed on this device).
            onPress={() => { void requestNotice('jam', () => { void handleStartJam(); }); }}
            disabled={startingJam}
          >
            <GradientBorder borderRadius={20} />
            {startingJam
              ? <ActivityIndicator size="small" color={COLORS.purpleNeon} />
              : <>
                  <Icon name="musicNote" size={14} color={COLORS.purpleNeon} />
                  <Text style={styles.jamBtnLabel}>Jam</Text>
                </>
            }
          </TouchableOpacity>
        )}
        {isGroup && (
          <TouchableOpacity
            style={styles.infoBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('GroupInfo', { conversationId })}
          >
            <Icon name="info" size={20} color={COLORS.purpleLight} />
          </TouchableOpacity>
        )}
      </View>

      {otherListening ? (
        <NowPlayingPill
          listening={otherListening}
          name={title}
          playingHere={
            !!otherListening.postId &&
            nowPlaying?.postId === otherListening.postId &&
            activePostId === otherListening.postId
          }
          onListen={handlePlaySharedPost}
        />
      ) : null}

      {/* Gate the FlatList render on myId being resolved too. Otherwise the
          first paint runs with myId='', so isMe=false for every row → all
          bubbles render left-aligned, then snap right once auth lands. */}
      {loading || !myId ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.purple} />
        </View>
      ) : (
        <KeyboardGestureArea
          interpolator="ios"
          style={styles.flex}
          textInputNativeID="conversation-input"
          // Song / GIF search: the box IS the search, so a drag — scrolling results past their
          // end included — must never put the keyboard away (owner, 2026-10-19).
          enableSwipeToDismiss={!searchMode}
        >
          <SwipeRevealProvider>
            <SwipeRevealGestureView>
              <FlatList
                ref={flatListRef}
                style={styles.flex}
                renderScrollComponent={renderChatScrollComponent}
                data={messages}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                inverted
                contentContainerStyle={[
                  styles.listContent,
                  styles.listContentRest,
                ]}
                onEndReached={loadMore}
                onEndReachedThreshold={0.2}
                ListEmptyComponent={
                  // Reachable since LIV-25: a DM now exists from the moment two people
                  // become friends, so the FIRST time either of them opens it there is
                  // nothing to render. Before that a conversation was created BY a
                  // message and could never be empty, which is why there was no empty
                  // state here — an empty thread showed a blank void above the composer.
                  //
                  // NO transform of our own here. VirtualizedList already un-flips the
                  // empty component: it clones it with
                  // `style: compose(inversionStyle, element.props.style)`, using the SAME
                  // per-platform inversion as the list — `scaleY: -1` on iOS but
                  // `scale: -1` (both axes) on Android. A `transform` in our style REPLACES
                  // that one rather than adding to it, so a hand-written `scaleY: -1` was
                  // right on iOS and left Android's text mirrored left-to-right.
                  <View style={styles.emptyThread}>
                    {isGroup ? (
                      <View style={styles.emptyThreadCluster}>
                        <GroupAvatarCluster
                          conversationId={conversationId}
                          faces={groupFaces}
                          size={72}
                          visitSeed={groupVisitSeed}
                          fallbackLabel={title}
                        />
                      </View>
                    ) : otherUserAvatarUrl ? (
                      <Image source={{ uri: otherUserAvatarUrl }} style={styles.emptyThreadAvatar} />
                    ) : (
                      <View style={styles.emptyThreadAvatarFallback}>
                        <Text style={styles.emptyThreadAvatarText}>
                          {(title?.trim()?.[0] ?? '♪').toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.emptyThreadTitle}>
                      {isGroup ? title : `You and ${title} are friends`}
                    </Text>
                    <Text style={styles.emptyThreadBody}>
                      {isGroup
                        ? 'No messages yet — start the conversation.'
                        : 'Say hi, or send them a track to get started.'}
                    </Text>
                  </View>
                }
                // The top of the chat (the list is inverted): a spinner while older messages
                // load, else a hint that there are more, else that this is the beginning. The
                // end line waits for the server's first page: a cached page has no cursor yet.
                ListFooterComponent={
                  loadingMore ? (
                    <View style={styles.loadMoreSpinner}>
                      <ActivityIndicator size="small" color={COLORS.purpleLight} />
                    </View>
                  ) : messages.length === 0 ? null : nextCursor ? (
                    <Text style={styles.historyHint}>Pull to load more</Text>
                  ) : firstPageIn ? (
                    <Text style={styles.historyHint}>No older messages</Text>
                  ) : null
                }
              />
            </SwipeRevealGestureView>
          </SwipeRevealProvider>

          {/* The composer pads itself by the home-indicator inset so it clears the
              iPhone home bar while the keyboard is down. When the keyboard is up
              that inset is already inside the keyboard's height, so sliding the
              bar up by the full height would stack both: a ~34pt dead band
              between the input and the keyboard. `opened: insets.bottom` sinks
              the bar back by that inset so the padding tucks under the keyboard.
              Android: keyboard-controller keeps the root above the nav bar and
              reports a nav-bar-free height, so insets.bottom is ~0 and this is a
              no-op there — correct either way. */}
          {/* Headroom above the composer (stickyComposer) so the song popover sits INSIDE
              this view's bounds — a child drawn outside its parent cannot be tapped on iOS
              or Android. box-none lets touches in the empty headroom reach the chat behind;
              the matching negative margin keeps the chat list's size unchanged. */}
          <KeyboardStickyView
            offset={{ closed: 0, opened: insets.bottom }}
            style={styles.stickyComposer}
            pointerEvents="box-none"
          >
            <ChatSongPicker
              open={songMode}
              query={songQuery}
              onPick={song => { void handlePickSong(song); }}
              bottom={composerHeight}
              // 🎵 centre: sendBar padding (12) + half the 38dp button, minus the popover's
              // 8dp inset — the point the list grows out of and shrinks back into.
              originX={12 + 19 - 8}
            />
            <ChatGifPicker
              open={gifMode}
              query={gifQuery}
              onPick={gif => { void handlePickGif(gif); }}
              bottom={composerHeight}
              // GIF button centre: padding (12) + 🎵 (38) + gap (8) + half its 38dp, minus the
              // popover's 8dp inset.
              originX={12 + 38 + 8 + 19 - 8}
            />
            {replyingTo ? (
              <View style={styles.replyPreview}>
                <View style={styles.replyPreviewBar} />
                <View style={styles.replyPreviewBody}>
                  <Text style={styles.replyPreviewTitle} numberOfLines={1}>
                    Replying to {replyingTo.senderId === myId
                      ? 'yourself'
                      : (replyingTo.senderDisplayName || replyingTo.senderUsername || 'Unknown')}
                  </Text>
                  <ChatReplySnippet message={replyingTo} tone="bar" numberOfLines={1} />
                </View>
                <TouchableOpacity
                  style={styles.replyPreviewClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setReplyingTo(null)}
                >
                  <Icon name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}
            {sendBlock ? (
              <View style={[styles.sendBlocked, { paddingBottom: 12 + insets.bottom }]}>
                <Text style={styles.sendBlockedText}>
                  {sendBlock === 'blocked'
                    ? `You blocked ${title || 'this person'}.`
                    : `You can only message friends on Livil.`}
                </Text>
                <Button
                  label={sendBlock === 'blocked' ? 'Unblock' : 'Add friend'}
                  onPress={() => {
                    if (!otherUserId) { return; }
                    // Both actions live on the profile: unblock needs its
                    // confirmation, and Add opens the same relationship sheet
                    // the rest of the app uses. Duplicating either here would be
                    // a second place to keep in step with the first.
                    navigation.navigate('UserProfile', { userId: otherUserId });
                  }}
                  variant="secondary"
                  size="md"
                />
              </View>
            ) : (
            <View
              style={[styles.sendBar, { paddingBottom: 8 + insets.bottom }]}
              onLayout={e => setComposerHeight(Math.floor(e.nativeEvent.layout.height))}
            >
              {/* 🎵 turns the box into a song search (Livil + Spotify); tap a result to send. */}
              <TouchableOpacity
                style={[styles.musicBtn, songMode && styles.musicBtnActive]}
                activeOpacity={0.7}
                onPress={() => (songMode ? closeSongSearch() : openSongSearch())}
                accessibilityRole="button"
                accessibilityLabel={songMode ? 'Back to typing a message' : 'Send a song'}
                accessibilityState={{ selected: songMode }}
              >
                {songMode ? <GradientBorder borderRadius={19} /> : null}
                <MusicToggleIcon active={songMode} color={songMode ? COLORS.purpleNeon : COLORS.textSecondary} />
              </TouchableOpacity>
              {/* GIF turns the box into a GIF search (GIPHY, G/PG); tap a GIF to send it. */}
              {gifsOn ? (
                <TouchableOpacity
                  style={[styles.musicBtn, gifMode && styles.musicBtnActive]}
                  activeOpacity={0.7}
                  onPress={() => (gifMode ? closeGifSearch() : openGifSearch())}
                  accessibilityRole="button"
                  accessibilityLabel={gifMode ? 'Back to typing a message' : 'Send a GIF'}
                  accessibilityState={{ selected: gifMode }}
                >
                  {gifMode ? <GradientBorder borderRadius={19} /> : null}
                  <Icon name="gif" size={20} color={gifMode ? COLORS.purpleNeon : COLORS.textSecondary} />
                </TouchableOpacity>
              ) : null}
              <View style={styles.inputWrap}>
                <FormInput
                  nativeID="conversation-input"
                  value={songMode ? songQuery : gifMode ? gifQuery : text}
                  // A search is one line: a pasted newline becomes a space.
                  onChangeText={t => (
                    songMode
                      ? setSongQuery(t.replace(/\n/g, ' ').slice(0, 100))
                      : gifMode
                        ? setGifQuery(t.replace(/\n/g, ' ').slice(0, MAX_GIF_QUERY_LENGTH))
                        : setText(clampComposerInput(t))
                  )}
                  placeholder={
                    songMode
                      ? (spotifySearchOn ? 'Search a song on Livil or Spotify…' : 'Search a song on Livil…')
                      : gifMode
                        ? 'Search GIFs…'
                        : 'Send Message…'
                  }
                  placeholderTextColor={COLORS.textMuted}
                  // ALWAYS multiline. On iOS `multiline` picks the native view (UITextView vs
                  // UITextField), so toggling it with 🎵 swapped the view and dropped the
                  // keyboard. Song mode gets its single-line behaviour from submitBehavior
                  // instead: return closes the keyboard, never inserts a newline.
                  multiline
                  submitBehavior={searchMode ? 'blurAndSubmit' : 'newline'}
                  autoCorrect={!searchMode}
                  style={styles.textInput}
                  returnKeyType={searchMode ? 'search' : 'default'}
                />
                {!searchMode && text.length > MAX_CHARS - COUNTER_VISIBLE_FROM && (
                  <Text style={[styles.charCounter, text.length >= MAX_CHARS && styles.charCounterOver]}>
                    {MAX_CHARS - text.length}
                  </Text>
                )}
                {/* Disappearing photos and videos (PROP-0011): inside the box, right edge, only
                    while it is empty — a fourth round button would squeeze the box. */}
                {chatMediaOn && !searchMode && text.length === 0 ? (
                  <Pressable
                    onPress={() => { void openMediaSheet(); }}
                    accessibilityRole="button"
                    accessibilityLabel="Send a photo or video"
                    hitSlop={4}
                    style={({ pressed }) => [styles.mediaBtn, pressed && styles.mediaBtnPressed]}
                  >
                    <Icon name="camera" size={20} color={COLORS.textSecondary} weight="regular" />
                  </Pressable>
                ) : null}
              </View>
              {searchMode ? (
                <TouchableOpacity
                  style={[styles.sendBtn, styles.sendBtnDisabled]}
                  activeOpacity={0.7}
                  onPress={songMode ? closeSongSearch : closeGifSearch}
                  accessibilityRole="button"
                  accessibilityLabel={songMode ? 'Close song search' : 'Close GIF search'}
                >
                  <Icon name="close" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ) : (
              <TouchableOpacity
                style={[styles.sendBtn, sendDisabled && styles.sendBtnDisabled]}
                activeOpacity={0.7}
                onPress={handleSend}
                disabled={sendDisabled}
              >
                {/* Glow only while actionable — disabled falls back to a flat grey ring. */}
                {sendDisabled ? null : <GradientBorder borderRadius={19} />}
                <Icon
                  name="send"
                  size={18}
                  color={sendDisabled ? COLORS.textMuted : COLORS.purpleNeon}
                />
              </TouchableOpacity>
              )}
            </View>
            )}
          </KeyboardStickyView>
        </KeyboardGestureArea>
      )}

      <MessageMenu
        visible={!!reactionTarget}
        onPick={handlePickReaction}
        onClose={() => setReactionTarget(null)}
        actions={menuActions}
      />

      <ConfirmActionModal
        visible={!!pendingLink}
        title="Open this link?"
        message={shownLinkRef.current ? `It opens ${shownLinkRef.current.host}, outside Livil.` : undefined}
        icon="externalLink"
        tone="primary"
        confirmLabel="Open"
        onConfirm={() => {
          const link = pendingLink;
          setPendingLink(null);
          if (link) { openOutside(link.href); }
        }}
        onCancel={() => setPendingLink(null)}
      />

      <ChatMediaSourceSheet
        visible={mediaSheetOpen}
        onClose={() => setMediaSheetOpen(false)}
        onDismiss={onMediaSheetDismiss}
        onPick={pickMedia}
      />
      <ChatMediaPreview
        media={pendingMedia?.media ?? null}
        recipientName={title}
        onClose={discardMedia}
        onRetake={() => { void retakeMedia(); }}
        onSend={() => { void handleSendMedia(); }}
      />
    </SafeAreaView>
  );
}

/** Room reserved above the composer for the song popover (its max height + margin). */
const SONG_POPOVER_SPACE = 360;
/** Corner radius shared by song cards and profile cards — the glow outline is drawn for it. */
const PROFILE_CARD_RADIUS = 18;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  backButton: { padding: 4 },
  headerInfo: { flex: 1, justifyContent: 'center' },
  infoBtn: { padding: 6 },
  jamBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    marginLeft: 4,
  },
  jamBtnLabel: { color: COLORS.purpleNeon, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '700' },
  headerTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: COLORS.purple, fontSize: 12, marginTop: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 12, paddingTop: 12, gap: 6 },
  // The newest message rests 200pt up the inverted list; see the scroll-to-newest note.
  listContentRest: { paddingTop: 200 },
  // Deliberately no `transform`: the inverted FlatList un-flips its empty component
  // itself, per platform — see the comment at the ListEmptyComponent.
  emptyThread: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 48,
    gap: 10,
  },
  emptyThreadAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 4 },
  emptyThreadCluster: { marginBottom: 4 },
  emptyThreadAvatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 4,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyThreadAvatarText: { color: COLORS.purpleLight, fontSize: 28, fontWeight: '700' },
  emptyThreadTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyThreadBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadMoreSpinner: { paddingVertical: 16, alignItems: 'center' },
  // Same height as loadMoreSpinner (16 + 20 + 16), so swapping hint ↔ spinner never nudges
  // the messages under it.
  historyHint: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: 16,
  },
  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginVertical: 2,
  },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  senderAvatarWrap: {},
  senderAvatarGap: { width: 28 },
  senderAvatar: { width: 28, height: 28, borderRadius: 14 },
  senderAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  senderAvatarText: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700' },
  bubbleColumn: { maxWidth: '75%' },
  bubbleColumnMe: { alignItems: 'flex-end' },
  bubbleWrapper: { position: 'relative' },
  bubbleWrapperWithReactions: { marginBottom: 16 },
  senderName: { color: COLORS.textSecondary, fontSize: 11, marginLeft: 2 },
  senderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleMe: {
    backgroundColor: COLORS.purple,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 4,
  },
  // Song cards (Livil or Spotify): no fill, the GradientBorder glow is the outline. Uniform
  // corners — the glow is drawn for one radius, and a 4px "tail" corner would clip it.
  bubbleSong: {
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  bubbleSticker: {
    backgroundColor: 'transparent',
    padding: 0,
  },
  // No fill, every corner equal: GradientBorder draws one radius for all four, so the
  // tail corner (bubbleMe/bubbleThem's 4) would leave the outline cutting across it.
  // No overflow:'hidden' here — it shaves the outer edge of the glow (see CLAUDE.md).
  bubbleProfileCard: {
    backgroundColor: 'transparent',
    borderRadius: PROFILE_CARD_RADIUS,
    borderBottomLeftRadius: PROFILE_CARD_RADIUS,
    borderBottomRightRadius: PROFILE_CARD_RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  // Disappearing photo/video bubbles (PROP-0011). Sent: the usual purple bubble. Received: the
  // surface bubble with a neon hairline, so "tap me" reads before the words do. Expired: an
  // outline only — nothing left to open. Chat sent bubbles are exempt from the no-fill rule.
  bubbleMedia: { paddingLeft: 8, paddingRight: 16, paddingVertical: 8 },
  bubbleMediaThem: {
    paddingLeft: 8,
    paddingRight: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.45)',
  },
  bubbleMediaExpired: {
    paddingLeft: 8,
    paddingRight: 18,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  // White on both sides (owner, 2026-10-19): grey received text read as faded next to the
  // white sent text.
  bubbleText: { color: COLORS.white, fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: COLORS.white },
  // A link in a message: underlined, white on my purple bubble, light purple on theirs.
  linkText: { textDecorationLine: 'underline' },
  linkTextMe: { color: COLORS.white },
  linkTextThem: { color: COLORS.purpleLight },
  // Brief pulse applied when the user taps a reply quote pointing at this
  // bubble — same purple tint as the comment-row highlight in CommentsSheet.
  bubbleHighlighted: {
    borderWidth: 1.5,
    borderColor: COLORS.purpleLight,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 6,
  },
  // Quoted-reply strip rendered above the body text inside a reply bubble.
  // Mirrors Instagram — a tinted block with a left bar, sender name, and a
  // truncated snippet of the original message. me/them get distinct
  // colour pairs so the strip is legible against either bubble background.
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 6,
  },
  // "me" bubble is bright purple — darken the strip and use white text so
  // it doesn't disappear against the bubble.
  replyQuoteMe: {
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderLeftColor: COLORS.white,
  },
  replyQuoteAuthorMe: { color: COLORS.white },
  // "them" bubble is dark surface — lift the strip and keep the purple bar.
  replyQuoteThem: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderLeftColor: COLORS.purpleLight,
  },
  replyQuoteAuthorThem: { color: COLORS.purpleLight },
  replyQuoteAuthor: { fontSize: 12, fontWeight: '700' },
  // Read-receipt footer (Seen / Delivered / Sent / Sending…) under the outgoing DM message
  // it applies to — small, muted, right-aligned to sit under the bubble.
  readStatus: {
    alignSelf: 'flex-end',
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    marginRight: 14,
    marginBottom: 2,
  },
  stickerImg: { width: 120, height: 120 },
  // The comment card's own top margin is for sitting under comment text.
  chatGif: { marginTop: 0 },
  // Jam invite card
  jamInviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    maxWidth: '85%',
  },
  jamInviteInfo: { flex: 1 },
  jamInviteTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  jamInviteSub: { color: COLORS.purpleLight, fontSize: 11, marginTop: 2 },
  jamInviteCardEnded: {
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    opacity: 0.7,
  },
  jamInviteBtnEnded: {
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  jamInviteBtnEndedText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  // System messages (e.g. "The Jam Room has ended.")
  systemRow: {
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 20,
  },
  systemText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  // Reactions — Instagram-style: a small rounded pill that sits at the
  // bottom corner of the bubble. No hard border (the previous bg-coloured
  // border created an awkward visible frame on dark mode). Subtle shadow
  // lifts the chip off the chat background without a stroke.
  reactionOverlay: {
    position: 'absolute',
    bottom: -12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionOverlayThem: { left: 8 },
  reactionOverlayMe: { right: 8 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
  reactionChipActive: {
    // Own reaction picks up a saturated purple tint — Instagram uses a
    // similar accent-coloured fill, no extra border.
    backgroundColor: 'rgba(139, 61, 255,0.35)',
  },
  reactionEmoji: { fontSize: 14, lineHeight: 16 },
  reactionCount: { color: COLORS.white, fontSize: 11, fontWeight: '600' },
  // Reaction picker overlay
  reactionPickerOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  reactionPickerCard: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    width: '100%',
  },
  reactionPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  reactionPickerBtn: { padding: 6 },
  reactionPickerEmoji: { fontSize: 26 },
  reactionPickerMoreBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  reactionPickerMoreBtnActive: {
    backgroundColor: COLORS.purpleDim,
  },
  reactionPickerMoreIcon: { color: COLORS.textSecondary, fontSize: 20, fontWeight: '600' },
  // Long-press menu rows (Copy, …) under the reactions.
  menuActions: {
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  menuAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 12,
  },
  menuActionPressed: { backgroundColor: COLORS.surface },
  menuActionLabel: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  menuActionLabelDanger: { color: COLORS.error },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    marginTop: 6,
  },
  emojiGridBtn: {
    width: '10%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiGridEmoji: { fontSize: 22 },
  // Inline banner that appears between the message list and the input when
  // the user has armed a reply via the swipe gesture. Tap × to cancel and
  // fall back to a normal send.
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: 'rgba(139, 61, 255, 0.10)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139, 61, 255, 0.25)',
  },
  replyPreviewBar: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: COLORS.purpleLight,
    borderRadius: 2,
  },
  replyPreviewBody: { flex: 1 },
  replyPreviewTitle: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '700' },
  replyPreviewClose: { padding: 4 },
  // Replaces the send bar rather than sitting above it — a disabled composer
  // still invites typing, which is how the "Couldn't send message" toast got
  // reached in the first place.
  sendBlocked: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  sendBlockedText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  sendBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(139, 61, 255, 0.25)',
    gap: 8,
    backgroundColor: 'rgba(10, 10, 15, 0.90)',
  },
  stickyComposer: { paddingTop: SONG_POPOVER_SPACE, marginTop: -SONG_POPOVER_SPACE },
  inputWrap: { flex: 1 },
  // The camera button sits inside the message box, on its right edge (shown only while the
  // box is empty, so it never covers typed text).
  mediaBtn: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaBtnPressed: { opacity: 0.6 },
  musicBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  // The glow replaces the grey ring while song search is on.
  musicBtnActive: { borderWidth: 0 },
  // FormInput's default `paddingVertical: 15` is tuned for full-width auth
  // fields; in a chat composer it makes the collapsed box read as a text area.
  // Tighten it locally (the style prop merges after FormInput's own) so the
  // single-line height sits alongside the 38px send button. `maxHeight` is
  // untouched, so the input still grows with longer messages.
  textInput: { maxHeight: 100, paddingVertical: 9 },
  charCounter: { color: COLORS.textMuted, fontSize: 11, textAlign: 'right', marginTop: 2, marginRight: 4 },
  charCounterOver: { color: COLORS.error },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No fill to swap out any more — disabled reads as a flat grey ring with a
  // muted icon, replacing the old backgroundColor swap.
  sendBtnDisabled: { borderWidth: 1, borderColor: COLORS.border },
});
