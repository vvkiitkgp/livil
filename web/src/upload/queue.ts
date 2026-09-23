/**
 * The batch upload queue.
 *
 * Each item publishes independently through `publishTrack`, which already rolls back its
 * own track on failure. That independence is the point: one bad file in a twelve-track
 * folder must not cost the other eleven, and a failed item must be retryable on its own
 * without re-uploading what already succeeded.
 */
import { useCallback, useRef, useState } from 'react';
import {
  UploadCancelledError,
  type PublishProgress,
} from '@shared/services/publishTrack';
import {
  describeMatch,
  type RightsDeclaration,
} from '@shared/services/copyrightScan';
import { readMediaMeta, startPublish } from './publish';
import type { PendingCollaborator } from '@shared/constants/roles';
import { EMOTION_TAGS } from '@shared/constants/tags';
import { embeddedCoverFrom } from './embeddedArt';
import type { PairedItem } from './files';

/**
 * How many uploads run at once.
 *
 * Sequential wastes a fast connection; unbounded is worse than it looks — each in-flight
 * TUS upload holds its own 6 MB chunk buffer, and the analyzer holds a whole decoded file,
 * so twelve at once is a memory problem as well as a bandwidth one. Three keeps a typical
 * connection saturated with a bounded footprint.
 */
const MAX_CONCURRENT = 3;

/**
 * `awaiting_rights` — the copyright scan matched a known recording and this item is
 * paused on the uploader's answer. It is NOT a failure and NOT a verdict: covers never
 * reach it, and the uploader may own the recording or hold a licence. The item's publish
 * promise is genuinely suspended here, so nothing is written until they answer.
 */
export type ItemStatus = 'pending' | 'uploading' | 'awaiting_rights' | 'done' | 'failed';

export type QueueItem = {
  id: string;
  media: File;
  mode: 'audio' | 'video';
  image: File | null;
  title: string;
  description: string;
  status: ItemStatus;
  fraction: number;
  stage: PublishProgress['stage'] | null;
  error: string | null;
  postId: string | null;
  /**
   * What the scan matched, already formatted for display. Set only while status is
   * `awaiting_rights`; cleared once answered so a finished row carries no stale prompt.
   */
  matchDescription: string | null;
  /** Filled in asynchronously once the browser has read the file's metadata. */
  duration: number | null;
  /** Frame size, video only. Null for audio and for files the browser cannot probe. */
  width: number | null;
  height: number | null;
  /** What the uploader did on this track. Publishing is blocked until it is set. */
  uploaderRole: string;
  /** Credits for everyone else. Flattened to rows by `publishTrack` at publish time. */
  collaborators: PendingCollaborator[];
  /**
   * Already-normalized tags — `TagField` normalizes at commit, so this is what gets stored.
   * Seeded with `EMOTION_TAGS`, which the artist prunes rather than opts into.
   */
  tags: string[];
  /** True when the cover came out of the file's own tag rather than the folder. */
  artFromTag: boolean;
};

let seq = 0;
const nextId = () => `item-${++seq}`;

const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '').trim();

export function itemsFromPaired(paired: PairedItem[]): QueueItem[] {
  return paired.map(p => ({
    id: nextId(),
    media: p.media,
    mode: p.media.type.startsWith('video') || /\.(mp4|mov|mkv|webm)$/i.test(p.media.name)
      ? 'video'
      : 'audio',
    image: p.image,
    // Artists name their files; making them retype that is busywork.
    title: titleFromFileName(p.media.name),
    description: '',
    status: 'pending',
    fraction: 0,
    stage: null,
    error: null,
    postId: null,
    matchDescription: null,
    duration: null,
    width: null,
    height: null,
    uploaderRole: '',
    collaborators: [],
    // Pre-applied, not suggested: the artist removes the emotions this track is not. A fresh
    // copy per row — one shared array would make removing a tag from one file remove it from
    // every file in the batch.
    tags: [...EMOTION_TAGS],
    artFromTag: false,
  }));
}

