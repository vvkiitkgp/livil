/**
 * The Publish gate — `beforePost`.
 *
 * The stepped studio upload splits one `publishTrack` call into "upload and check" and a
 * separate, explicit "publish". That only works if the gate sits exactly between the two:
 * AFTER every byte is up (so the check has something to scan), and BEFORE credits and the
 * post row (so nothing is visible while the artist reviews). And withdrawing at the gate
 * must take the same rollback as any other failure, or a changed mind leaves an uploaded,
 * unposted track in storage forever.
 */
import { configureLivilClient, resetLivilClientForTests } from '../../../shared/client';
import {
  publishTrack,
  UploadCancelledError,
  type PublishCollaborator,
} from '../../../shared/services/publishTrack';

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
  uploaderRole: 'Production',
  // Required since the streaming grant is recorded on every upload.
  termsVersion: '1.0',
  collaborators,
});

const TYPED: PublishCollaborator = { userId: null, customName: 'Session drummer', role: 'Drums' };

let rec: Recorder;
const uploader = async () => {
  rec.uploads++;
  return 'https://example.test/object';
};

beforeEach(() => resetLivilClientForTests());
afterEach(() => resetLivilClientForTests());


describe('publishTrack — the Publish gate', () => {
  it('waits at the gate after uploading and before writing credits or the post', async () => {
    rec = stubClient('none');
    let release!: () => void;
    let reachedGate = false;
    let scanSeen: unknown = 'unset';

    const published = publishTrack(inputWith([TYPED]), uploader, undefined, undefined, scan => {
      reachedGate = true;
      scanSeen = scan;
      // Snapshot at the moment of parking: everything uploaded, nothing visible.
      expect(rec.uploads).toBe(2);
      expect(rec.inserts).not.toContain('track_collaborators');
      expect(rec.inserts).not.toContain('posts');
      // The streaming grant is given by the Publish press, so it is not recorded yet.
      expect(rec.inserts).not.toContain('terms_acceptances');
      return new Promise<void>(resolve => {
        release = resolve;
      });
    });

    // Let the upload chain run up to the gate.
    for (let i = 0; i < 20 && !reachedGate; i++) await Promise.resolve();
    expect(reachedGate).toBe(true);
    // No scan was asked for, so the gate is told so rather than handed a fake result.
    expect(scanSeen).toBeNull();
    expect(rec.inserts).not.toContain('posts');

    release();
    await expect(published).resolves.toMatchObject({ trackId: TRACK_ID, postId: 'post-1' });
    expect(rec.inserts.slice(-3)).toEqual(['terms_acceptances', 'track_collaborators', 'posts']);
  });

  it('rolls everything back when the artist withdraws at the gate', async () => {
    rec = stubClient('none');
    await expect(
      publishTrack(inputWith([]), uploader, undefined, undefined, () =>
        Promise.reject(new UploadCancelledError()),
      ),
    ).rejects.toBeInstanceOf(UploadCancelledError);

    expect(rec.inserts).not.toContain('posts');
    expect(rec.inserts).not.toContain('track_collaborators');
    // No grant recorded for a track that was never published.
    expect(rec.inserts).not.toContain('terms_acceptances');
    expect(rec.deletedTracks).toEqual([TRACK_ID]);
    expect(rec.removed[0]).toHaveLength(2);
  });

  it('posts straight through when no gate is given', async () => {
    rec = stubClient('none');
    await publishTrack(inputWith([]), uploader);
    expect(rec.inserts).toContain('posts');
  });
});
