/**
 * The copied-link check after iOS's "Allow Paste?" question: a copied link that is not a
 * Spotify song gets "Not a Spotify song" — even though the question itself made the app
 * 'inactive' while it was up (owner's iPhone, 2026-10-21: Allow, then nothing). It stays
 * quiet when iOS did not ask, when the person said no, and once Settings was opened from it.
 * On an iPhone the copy is read at most once: a song whose lookup failed is retried from memory.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const YOUTUBE = 'https://music.youtube.com/watch?v=dQw4w9WgXcQ';
const SPOTIFY = 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b';

type MockCopied = { text: string; askedToPaste: boolean };
let mockRead: (value: MockCopied) => void;
let mockSettingsOpened = false;
let mockDetectOn = true;
let mockSpotify = { reposts: true, search: true, copiedLinks: true };
let mockLookup: (id: string) => Promise<{ id: string; title: string } | null>;
const mockReadCopiedText = jest.fn(() => new Promise<MockCopied>(resolve => { mockRead = resolve; }));
const mockOpenPasteSettings = jest.fn(async () => {});
const mockForgetCheckedCopy = jest.fn();

jest.mock('../../services/clipboard', () => ({
  readCopiedText: () => mockReadCopiedText(),
  hasOpenedPasteSettings: async () => mockSettingsOpened,
  isCopiedLinkDetectionOn: async () => mockDetectOn,
  openPasteSettings: () => mockOpenPasteSettings(),
  clearCopiedText: jest.fn(),
  forgetCheckedCopy: () => mockForgetCheckedCopy(),
}));
jest.mock('../../services/spotify', () => ({
  useSpotifyAvailability: () => mockSpotify,
  artistLine: () => 'Rick Astley',
  getSpotifyTrack: (id: string) => mockLookup(id),
  resolveSpotifyLinkCached: async () => null,
}));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: () => false },
  navigateWhenReady: jest.fn(),
}));
jest.mock('../ConfirmActionModal', () => {
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, confirmLabel, cancelLabel, onConfirm, onCancel }: MockModalProps) =>
      visible ? (
        <View>
          <Text>{title}</Text>
          <Text onPress={onConfirm}>{confirmLabel}</Text>
          {cancelLabel ? <Text onPress={onCancel}>{cancelLabel}</Text> : null}
        </View>
      ) : null,
  };
});

type MockModalProps = {
  visible: boolean; title: string; confirmLabel: string; cancelLabel?: string;
  onConfirm: () => void; onCancel: () => void;
};

import SpotifyClipboardPrompt from '../SpotifyClipboardPrompt';

let appState: AppStateStatus;
let emit: (state: AppStateStatus) => void;

const texts = (r: ReactTestRenderer) =>
  r.root.findAll(n => String(n.type) === 'Text').map(n => [n.props.children].flat().join(''));

const press = async (r: ReactTestRenderer, label: string) => {
  const node = r.root.find(n => String(n.type) === 'Text' && n.props.children === label);
  await act(async () => { node.props.onPress(); });
};

/** Opens Livil and lets the check start — it is now waiting on the clipboard read. */
async function open(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<SpotifyClipboardPrompt active />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
  return r;
}

