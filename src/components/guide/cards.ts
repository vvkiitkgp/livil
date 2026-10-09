import type { ComponentType } from 'react';
import { WelcomeIllustration } from './cardWelcome';
import { TapIllustration, SwipeUpIllustration, FlickIllustration, DragIllustration } from './cardsPlayer';
import {
  MomentsIllustration, LikeIllustration, RepostIllustration, ShareIllustration, StoriesIllustration,
} from './cardsFeed';
import {
  FriendsIllustration, ChatIllustration, JamIllustration, ListeningIllustration,
  LibraryIllustration, NotifyIllustration,
} from './cardsPeople';

/**
 * The first-run guide, in order. Copy is the approved mockup's, verbatim — change it
 * here and nowhere else. `cta` overrides the Next label (only the last card uses it).
 */
export type GuideCard = {
  key: string;
  headline: string;
  line: string;
  Illustration: ComponentType;
  cta?: string;
  /** Shown on the first run only — a greeting for a new account makes no sense on a replay. */
  firstRunOnly?: boolean;
  /**
   * Appended to `line` only while Spotify reposts are switched on (the server switch,
   * `useSpotifyAvailability().reposts`, ADR-0027). The guide must not promise a feature
   * the viewer cannot find — see `lineFor`.
   */
  spotifyLine?: string;
};

export const GUIDE_CARDS: GuideCard[] = [
  {
    key: 'welcome',
    headline: "You're in",
    line: 'Your account is ready. Here\u2019s a one-minute tour of the place.',
    Illustration: WelcomeIllustration,
    cta: 'Show me around',
    firstRunOnly: true,
  },
  {
    key: 'tap',
    headline: 'Meet the floating player',
    line: 'This circle follows you everywhere. Tap it to play or pause.',
    Illustration: TapIllustration,
  },
  {
    key: 'up',
    headline: 'Swipe up',
    line: 'The circle opens into the full-screen player.',
    Illustration: SwipeUpIllustration,
  },
  {
    key: 'flick',
    headline: 'Flick sideways',
    line: 'Right → next song. Left → previous.',
    Illustration: FlickIllustration,
  },
  {
    key: 'drag',
    headline: 'In the way? Move it',
    line: 'Hold, then drag the circle anywhere.',
    Illustration: DragIllustration,
  },
  {
    key: 'moments',
    headline: 'Posts play a moment',
    line: 'The bright part is their pick. Swipe up for the whole song.',
    Illustration: MomentsIllustration,
  },
  {
    key: 'like',
    headline: 'Like what you hear',
    line: 'Tap the heart. Comments are right next to it.',
    Illustration: LikeIllustration,
  },
  {
    key: 'repost',
    headline: 'Repost your moment',
    line: 'Pick the part you love. Post it to your profile, or as a story that lasts a day.',
    spotifyLine: 'Found it on Spotify? Repost that too.',
    Illustration: RepostIllustration,
  },
  {
    key: 'share',
    headline: 'Share it outside',
    line: 'Send a link to anyone — WhatsApp, Messages, anywhere. They can listen without the app.',
    Illustration: ShareIllustration,
  },
  {
    key: 'stories',
    headline: 'Stories',
    line: 'Tap a ring. Short clips from people you follow, gone in a day.',
    Illustration: StoriesIllustration,
  },
  {
    key: 'friends',
    headline: 'Friends and Stars',
    line: 'Friend: both say yes → chat, Jam, their reposts, see what they play.\n\nStar your favourite artists: one tap → just their uploads.',
    Illustration: FriendsIllustration,
  },
  {
    key: 'chat',
    headline: 'Talk about it',
    line: 'Chat with friends. Send songs straight into the chat.',
    Illustration: ChatIllustration,
  },
  {
    key: 'jam',
    headline: 'Listen together',
    line: 'Same song, same second, live. Chat while it plays, and suggest songs for the host to play next.',
    Illustration: JamIllustration,
  },
  {
    key: 'listening',
    headline: 'See what friends play',
    line: 'Friends see yours too. Switch it off any time in Settings.',
    Illustration: ListeningIllustration,
  },
  {
    key: 'library',
    headline: 'Your Library',
    line: 'Liked songs, playlists and what you played recently.',
    Illustration: LibraryIllustration,
  },
  {
    key: 'notify',
    headline: "Don't miss a beat",
    line: 'Messages from friends, Jam invites, friend requests, likes and comments — they all arrive as notifications.',
    Illustration: NotifyIllustration,
    cta: "Let's go",
  },
];

/** A card's copy as shown: the Spotify sentence only while Spotify reposts are on. */
export function lineFor(card: GuideCard, opts: { spotifyReposts: boolean }): string {
  return card.spotifyLine && opts.spotifyReposts ? `${card.line} ${card.spotifyLine}` : card.line;
}

/** The cards a given showing uses: the greeting is dropped from a replay. */
export function cardsFor(mode: 'first' | 'replay'): GuideCard[] {
  return mode === 'first' ? GUIDE_CARDS : GUIDE_CARDS.filter(c => !c.firstRunOnly);
}
