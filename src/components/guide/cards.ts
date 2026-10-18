import type { ComponentType } from 'react';
import { WelcomeIllustration } from './cardWelcome';
import { PlayerIllustration } from './cardsPlayer';
import { FindFriendsIllustration, NotifyIllustration, StarIllustration } from './cardsPeople';

/**
 * The first-run guide, in order: six cards, one short line each (the owner's "text diet"
 * and approved design, 2026-10-18 — sixteen cards read "like a book"; the rest is learned
 * by using the app). Change copy here and nowhere else. `cta` overrides the Next label.
 */
export type GuideCard = {
  key: string;
  headline: string;
  line: string;
  /** The looping animation above the copy. Absent on an interactive step. */
  Illustration?: ComponentType;
  /**
   * An interactive step instead of an animation. The guide screen renders it and owns its
   * button: 'pickThree' = pick three songs, which are reposted for you (PickThree.tsx).
   */
  interactive?: 'pickThree';
  cta?: string;
  /** Shown on the first run only — a greeting, or a step that only makes sense once. */
  firstRunOnly?: boolean;
  /** Replaces `line` on a replay from Settings, where the first-run steps are skipped. */
  replayLine?: string;
};

export const GUIDE_CARDS: GuideCard[] = [
  {
    key: 'welcome',
    headline: "You're in",
    line: "Here's a quick tour.",
    Illustration: WelcomeIllustration,
    firstRunOnly: true,
  },
  {
    key: 'player',
    headline: 'Livil music player',
    line: 'Uploaded songs from independent artists on Livil play here. Tap to play, swipe up to open, flick for the next song.',
    Illustration: PlayerIllustration,
  },
  {
    key: 'friends',
    headline: 'Find your friends',
    line: 'Add people who match your vibe, from Search or your feed.',
    Illustration: FindFriendsIllustration,
  },
  {
    key: 'star',
    headline: 'Be a fan',
    line: 'Star independent artists to become their fan. Every star helps them grow. Show support! 💪',
    Illustration: StarIllustration,
  },
  {
    key: 'pick',
    headline: 'Your 3 favourites',
    line: 'Pick 3 songs you love right now.',
    interactive: 'pickThree',
    // Required on the first run: the guide cannot be finished without it. A replay
    // skips it — the songs were picked once already.
    firstRunOnly: true,
  },
  {
    key: 'notify',
    headline: "Don't miss a beat",
    line: 'See who likes and comments on your 3 songs from notifications.',
    replayLine: 'See who likes and comments on your reposts from notifications.',
    Illustration: NotifyIllustration,
    cta: "Let's go",
  },
];

/** The pick step once its three songs are reposted. */
export const PICK_DONE = {
  headline: 'Reposted',
  line: 'Your 3 songs are on your profile.',
};

/** A card's copy as shown in this mode. */
export function lineFor(card: GuideCard, mode: 'first' | 'replay'): string {
  return mode === 'replay' && card.replayLine ? card.replayLine : card.line;
}

/** The cards a given showing uses: a replay drops the first-run-only steps. */
export function cardsFor(mode: 'first' | 'replay'): GuideCard[] {
  return mode === 'first' ? GUIDE_CARDS : GUIDE_CARDS.filter(c => !c.firstRunOnly);
}
