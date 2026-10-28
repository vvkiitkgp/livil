/**
 * The "Did you like the song? Repost it on Livil" card that follows a hand-off to Spotify:
 * a native timed notification, only while the person is away, capped, and gone the moment
 * Livil is in front again.
 */
const mockCreateTrigger = jest.fn(async (..._a: unknown[]) => 'id');
const mockCancel = jest.fn(async (_id: string) => {});
const mockCreateChannel = jest.fn(async (..._a: unknown[]) => 'spotify_return');
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createTriggerNotification: (...a: unknown[]) => mockCreateTrigger(...a),
    cancelNotification: (id: string) => mockCancel(id),
    createChannel: (...a: unknown[]) => mockCreateChannel(...a),
  },
  AndroidImportance: { HIGH: 4 },
  TriggerType: { TIMESTAMP: 0 },
}));

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v); },
  },
}));

let mockAppStateHandler: ((s: string) => void) | null = null;
jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 35 },
  AppState: {
    currentState: 'active',
    addEventListener: (_e: string, h: (s: string) => void) => { mockAppStateHandler = h; return { remove: jest.fn() }; },
  },
}));

const mockGranted = jest.fn(async () => true);
const mockStatus = jest.fn(async () => 'accepted');
const mockOffFor = jest.fn(async (_u: string) => false);
jest.mock('../pushNotifications', () => ({
  notificationPermissionGranted: () => mockGranted(),
  getPushPromptStatus: () => mockStatus(),
  isPushOffFor: (u: string) => mockOffFor(u),
}));
jest.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) } },
}));
const mockPeek = jest.fn((_id: string): { title: string; imageUrl: string | null } | null => null);
jest.mock('../spotify', () => ({ peekSpotifyTrack: (id: string) => mockPeek(id) }));
jest.mock('../appBadge', () => ({ LIVIL_NOTIFICATION_ID_PREFIX: 'livil:' }));
jest.mock('../../theme/colors', () => ({ COLORS: { purple: '#8B3DFF' } }));

import {
  SPOTIFY_RETURN_DAILY_CAP,
  SPOTIFY_RETURN_DELAY_MS,
  SPOTIFY_RETURN_NOTIFICATION_ID,
  SPOTIFY_RETURN_STORAGE_KEY,
  clearSpotifyReturnNudge,
  mayNudge,
  nextLog,
  scheduleSpotifyReturnNudge,
} from '../spotifyReturnNudge';

const ID = '0VjIjW4GlUZAMYd2vXMi3b';
const OTHER = '4uLU6hMCjMI75M1A2tKUQC';

type Shown = { id: string; title: string; body: string; data: Record<string, string>; android: Record<string, unknown> };
const shown = (call = 0): Shown => mockCreateTrigger.mock.calls[call][0] as Shown;
const trigger = (call = 0) => mockCreateTrigger.mock.calls[call][1] as { type: number; timestamp: number };

