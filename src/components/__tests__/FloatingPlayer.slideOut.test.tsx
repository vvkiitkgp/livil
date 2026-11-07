/**
 * Once the track is gone the player must leave the screen. Its hidden offset only moves it
 * down onto the tab bar, so it has to stop rendering after the slide: closing the player left
 * the wave sitting on the tab bar until something else happened to re-render it.
 */

import React from 'react';
import { Animated } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import FloatingPlayer from '../FloatingPlayer';

jest.mock('react-native-keyboard-controller', () => ({ useKeyboardHandler: jest.fn() }));
jest.mock('react-native-reanimated', () => ({ runOnJS: (fn: unknown) => fn }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-gesture-handler', () => {
  const chain: unknown = new Proxy(() => undefined, { get: () => () => chain });
  return {
    Gesture: { Tap: () => chain, Pan: () => chain, Exclusive: () => chain, Race: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../services/posts', () => ({}));
jest.mock('../../services/jamRooms', () => ({}));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: {} }));
jest.mock('../../hooks/useTrackWaveform', () => ({ useTrackWaveform: () => null }));
jest.mock('../../utils/haptics', () => ({ haptics: {} }));
jest.mock('../../contexts/JamContext', () => ({
  useJam: () => ({ activeJam: null, clearActiveJam: jest.fn() }),
}));
jest.mock('../../contexts/JamRealtimeContext', () => ({ useJamRealtime: () => ({ isHost: false }) }));
jest.mock('../../contexts/JamSuggestionsContext', () => ({
  useJamSuggestions: () => ({ unreadCount: 0 }),
}));
jest.mock('../WaveVisualizer', () => 'WaveVisualizer');
jest.mock('../PlayerCloseTarget', () => 'PlayerCloseTarget');
jest.mock('../JamExitModal', () => 'JamExitModal');
jest.mock('../JamPillAvatar', () => 'JamPillAvatar');
jest.mock('../CoverFallback', () => 'CoverFallback');
jest.mock('../Icon', () => ({ Icon: 'Icon' }));

const song = { postId: 'a', trackId: 't_a', mediaKind: 'audio', audioUrl: 'a.mp3', coverArtUrl: null, thumbnailUrl: null };
const mockPlayback: Record<string, unknown> = {
  nowPlaying: song,
  activePostId: 'a',
  isStoryViewerOpen: false,
  isRepostOpen: false,
  isFullScreenOpen: false,
  isImmersive: false,
  videoFrameBuffering: false,
  jamLocked: false,
  shuffleEnabled: false,
  repeatMode: 'off',
  positionRef: { current: 0 },
  durationRef: { current: 0 },
  handlersRef: { current: null },
  playSourceRef: { current: 'user' },
};
jest.mock('../../contexts/PlaybackContext', () => ({ usePlayback: () => mockPlayback }));

// The real animations finish on the native side, which never answers under Jest.
const finishedAtOnce = () => ({
  start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }),
  stop: () => undefined,
  reset: () => undefined,
});

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<FloatingPlayer />); });
  return tree;
}

function setTrack(tree: ReactTestRenderer, nowPlaying: typeof song | null) {
  mockPlayback.nowPlaying = nowPlaying;
  mockPlayback.activePostId = nowPlaying?.postId ?? null;
  act(() => { tree.update(<FloatingPlayer />); });
}

const waves = (tree: ReactTestRenderer) => tree.root.findAll(n => (n.type as unknown) === 'WaveVisualizer').length;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Animated, 'timing').mockImplementation(finishedAtOnce as never);
  jest.spyOn(Animated, 'spring').mockImplementation(finishedAtOnce as never);
  mockPlayback.nowPlaying = song;
  mockPlayback.activePostId = 'a';
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('FloatingPlayer after the track is gone', () => {
  it('shows the wave while a song is loaded', () => {
    const tree = render();
    expect(waves(tree)).toBe(1);
    act(() => { tree.unmount(); });
  });

  it('removes the wave once it has slid away', () => {
    const tree = render();
    setTrack(tree, null);
    expect(waves(tree)).toBe(0);
    expect(tree.toJSON()).toBeNull();
    act(() => { tree.unmount(); });
  });

  it('comes back for the next song', () => {
    const tree = render();
    setTrack(tree, null);
    setTrack(tree, song);
    expect(waves(tree)).toBe(1);
    act(() => { tree.unmount(); });
  });
});
