/**
 * What a reply shows of the message it answers. Pins: a song — Livil or Spotify — quotes
 * as a song row (title + artist), never as its raw link; everything else is its text.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { ChatMessage } from '../../services/messages';

const ID = '4cOdK2wGLETKBW3PvgPWqT';
jest.mock('../../services/spotify', () => ({
  artistLine: (t: { artists: string[] } | null) => t?.artists.join(', ') ?? 'Spotify',
  resolveSpotifyLinkCached: () => Promise.resolve(null),
  useSpotifyTrack: (id: string | null) =>
    id
      ? { status: 'ready', track: { id, title: 'Blinding Lights', artists: ['The Weeknd'], imageUrl: null } }
      : { status: 'unavailable', track: null },
}));
jest.mock('../Logo', () => ({ Logo: () => null }));
jest.mock('../SpotifyLogo', () => ({ SpotifyLogo: () => null }));

import { ChatReplySnippet } from '../ChatReplySnippet';

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1', conversationId: 'c1', senderId: 'u1', kind: 'text', body: null, metadata: null,
    replyToId: null, createdAt: '2026-10-09T00:00:00Z', deletedAt: null,
    senderUsername: 'vamsi', senderDisplayName: 'Vamsi', senderAvatarUrl: null, reactions: [],
    ...over,
  };
}

async function texts(message: ChatMessage | null): Promise<string[]> {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<ChatReplySnippet message={message} tone="me" />); });
  return r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
}

it('a Spotify link quotes as the song, not the URL', async () => {
  const shown = await texts(msg({ body: `https://open.spotify.com/track/${ID}?si=abc` }));
  expect(shown).toEqual(expect.arrayContaining(['Blinding Lights', 'The Weeknd']));
  expect(shown.join(' ')).not.toContain('open.spotify.com');
});

it('a Livil song quotes as the same kind of row', async () => {
  const shown = await texts(msg({
    kind: 'track_share',
    metadata: { title: 'Monsoon Letters', artist_name: 'riya.wav', cover_art_url: null },
  }));
  expect(shown).toEqual(['Monsoon Letters', 'riya.wav']);
});

it('ordinary text is the text', async () => {
  expect(await texts(msg({ body: 'see you at 8' }))).toEqual(['see you at 8']);
});

it('a profile link reads as whose profile it is', async () => {
  expect(await texts(msg({ body: 'https://livil-music.com/@riya' }))).toEqual(["@riya's profile"]);
});

it('an original that is not loaded says to tap', async () => {
  expect(await texts(null)).toEqual(['Tap to view']);
});
