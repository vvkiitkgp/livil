/**
 * The batch upload queue.
 *
 * Each item publishes independently through `publishTrack`, which already rolls back its
 * own track on failure. That independence is the point: one bad file in a twelve-track
 * folder must not cost the other eleven, and a failed item must be retryable on its own
 * without re-uploading what already succeeded.
 */
import { useCallback, useRef, useState } from 'react';
import type { PublishProgress } from '@shared/services/publishTrack';
import { readDuration, startPublish } from './publish';
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

export type ItemStatus = 'pending' | 'uploading' | 'done' | 'failed';

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
  /** Filled in asynchronously once the browser has read the file's metadata. */
  duration: number | null;
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
    duration: null,
    artFromTag: false,
  }));
}

export function useUploadQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const abortsRef = useRef(new Map<string, () => void>());

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
        readDuration(item.media)
          .then(duration => {
            if (duration !== null) patch(item.id, { duration });
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

  const remove = useCallback((id: string) => {
    abortsRef.current.get(id)?.();
    abortsRef.current.delete(id);
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
      patch(item.id, { status: 'uploading', error: null, fraction: 0 });

      const handle = startPublish(
        {
          mode: item.mode,
          media: item.media,
          image: item.image,
          title: item.title,
          description: item.description,
        },
        (p: PublishProgress) => patch(item.id, { stage: p.stage, fraction: p.fraction }),
      );
      abortsRef.current.set(item.id, handle.abort);

      try {
        const result = await handle.result;
        patch(item.id, { status: 'done', fraction: 1, postId: result.postId });
      } catch (err) {
        patch(item.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Upload failed.',
        });
      } finally {
        abortsRef.current.delete(item.id);
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
  }, []);

  return {
    items,
    running,
    add,
    patch,
    patchPending,
    remove,
    clearFinished,
    start,
    cancelAll,
  };
}