export function useUploadQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const abortsRef = useRef(new Map<string, () => void>());
  /**
   * Resolvers for items paused on the copyright question, keyed by item id.
   *
   * A ref rather than state because the promise these resolve must survive every
   * re-render the prompt causes — holding them in state would drop the resolver and
   * strand the upload forever, with the row stuck on `awaiting_rights`.
   */
  const rightsResolversRef = useRef(new Map<string, (a: RightsDeclaration) => void>());

  const patch = useCallback((id: string, changes: Partial<QueueItem>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...changes } : it)));
  }, []);

  const add = useCallback(
    (incoming: QueueItem[]) => {
      setItems(prev => [...prev, ...incoming]);
      // Duration is shown in the row and saved to the track, so the feed can display a
      // length before the post is ever played. Read per item so one unreadable file does
      // not hold up the rest of the batch.
      for (const item of incoming) {
        readMediaMeta(item.media)
          .then(({ duration, width, height }) => {
            // Frame size rides along: it is the quality reading for a video, and it comes
            // from the same `loadedmetadata` event the duration does.
            if (duration !== null || width !== null) patch(item.id, { duration, width, height });
          })
          .catch(() => {
            /* duration is optional — it backfills on first play */
          });

        // A mastered file usually already carries its artwork. Only fall back to it when
        // the folder did not supply a matching image, so an explicit cover.jpg still wins
        // over whatever was baked into the tag months ago.
        if (!item.image) {
          embeddedCoverFrom(item.media)
            .then(cover => {
              if (cover) patch(item.id, { image: cover, artFromTag: true });
            })
            .catch(() => {
              /* no embedded art is the normal case, not a failure */
            });
        }
      }
    },
    [patch],
  );

  /**
   * Apply the same change to every item that has not started yet.
   *
   * Scoped to pending/failed on purpose: an item already uploading has its files captured,
   * and one already published is a row of history — changing either would be a lie about
   * what was actually sent.
   */
  const patchPending = useCallback((changes: Partial<QueueItem>) => {
    setItems(prev =>
      prev.map(it =>
        it.status === 'pending' || it.status === 'failed' ? { ...it, ...changes } : it,
      ),
    );
  }, []);

  /**
   * The same, but where the change depends on the item it is applied to.
   *
   * Credits need this and cover art does not: art is one slot to overwrite, while a credit
   * is appended to a list that already differs per row. A flat `patchPending` would write
   * one row's list over every other row's.
   */
  const patchPendingWith = useCallback(
    (compute: (item: QueueItem) => Partial<QueueItem>) => {
      setItems(prev =>
        prev.map(it =>
          it.status === 'pending' || it.status === 'failed' ? { ...it, ...compute(it) } : it,
        ),
      );
    },
    [],
  );

  const remove = useCallback((id: string) => {
    abortsRef.current.get(id)?.();
    abortsRef.current.delete(id);
    // Removing a row that is paused on the copyright question must also settle its
    // promise, or `publishOne` awaits forever on an item that no longer exists — a leak
    // with no UI left to reveal it. Resolving as 'cancelled' routes it through the same
    // rollback a deliberate cancellation takes.
    const resolve = rightsResolversRef.current.get(id);
    if (resolve) {
      rightsResolversRef.current.delete(id);
      resolve({ acknowledgement: 'cancelled' });
    }
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setItems(prev => prev.filter(it => it.status !== 'done'));
  }, []);

  const publishOne = useCallback(
    async (item: QueueItem) => {
      if (!item.image) {
        patch(item.id, { status: 'failed', error: 'Cover art is required.' });
        return;
      }
      if (!item.uploaderRole.trim()) {
        patch(item.id, { status: 'failed', error: 'Choose what you did on this track.' });
        return;
      }
      patch(item.id, { status: 'uploading', error: null, fraction: 0 });

      const handle = startPublish(
        {
          mode: item.mode,
          media: item.media,
          image: item.image,
          title: item.title,
          description: item.description,
          uploaderRole: item.uploaderRole,
          tags: item.tags,
          // Picker shape -> row shape. The XOR the table enforces is decided here: a
          // credit that names a profile never also carries a typed name.
          collaborators: item.collaborators.map(c => ({
            userId: c.kind === 'user' ? c.userId ?? null : null,
            customName: c.kind === 'custom' ? c.name : null,
            role: c.role,
          })),
        },
        (p: PublishProgress) => patch(item.id, { stage: p.stage, fraction: p.fraction }),
        // The copyright question. Suspends THIS item only — the other workers carry on,
        // which is why the resolver is keyed by item id rather than held as one global.
        result => {
          patch(item.id, {
            status: 'awaiting_rights',
            matchDescription: describeMatch(result),
          });
          return new Promise<RightsDeclaration>(resolve => {
            rightsResolversRef.current.set(item.id, resolve);
          });
        },
      );
      abortsRef.current.set(item.id, handle.abort);

      try {
        const result = await handle.result;
        patch(item.id, {
          status: 'done',
          fraction: 1,
          postId: result.postId,
          matchDescription: null,
        });
      } catch (err) {
        // Backing out at the copyright question is a choice, not a failure. The row
        // returns to `pending` so it can be removed or retried, with no red error text
        // telling someone who just decided not to publish that something broke.
        if (err instanceof UploadCancelledError) {
          patch(item.id, {
            status: 'pending',
            fraction: 0,
            stage: null,
            error: null,
            matchDescription: null,
          });
          return;
        }
        patch(item.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Upload failed.',
          matchDescription: null,
        });
      } finally {
        abortsRef.current.delete(item.id);
        rightsResolversRef.current.delete(item.id);
      }
    },
    [patch],
  );

  /**
   * Runs every pending item, at most MAX_CONCURRENT at a time.
   *
   * The work list is captured from a state snapshot taken via the updater, not from
   * `items` — reading the closed-over `items` would run against whatever was current when
   * this callback was created and silently skip anything added since.
   */
  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);

    const snapshot = await new Promise<QueueItem[]>(resolve => {
      setItems(prev => {
        resolve(prev);
        return prev;
      });
    });

    const queue = snapshot.filter(it => it.status === 'pending' || it.status === 'failed');
    let cursor = 0;

    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= queue.length) return;
        await publishOne(queue[index]!);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, worker),
    );
    setRunning(false);
  }, [running, publishOne]);

  const cancelAll = useCallback(() => {
    for (const abort of abortsRef.current.values()) abort();
    abortsRef.current.clear();
    // Same reasoning as `remove`: an item suspended on the copyright question holds a
    // promise that `abort()` cannot reach, so it must be settled explicitly or the
    // worker never returns and `running` never clears.
    for (const resolve of rightsResolversRef.current.values()) {
      resolve({ acknowledgement: 'cancelled' });
    }
    rightsResolversRef.current.clear();
  }, []);

  /**
   * Answer the copyright question for one paused item.
   *
   * Flips the row back to `uploading` BEFORE resolving, so the moment the publish
   * resumes the UI is already showing progress rather than a prompt it has answered.
   * A missing resolver is a no-op — a double click, or an item cancelled underneath.
   */
  const answerRights = useCallback(
    (id: string, answer: RightsDeclaration) => {
      const resolve = rightsResolversRef.current.get(id);
      if (!resolve) return;
      rightsResolversRef.current.delete(id);
      patch(id, { status: 'uploading', matchDescription: null });
      resolve(answer);
    },
    [patch],
  );

  return {
    items,
    running,
    add,
    patch,
    patchPending,
    patchPendingWith,
    remove,
    clearFinished,
    start,
    cancelAll,
    answerRights,
  };
}