beforeEach(() => {
  mockStore.clear();
  mockCreateTrigger.mockClear();
  mockCancel.mockClear();
  mockGranted.mockResolvedValue(true);
  mockStatus.mockResolvedValue('accepted');
  mockOffFor.mockResolvedValue(false);
  mockPeek.mockReturnValue(null);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('scheduling', () => {
  it('schedules a silent card 3 s out whose tap opens Repost with that song', async () => {
    const before = Date.now();
    await scheduleSpotifyReturnNudge(ID);
    expect(mockCreateTrigger).toHaveBeenCalledTimes(1);
    const card = shown();
    expect(card.id).toBe(SPOTIFY_RETURN_NOTIFICATION_ID);
    expect(card.title).toBe('Did you like the song?');
    expect(card.data).toEqual({ route: 'SpotifyRepost', spotifyTrackId: ID });
    expect(card.android.channelId).toBe('spotify_return');
    expect(card.android.badgeCount).toBe(0);
    expect(trigger().timestamp).toBeGreaterThanOrEqual(before + SPOTIFY_RETURN_DELAY_MS);
    // The channel it lands on makes no sound and does not count on the launcher.
    expect(mockCreateChannel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'spotify_return', vibration: false, badge: false,
    }));
    expect(mockCreateChannel.mock.calls[0][0]).not.toHaveProperty('sound');
  });

  it('names the song when it is already known', async () => {
    mockPeek.mockReturnValue({ title: 'Blinding Lights', imageUrl: 'https://i.scdn.co/x.jpg' });
    await scheduleSpotifyReturnNudge(ID);
    expect(shown().title).toBe('Did you like “Blinding Lights”?');
    expect(shown().android.largeIcon).toBe('https://i.scdn.co/x.jpg');
  });

  it('nothing without the phone permission, or with Livil notifications switched off', async () => {
    mockGranted.mockResolvedValue(false);
    await scheduleSpotifyReturnNudge(ID);
    mockGranted.mockResolvedValue(true);
    mockStatus.mockResolvedValue('off');
    mockOffFor.mockResolvedValue(true);
    await scheduleSpotifyReturnNudge(ID);
    expect(mockCreateTrigger).not.toHaveBeenCalled();
  });

  it('rejects anything that is not a Spotify id', async () => {
    await scheduleSpotifyReturnNudge('not-a-spotify-id');
    expect(mockCreateTrigger).not.toHaveBeenCalled();
  });

  it('a notifee failure is swallowed — the hand-off already happened', async () => {
    mockCreateTrigger.mockRejectedValueOnce(new Error('no notifee'));
    await expect(scheduleSpotifyReturnNudge(ID)).resolves.toBeUndefined();
  });
});

describe('the cap', () => {
  it('not twice for the same song, and at most three a day', async () => {
    await scheduleSpotifyReturnNudge(ID);
    await scheduleSpotifyReturnNudge(ID);
    expect(mockCreateTrigger).toHaveBeenCalledTimes(1);
    await scheduleSpotifyReturnNudge(OTHER);
    await scheduleSpotifyReturnNudge(ID);
    expect(mockCreateTrigger).toHaveBeenCalledTimes(SPOTIFY_RETURN_DAILY_CAP);
    await scheduleSpotifyReturnNudge(OTHER);
    expect(mockCreateTrigger).toHaveBeenCalledTimes(SPOTIFY_RETURN_DAILY_CAP);
    expect(JSON.parse(mockStore.get(SPOTIFY_RETURN_STORAGE_KEY) ?? '{}')).toMatchObject({ count: 3, lastTrackId: ID });
  });

  it('resets with the day (pure helpers)', () => {
    const full = { day: '2026-10-27', count: 3, lastTrackId: ID };
    expect(mayNudge(full, OTHER, '2026-10-27')).toBe(false);
    expect(mayNudge(full, ID, '2026-10-28')).toBe(true);
    expect(nextLog(full, ID, '2026-10-28')).toEqual({ day: '2026-10-28', count: 1, lastTrackId: ID });
    expect(nextLog({ day: '2026-10-28', count: 1, lastTrackId: ID }, OTHER, '2026-10-28')).toEqual({
      day: '2026-10-28', count: 2, lastTrackId: OTHER,
    });
  });
});

describe('coming back', () => {
  it('returning to Livil cancels the card, fired or not', async () => {
    await scheduleSpotifyReturnNudge(ID);
    expect(mockAppStateHandler).not.toBeNull();
    mockAppStateHandler!('active');
    await Promise.resolve();
    expect(mockCancel).toHaveBeenCalledWith(SPOTIFY_RETURN_NOTIFICATION_ID);
  });

  it('back before the checks finished: no card is created at all', async () => {
    let release!: () => void;
    mockGranted.mockImplementationOnce(() => new Promise<boolean>(r => { release = () => r(true); }));
    const pending = scheduleSpotifyReturnNudge(ID);
    await Promise.resolve();
    mockAppStateHandler!('active');
    release();
    await pending;
    expect(mockCreateTrigger).not.toHaveBeenCalled();
  });

  it('clearSpotifyReturnNudge is safe when nothing is pending or notifee fails', async () => {
    mockCancel.mockRejectedValueOnce(new Error('gone'));
    await expect(clearSpotifyReturnNudge()).resolves.toBeUndefined();
    await expect(clearSpotifyReturnNudge()).resolves.toBeUndefined();
  });
});
