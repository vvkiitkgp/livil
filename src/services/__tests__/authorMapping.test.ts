// The mappers under test are pure, but importing their modules pulls in the Supabase
// client and the upload/audio stacks, which resolve native modules at load time. Only
// those native shims are stubbed — no query, client or mapper behaviour is mocked.
// Extracting the mappers into a module with no I/O imports would remove the need for
// this; PROP-0006 proposes that separately.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('react-native-audio-api', () => ({ decodeAudioData: jest.fn() }));

import { toCollaboratorInfo } from '../tracks';
import { toJamRoomState, toQueueItem } from '../jamRooms';
import { toConversationDetails } from '../conversations';

describe('toCollaboratorInfo', () => {
  const role = 'Producer';
  // Rows come back from the table with a status; 'pending' is the default every credit
  // starts at, so it is the honest default for a fixture.
  const row = (over: Partial<Parameters<typeof toCollaboratorInfo>[0]>) => ({
    user_id: null,
    custom_name: null,
    role,
    status: 'pending',
    ...over,
  });

  it('shows the profile display name for a live collaborator', () => {
    const c = toCollaboratorInfo(
      row({ user_id: 'u1' }),
      { username: 'vvk', display_name: 'Vamsi', avatar_url: 'https://a/1.png' },
    );
    expect(c.userId).toBe('u1');
    expect(c.display.name).toBe('Vamsi');
    expect(c.display.isDeleted).toBe(false);
    expect(c.avatarUrl).toBe('https://a/1.png');
  });

  it('falls back to the username when the profile has no display name', () => {
    const c = toCollaboratorInfo(
      row({ user_id: 'u1' }),
      { username: 'vvk', display_name: null, avatar_url: null },
    );
    expect(c.display.name).toBe('vvk');
    expect(c.display.initial).toBe('V');
    expect(c.display.isDeleted).toBe(false);
  });

  it('shows [deleted] for a credit whose account was deleted', () => {
    const c = toCollaboratorInfo(row({}), undefined);
    expect(c.userId).toBeNull();
    expect(c.display.name).toBe('[deleted]');
    expect(c.display.isDeleted).toBe(true);
    expect(c.display.initial).toBe('?');
  });

  it('never derives the avatar initial from the deleted placeholder', () => {
    const c = toCollaboratorInfo(row({}), undefined);
    expect(c.display.initial).not.toBe('[');
  });

  it('keeps a custom-name credit as a real name, not deleted', () => {
    const c = toCollaboratorInfo(row({ custom_name: 'DJ Snake' }), undefined);
    expect(c.display.name).toBe('DJ Snake');
    expect(c.display.isDeleted).toBe(false);
    expect(c.userId).toBeNull();
    expect(c.avatarUrl).toBeNull();
  });

  // fetchTrackCollaborators discards its profile-query error, so a missing profile
  // for a linked credit means the join missed — not that the account is gone.
  it('does not call a linked credit deleted when the profile join returned nothing', () => {
    const c = toCollaboratorInfo(row({ user_id: 'u9' }), undefined);
    expect(c.userId).toBe('u9');
    expect(c.display.isDeleted).toBe(false);
    expect(c.display.name).not.toBe('[deleted]');
    expect(c.display.initial).toBe('?');
  });

  it('marks an unanswered credit as pending, and a confirmed one as accepted', () => {
    // The product rule: a pending credit still shows, marked. So the status has to survive
    // the mapping — dropping it would silently present every credit as confirmed.
    expect(toCollaboratorInfo(row({ user_id: 'u1' }), undefined).status).toBe('pending');
    expect(
      toCollaboratorInfo(row({ user_id: 'u1', status: 'accepted' }), undefined).status,
    ).toBe('accepted');
  });

  it('never marks a typed-in name as awaiting confirmation', () => {
    // There is no account behind it, so nobody can ever confirm — showing it as pending
    // would be a question addressed to nobody.
    expect(toCollaboratorInfo(row({ custom_name: 'DJ Snake' }), undefined).status).toBe('accepted');
  });

  it('carries the role through unchanged', () => {
    expect(toCollaboratorInfo(row({ role: 'Mixing' }), undefined).role)
      .toBe('Mixing');
  });
});