/** iOS shows its question (Livil goes 'inactive'), the person answers, and it closes. */
async function askAndAnswer(value: { text: string; askedToPaste: boolean }) {
  await act(async () => { appState = 'inactive'; emit('inactive'); });
  await act(async () => { mockRead(value); });
  await act(async () => { appState = 'active'; emit('active'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(600); });
}

beforeEach(() => {
  jest.useFakeTimers();
  appState = 'active';
  mockSettingsOpened = false;
  mockDetectOn = true;
  mockSpotify = { reposts: true, search: true, copiedLinks: true };
  mockLookup = async id => ({ id, title: 'Never Gonna Give You Up' });
  mockReadCopiedText.mockClear();
  mockOpenPasteSettings.mockClear();
  mockForgetCheckedCopy.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    emit = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('Allow on a copied non-Spotify link: "Not a Spotify song", despite the question pausing the app', async () => {
  const r = await open();
  await askAndAnswer({ text: YOUTUBE, askedToPaste: true });
  expect(texts(r)).toEqual(expect.arrayContaining(['Not a Spotify song', 'Open Settings', 'Got it']));
});

it('the read resolves while the app is still paused behind the question: it still shows', async () => {
  const r = await open();
  await act(async () => { appState = 'inactive'; emit('inactive'); });
  await act(async () => { mockRead({ text: YOUTUBE, askedToPaste: true }); });
  expect(texts(r)).toContain('Not a Spotify song');
});

it('Allow on a copied Spotify song: the repost question, not the apology', async () => {
  const r = await open();
  await askAndAnswer({ text: SPOTIFY, askedToPaste: true });
  expect(texts(r)).toContain('Repost the song you copied?');
  expect(texts(r)).not.toContain('Not a Spotify song');
  expect(mockForgetCheckedCopy).not.toHaveBeenCalled();
});

it('stays quiet when iOS did not ask, when the person said no, or after Settings was opened', async () => {
  let r = await open();
  await askAndAnswer({ text: YOUTUBE, askedToPaste: false }); // Livil's own copy / Paste = Allow
  expect(texts(r)).toEqual([]);

  r = await open();
  await askAndAnswer({ text: '', askedToPaste: true }); // "Don't Allow"
  expect(texts(r)).toEqual([]);

  mockSettingsOpened = true;
  r = await open();
  await askAndAnswer({ text: YOUTUBE, askedToPaste: true });
  expect(texts(r)).toEqual([]);
});

it('Open Settings closes the note and opens Livil\'s page in iPhone Settings', async () => {
  const r = await open();
  await askAndAnswer({ text: YOUTUBE, askedToPaste: true });
  await press(r, 'Open Settings');
  expect(mockOpenPasteSettings).toHaveBeenCalledTimes(1);
  expect(texts(r)).toEqual([]);
});

it('leaving Livil with the repost question up asks again next time; a pause does not', async () => {
  const r = await open();
  await act(async () => { mockRead({ text: SPOTIFY, askedToPaste: true }); });
  expect(texts(r)).toContain('Repost the song you copied?');

  await act(async () => { appState = 'inactive'; emit('inactive'); }); // Control Center
  expect(texts(r)).toContain('Repost the song you copied?');
  expect(mockForgetCheckedCopy).not.toHaveBeenCalled();

  await act(async () => { appState = 'background'; emit('background'); });
  expect(texts(r)).toEqual([]);
  expect(mockForgetCheckedCopy).toHaveBeenCalledTimes(1);
});

/** Leaves Livil and comes back, which starts the next check. */
async function leaveAndReturn() {
  await act(async () => { appState = 'background'; emit('background'); });
  await act(async () => { appState = 'active'; emit('active'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
}

it('the return after iOS\'s question does not start a second read while the first waits', async () => {
  await open();
  await act(async () => { appState = 'inactive'; emit('inactive'); });
  await act(async () => { appState = 'active'; emit('active'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(600); });
  expect(mockReadCopiedText).toHaveBeenCalledTimes(1);
});

it('no check starts while a shade is down: the copy is not used up unseen', async () => {
  await act(async () => { create(<SpotifyClipboardPrompt active />); });
  await act(async () => { appState = 'inactive'; emit('inactive'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(600); });
  expect(mockReadCopiedText).not.toHaveBeenCalled();
});

it('iPhone, Allow on a Spotify song while offline: the next return offers it, without reading again', async () => {
  mockLookup = async () => null; // offline
  const r = await open();
  await act(async () => { mockRead({ text: SPOTIFY, askedToPaste: true }); });
  expect(texts(r)).toEqual([]);

  mockLookup = async id => ({ id, title: 'Never Gonna Give You Up' });
  await leaveAndReturn();
  await act(async () => { mockRead({ text: '', askedToPaste: false }); }); // same copy: not read
  expect(texts(r)).toContain('Repost the song you copied?');
});

it('iPhone, the same Spotify link copied again after "Not now": offered again', async () => {
  const r = await open();
  await act(async () => { mockRead({ text: SPOTIFY, askedToPaste: true }); });
  await press(r, 'Not now');

  await leaveAndReturn();
  await act(async () => { mockRead({ text: SPOTIFY, askedToPaste: true }); }); // a new copy
  expect(texts(r)).toContain('Repost the song you copied?');
});

it('the song lookup finishes after Livil was left: the next open asks again', async () => {
  let finish!: (track: { id: string; title: string }) => void;
  mockLookup = () => new Promise(resolve => { finish = resolve; });
  const r = await open();
  await act(async () => { mockRead({ text: SPOTIFY, askedToPaste: true }); });
  await act(async () => { appState = 'background'; emit('background'); });
  await act(async () => { finish({ id: 'x', title: 'Never Gonna Give You Up' }); });
  expect(texts(r)).toEqual([]);
  expect(mockForgetCheckedCopy).toHaveBeenCalledTimes(1);
});

describe('the off switches: no clipboard check at all', () => {
  it('the server kill switch is off', async () => {
    mockSpotify = { reposts: true, search: true, copiedLinks: false };
    await open();
    expect(mockReadCopiedText).not.toHaveBeenCalled();
  });

  it('Spotify reposts are off', async () => {
    mockSpotify = { reposts: false, search: true, copiedLinks: true };
    await open();
    expect(mockReadCopiedText).not.toHaveBeenCalled();
  });

  it('the person turned "Detect copied Spotify links" off on this phone', async () => {
    mockDetectOn = false;
    await open();
    expect(mockReadCopiedText).not.toHaveBeenCalled();
  });
});
