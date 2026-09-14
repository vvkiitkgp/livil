/**
 * The failure path of publishTrack.
 *
 * This code only runs when a publish breaks partway, which means it never runs during
 * ordinary use and nothing would notice if it silently stopped working. The consequence of
 * it not working is not a crash — it is a full audio master left in a PUBLIC bucket with no
 * row referencing it: invisible to the artist, untouched by any cleanup, permanent.
 *
 * Found by security review of PR #124.
 */
import {
  configureLivilClient,
  resetLivilClientForTests,
} from '../../../shared/client';
import { publishTrack } from '../../../shared/services/publishTrack';

const USER_ID = '8b2c821a-808e-4c70-9445-6529755a92d8';
const TRACK_ID = '5610bec6-9af1-4c0d-9ec0-9f934d421f98';

type Recorder = {
  removed: string[][];
  deletedTracks: string[];
  /** Actual call order, so ordering can be asserted rather than inferred. */
  calls: string[];
};

/**
 * Minimal stand-in for the Supabase client, chainable exactly as far as publishTrack
 * reaches. `failAt` picks which step breaks, so each test exercises a real failure point
 * rather than a synthetic throw.
 */
function stubClient(failAt: 'none' | 'update' | 'post') {
  const rec: Recorder = { removed: [], deletedTracks: [], calls: [] };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from(table: string) {
      return {
        insert(_row: unknown) {
          return {
            select: () => ({
              single: async () =>
                table === 'posts' && failAt === 'post'
                  ? { data: null, error: { message: 'posts insert exploded' } }
                  : { data: { id: table === 'tracks' ? TRACK_ID : 'post-1' }, error: null },
            }),
          };
        },
        update(_row: unknown) {
          return {
            eq: async () =>
              failAt === 'update'
                ? { error: { message: 'update exploded' } }
                : { error: null },
          };
        },
        delete() {
          return {
            eq: async (_col: string, id: string) => {
              rec.deletedTracks.push(id);
              rec.calls.push('delete');
              return { error: null };
            },
          };
        },
      };
    },
    storage: {
      from(_bucket: string) {
        return {
          remove: async (paths: string[]) => {
            rec.removed.push(paths);
            rec.calls.push('remove');
            return { data: null, error: null };
          },
        };
      },
    },
  };

  // The seam types this as a real SupabaseClient; the stub only implements the reachable
  // surface, so the cast is load-bearing and deliberate.
  configureLivilClient(client as never);
  return rec;
}

const INPUT = {
  mode: 'audio' as const,
  title: 'Probe',
  uploaderRole: 'Production',
  assets: [
    { kind: 'audio' as const, fileName: 'a.mp3', contentType: 'audio/mpeg', sizeBytes: 100 },
    { kind: 'cover' as const, fileName: 'c.jpg', contentType: 'image/jpeg', sizeBytes: 10 },
  ],
};

const uploader = async () => 'https://example.test/object';

beforeEach(() => resetLivilClientForTests());
afterEach(() => resetLivilClientForTests());

describe('publishTrack — cleanup when a publish fails', () => {
  it('removes uploaded objects when the posts insert fails', async () => {
    const rec = stubClient('post');
    await expect(publishTrack(INPUT, uploader)).rejects.toThrow(/posts insert exploded/);

    expect(rec.removed).toHaveLength(1);
    expect(rec.removed[0]!.sort()).toEqual([
      `${USER_ID}/${TRACK_ID}/audio.mp3`,
      `${USER_ID}/${TRACK_ID}/cover.jpg`,
    ]);
  });

  it('removes uploaded objects when finalizing the row fails', async () => {
    const rec = stubClient('update');
    await expect(publishTrack(INPUT, uploader)).rejects.toThrow(/update exploded/);
    expect(rec.removed[0]).toHaveLength(2);
  });

  it('still deletes the track row, so no half-published track reaches a feed', async () => {
    const rec = stubClient('post');
    await expect(publishTrack(INPUT, uploader)).rejects.toThrow();
    expect(rec.deletedTracks).toEqual([TRACK_ID]);
  });

  it('removes the objects BEFORE deleting the row', async () => {
    // Order matters: if the row went first and removal then failed, the files would be
    // both unreachable and unreferenced — the exact orphan this prevents. Asserted from
    // recorded call order, not inferred from which arrays ended up non-empty, which would
    // pass either way.
    const rec = stubClient('post');
    await expect(publishTrack(INPUT, uploader)).rejects.toThrow();
    expect(rec.calls).toEqual(['remove', 'delete']);
  });

  it('touches nothing when the publish succeeds', async () => {
    const rec = stubClient('none');
    await expect(publishTrack(INPUT, uploader)).resolves.toMatchObject({
      trackId: TRACK_ID,
    });
    expect(rec.removed).toEqual([]);
    expect(rec.deletedTracks).toEqual([]);
  });

  it('does not call remove when nothing was uploaded', async () => {
    // Validation fails before any upload, so there is nothing to clean up and no reason to
    // make a storage round-trip.
    const rec = stubClient('none');
    await expect(
      publishTrack({ ...INPUT, title: '   ' }, uploader),
    ).rejects.toThrow(/Title is required/);
    expect(rec.removed).toEqual([]);
  });
});
