/**
 * "Play on Spotify". With the notice (feed, chat, search): it hands off only after the
 * notice. Without it (Repost a song, SpotifyRepostScreen — an iOS sheet the notice cannot appear over):
 * straight to Spotify. Either way Livil pauses first and the open is counted once.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockPause = jest.fn();
jest.mock('../../contexts/PlaybackContext', () => ({
  usePlayback: () => ({ activePostId: 'p1', handlersRef: { current: { pause: mockPause } }, pauseAll: jest.fn() }),
}));
jest.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../../utils/haptics', () => ({ haptics: { tap: jest.fn() } }));
const mockOpen = jest.fn(async (_id: string) => true);
const mockRecord = jest.fn();
jest.mock('../../services/spotify', () => ({
  openInSpotify: (id: string) => mockOpen(id),
  recordSpotifyOpen: (id: string, source: string) => mockRecord(id, source),
}));
const mockRequestNotice = jest.fn(async (..._a: unknown[]) => {});
jest.mock('../../components/OnboardingNotice', () => ({
  requestNotice: (...a: unknown[]) => mockRequestNotice(...a),
}));

import { useOpenInSpotify } from '../useOpenInSpotify';

const ID = '0VjIjW4GlUZAMYd2vXMi3b';

function hook(options?: { notice?: boolean }) {
  let open!: (id: string) => Promise<void>;
  function Probe() { open = useOpenInSpotify('search', options); return null; }
  act(() => { TestRenderer.create(<Probe />); });
  return () => open;
}

beforeEach(() => { mockPause.mockClear(); mockOpen.mockClear(); mockRecord.mockClear(); mockRequestNotice.mockClear(); });

it('with the notice: nothing opens until the notice says go', async () => {
  const open = hook();
  await act(async () => { await open()(ID); });
  expect(mockRequestNotice).toHaveBeenCalledWith('spotify', expect.any(Function));
  expect(mockOpen).not.toHaveBeenCalled();
});

it('without the notice: pauses Livil and opens Spotify at once, counted once', async () => {
  const open = hook({ notice: false });
  await act(async () => { await open()(ID); });
  expect(mockRequestNotice).not.toHaveBeenCalled();
  expect(mockPause).toHaveBeenCalledTimes(1);
  expect(mockOpen).toHaveBeenCalledWith(ID);
  expect(mockRecord).toHaveBeenCalledWith(ID, 'search');
});