describe('toJamRoomState', () => {
  const base = {
    jam_room_id: 'j1',
    host_username: 'vvk',
    playback_position_ms: 1234,
    is_playing: true,
    host_clock_at: '2026-07-29T00:00:00Z',
  };

  it('carries a present host id through', () => {
    expect(toJamRoomState({ ...base, host_id: 'u1' }).hostId).toBe('u1');
  });

  it('reports a deleted host as null rather than claiming a string', () => {
    const s = toJamRoomState({ ...base, host_id: null });
    expect(s.hostId).toBeNull();
    expect(s.hostId).not.toBe('null');
  });

  it('treats a missing host_id key as null', () => {
    expect(toJamRoomState(base).hostId).toBeNull();
  });

  it('grants nobody host control when the host id is null', () => {
    const s = toJamRoomState({ ...base, host_id: null });
    expect(s.hostId === 'u1').toBe(false);
    expect(s.hostId === '').toBe(false);
  });

  it('leaves the playback fields untouched by the host change', () => {
    const s = toJamRoomState({ ...base, host_id: null });
    expect(s.jamRoomId).toBe('j1');
    expect(s.hostUsername).toBe('vvk');
    expect(s.playbackPositionMs).toBe(1234);
    expect(s.isPlaying).toBe(true);
    expect(s.hostClockAt).toBe('2026-07-29T00:00:00Z');
  });
});

describe('toQueueItem', () => {
  const row = { id: 'q1', track_id: 't1', suggested_by: 'u1', position: 0, upvotes: 2 };
  const track = { title: 'Song', cover_art_url: 'https://c/1.png', uploader_id: 'u2' };

  it('shows the suggester display name when the account is live', () => {
    const q = toQueueItem(
      row, track,
      { username: 'up', displayName: 'Uploader' },
      { username: 'vvk', displayName: 'Vamsi' },
    );
    expect(q.suggestedById).toBe('u1');
    expect(q.suggestedBy.name).toBe('Vamsi');
    expect(q.suggestedBy.isDeleted).toBe(false);
  });

  it('shows [deleted] when suggested_by was nulled by account deletion', () => {
    const q = toQueueItem({ ...row, suggested_by: null }, track, { username: 'up', displayName: 'Uploader' }, null);
    expect(q.suggestedById).toBeNull();
    expect(q.suggestedBy.name).toBe('[deleted]');
    expect(q.suggestedBy.isDeleted).toBe(true);
    expect(q.suggestedBy.initial).toBe('?');
  });

  it('does not call a live suggester deleted when the profile join missed', () => {
    const q = toQueueItem(row, track, null, null);
    expect(q.suggestedById).toBe('u1');
    expect(q.suggestedBy.isDeleted).toBe(false);
    expect(q.suggestedBy.name).not.toBe('[deleted]');
  });

  it('leaves the track fields untouched by the author change', () => {
    const q = toQueueItem({ ...row, suggested_by: null }, track, { username: 'up', displayName: null }, null);
    expect(q.trackTitle).toBe('Song');
    expect(q.trackArtist).toBe('up');
    expect(q.trackCoverArt).toBe('https://c/1.png');
    expect(q.position).toBe(0);
    expect(q.upvotes).toBe(2);
  });

  it('nulls the track fields when the track row is missing', () => {
    const q = toQueueItem(row, undefined, null, { username: 'vvk', displayName: 'Vamsi' });
    expect(q.trackTitle).toBeNull();
    expect(q.trackArtist).toBeNull();
    expect(q.trackCoverArt).toBeNull();
  });
});

describe('toConversationDetails', () => {
  const row = { id: 'c1', kind: 'group', name: 'Studio', created_by: 'u1' };

  it('resolves a live creator', () => {
    const d = toConversationDetails(row, { username: 'vvk', display_name: 'Vamsi' });
    expect(d.createdById).toBe('u1');
    expect(d.createdBy.name).toBe('Vamsi');
    expect(d.createdBy.isDeleted).toBe(false);
    expect(d.name).toBe('Studio');
    expect(d.kind).toBe('group');
  });

  it('shows [deleted] when created_by was nulled by account deletion', () => {
    const d = toConversationDetails({ ...row, created_by: null }, null);
    expect(d.createdById).toBeNull();
    expect(d.createdBy.name).toBe('[deleted]');
    expect(d.createdBy.isDeleted).toBe(true);
    expect(d.createdBy.initial).toBe('?');
  });

  it('does not call a live creator deleted when the profile join missed', () => {
    const d = toConversationDetails(row, null);
    expect(d.createdById).toBe('u1');
    expect(d.createdBy.isDeleted).toBe(false);
    expect(d.createdBy.name).not.toBe('[deleted]');
  });

  it('does not confuse an unnamed group with a deleted creator', () => {
    const d = toConversationDetails({ ...row, name: null }, { username: 'vvk', display_name: 'Vamsi' });
    expect(d.name).toBeNull();
    expect(d.createdBy.isDeleted).toBe(false);
    expect(d.createdBy.name).toBe('Vamsi');
  });
});
