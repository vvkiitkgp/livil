/**
 * Credits, as part of publishing.
 *
 * Two claims are pinned here, and both are about ORDER rather than about the insert itself.
 *
 * `createTrack` on mobile writes credits AFTER the post row exists, so a failed insert
 * leaves a published, uncredited track and an error on screen with nothing to retry. The
 * shared path writes them first, which means a credit failure takes the whole publish down
 * with it and nothing ever reaches a feed. That is only true while the calls stay in this
 * order, and nothing about the code makes the order obvious — hence a test.
 *
 * The second claim is that a malformed credit is rejected BEFORE any bytes move. The
 * database would catch it (`collab_user_xor_custom`), but only after a full master has
 * uploaded and the rollback has thrown it away.
 */
import { configureLivilClient, resetLivilClientForTests } from '../../../shared/client';
import { publishTrack, type PublishCollaborator } from '../../../shared/services/publishTrack';

const USER_ID = '8b2c821a-808e-4c70-9445-6529755a92d8';
const TRACK_ID = '5610bec6-9af1-4c0d-9ec0-9f934d421f98';

type Recorder = {
  /** Table name per insert, in call order. */
  inserts: string[];
  collaboratorRows: Array<Record<string, unknown>>;
  deletedTracks: string[];
  removed: string[][];
  uploads: number;
};

function stubClient(failAt: 'none' | 'collaborators') {
  const rec: Recorder = {
    inserts: [],
    collaboratorRows: [],
    deletedTracks: [],
    removed: [],
    uploads: 0,
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from(table: string) {
      return {
        insert(row: unknown) {
          rec.inserts.push(table);
          if (table === 'track_collaborators') {
            rec.collaboratorRows.push(...(row as Array<Record<string, unknown>>));
            // The collaborators insert is NOT chained with .select() — it returns directly.
            return Promise.resolve(
              failAt === 'collaborators'
                ? { error: { message: 'credits insert exploded' } }
                : { error: null },
            );
          }
          return {
            select: () => ({
              single: async () => ({
                data: { id: table === 'tracks' ? TRACK_ID : 'post-1' },
                error: null,
              }),
            }),
          };
        },
        update() {
          return { eq: async () => ({ error: null }) };
        },
        delete() {
          return {
            eq: async (_col: string, id: string) => {
              rec.deletedTracks.push(id);
              return { error: null };
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          remove: async (paths: string[]) => {
            rec.removed.push(paths);
            return { data: null, error: null };
          },
        };
      },
    },
  };

  configureLivilClient(client as never);
  return rec;
}

const ASSETS = [
  { kind: 'audio' as const, fileName: 'a.mp3', contentType: 'audio/mpeg', sizeBytes: 100 },
  { kind: 'cover' as const, fileName: 'c.jpg', contentType: 'image/jpeg', sizeBytes: 10 },
];

const inputWith = (collaborators: PublishCollaborator[]) => ({
  mode: 'audio' as const,
  title: 'Probe',
  assets: ASSETS,
  collaborators,
});

const PROFILE: PublishCollaborator = { userId: USER_ID, customName: null, role: 'Mixing' };
const TYPED: PublishCollaborator = { userId: null, customName: 'Session drummer', role: 'Drums' };

let rec: Recorder;
const uploader = async () => {
  rec.uploads++;
  return 'https://example.test/object';
};

beforeEach(() => resetLivilClientForTests());
afterEach(() => resetLivilClientForTests());

describe('publishTrack — credits', () => {
  it('writes the credits BEFORE the post row', async () => {
    // The whole point: while no post exists, a credit failure can still take everything
    // down. Reversed, a failure would strand a live, uncredited track.
    rec = stubClient('none');
    await publishTrack(inputWith([PROFILE, TYPED]), uploader);
    expect(rec.inserts).toEqual(['tracks', 'track_collaborators', 'posts']);
  });

  it('stores a profile credit and a typed credit as different columns', async () => {
    rec = stubClient('none');
    await publishTrack(inputWith([PROFILE, TYPED]), uploader);
    expect(rec.collaboratorRows).toEqual([
      { track_id: TRACK_ID, user_id: USER_ID, custom_name: null, role: 'Mixing' },
      { track_id: TRACK_ID, user_id: null, custom_name: 'Session drummer', role: 'Drums' },
    ]);
  });

  it('never inserts an empty credits row set', async () => {
    rec = stubClient('none');
    await publishTrack(inputWith([]), uploader);
    expect(rec.inserts).toEqual(['tracks', 'posts']);
  });

  it('rolls the whole publish back when the credits insert fails', async () => {
    rec = stubClient('collaborators');
    await expect(publishTrack(inputWith([PROFILE]), uploader)).rejects.toThrow(
      /credits insert exploded/,
    );
    // No post was ever created, and the track and its objects are gone — so there is no
    // published track missing its credits.
    expect(rec.inserts).not.toContain('posts');
    expect(rec.deletedTracks).toEqual([TRACK_ID]);
    expect(rec.removed[0]).toHaveLength(2);
  });

  it('trims the role and the typed name on the way in', async () => {
    rec = stubClient('none');
    await publishTrack(
      inputWith([{ userId: null, customName: '  Ana  ', role: '  Vocals  ' }]),
      uploader,
    );
    expect(rec.collaboratorRows[0]).toMatchObject({ custom_name: 'Ana', role: 'Vocals' });
  });

  it('drops a stray customName when a profile is credited', async () => {
    // Belt and braces on the XOR: validation rejects it, but if a caller ever gets past
    // that, what reaches the table must still satisfy `collab_user_xor_custom`.
    rec = stubClient('none');
    await publishTrack(inputWith([{ ...PROFILE }]), uploader);
    expect(rec.collaboratorRows[0]!.custom_name).toBeNull();
  });
});

describe('publishTrack — credit validation happens before anything uploads', () => {
  const rejects = async (collaborators: PublishCollaborator[], message: RegExp) => {
    rec = stubClient('none');
    await expect(publishTrack(inputWith(collaborators), uploader)).rejects.toThrow(message);
    // Nothing was created and nothing was sent — the point of validating up front.
    expect(rec.inserts).toEqual([]);
    expect(rec.uploads).toBe(0);
  };

  it('rejects a credit that names nobody', () =>
    rejects([{ userId: null, customName: '   ', role: 'Drums' }], /profile or a name/));

  it('rejects a credit that names both', () =>
    rejects([{ userId: USER_ID, customName: 'Ana', role: 'Drums' }], /profile or a name/));

  it('rejects a blank role', () =>
    rejects([{ userId: USER_ID, customName: null, role: '  ' }], /needs a role/));

  it('rejects a role longer than the column allows', () =>
    rejects([{ userId: USER_ID, customName: null, role: 'x'.repeat(41) }], /40 characters/));
});
