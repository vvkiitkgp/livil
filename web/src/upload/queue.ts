/**
 * The batch upload queue.
 *
 * Each item publishes independently through `publishTrack`, which already rolls back its
 * own track on failure. That independence is the point: one bad file in a twelve-track
 * folder must not cost the other eleven, and a failed item must be retryable on its own
 * without re-uploading what already succeeded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  UploadCancelledError,
  type PublishProgress,
} from '@shared/services/publishTrack';
import {
  describeMatch,
  type Acknowledgement,
  type RightsDeclaration,
  type ScanResult,
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
 * An item's life, in the order the stepped upload walks it:
 *
 * - `pending`   — editable; nothing has left the machine.
 * - `uploading` — bytes going up.
 * - `checking`  — uploaded; the copyright scan is running.
 * - `awaiting_rights` — the scan matched a known recording and this item is paused on the
 *   uploader's answer. It is NOT a failure and NOT a verdict: covers never reach it, and
 *   the uploader may own the recording or hold a licence.
 * - `ready`     — uploaded, checked, and answered. Parked on the artist's Publish press;
 *   the track has no post and no credits yet, so nobody can see it. A rights answer given
 *   on the way here is still a DRAFT held in memory — see `answerRights`.
 * - `publishing`— Publish pressed; credits and post being written.
 * - `done` / `failed`.
 *
 * In `awaiting_rights` and `ready` the item's publish promise is genuinely suspended, so
 * nothing further is written until the artist acts.
 */
export type ItemStatus =
  | 'pending'
  | 'uploading'
  | 'checking'
  | 'awaiting_rights'
  | 'ready'
  | 'publishing'
  | 'done'
  | 'failed';

/** Statuses where the files are already up and the item is waiting on the artist. */
export const HELD_STATUSES: ReadonlySet<ItemStatus> = new Set(['awaiting_rights', 'ready']);

/** Statuses where fields must not change: what is shown must be what gets stored. */
export const LOCKED_STATUSES: ReadonlySet<ItemStatus> = new Set([
  'uploading',
  'checking',
  'awaiting_rights',
  'ready',
  'publishing',
  'done',
]);

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
   * What the scan matched, already formatted for display. Set when the scan matches and
   * kept through `ready`, so the review step can say what the answer was about. Cleared
   * when the item goes back to `pending`.
   */
  matchDescription: string | null;
  /** The copyright scan's result. Null until the scan has run. */
  scan: ScanResult | null;
  /** What the artist answered on a match. Null when there was no match to answer. */
  rightsAnswer: Acknowledgement | null;
  /**
   * The full answer, kept so it can be shown and edited until Publish. It is only sent to
   * the database when Publish is pressed; once there it is final (a trigger refuses to
   * overwrite an answer), which is exactly why it is not sent any sooner.
   */
  rightsDraft: RightsDeclaration | null;
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
    scan: null,
    rightsAnswer: null,
    rightsDraft: null,
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
  /**
   * The Publish gates, keyed by item id — one per item parked in `ready`. Resolving lets
   * that item write its credits and post; rejecting rolls it back. A ref for the same
   * reason as the rights resolvers.
   */
  const gatesRef = useRef(
    new Map<string, { release: () => void; withdraw: (err: Error) => void }>(),
  );
  /** Each started item's whole-publish promise, so `publishAll` can wait for the posts. */
  const settledRef = useRef(new Map<string, Promise<void>>());
  /**
   * Saved-but-unsent rights answers, keyed by item id. The item's rights promise stays
   * unresolved while its answer sits here, so the answer can still change; `publishAll`
   * resolves it with whatever is here at that moment. An item being re-edited is taken out,
   * so Publish cannot send an answer the artist has reopened.
   */
  const draftsRef = useRef(new Map<string, RightsDeclaration>());
  /**
   * Items whose rights answer was sent by `publishAll`. Their Publish gate is reached a
   * moment later and must open on arrival — Publish has already been pressed for them.
   */
  const releaseOnArrivalRef = useRef(new Set<string>());

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
    draftsRef.current.delete(id);
    if (resolve) {
      rightsResolversRef.current.delete(id);
      resolve({ acknowledgement: 'cancelled' });
    }
    // Same for an item parked on Publish: withdrawing rolls back its uploaded files and
    // track row, so removing a row never leaves an unposted track behind.
    const gate = gatesRef.current.get(id);
    if (gate) {
      gatesRef.current.delete(id);
      gate.withdraw(new UploadCancelledError());
    }
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setItems(prev => prev.filter(it => it.status !== 'done'));
  }, []);

  /**
   * Uploads and checks one item, then PARKS it — at the rights question or at the Publish
   * gate — and returns.
   *
   * Returning at the park, not when the post is written, is what keeps the worker pool
   * moving: a parked item holds no bandwidth and no memory, and if workers waited on it a
   * batch with three parked items would never start its fourth upload. The rest of the
   * item's publish carries on in the background and patches its own row as it settles.
   */
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
      patch(item.id, {
        status: 'uploading',
        error: null,
        fraction: 0,
        scan: null,
        rightsAnswer: null,
        rightsDraft: null,
        matchDescription: null,
      });

      let signalParked: () => void = () => {};
      const parked = new Promise<void>(resolve => {
        signalParked = resolve;
      });

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
        (p: PublishProgress) =>
          // `finalizing` is the moment the bytes are up; what follows is the scan, which is
          // the part the artist is waiting on in this step.
          patch(item.id, {
            stage: p.stage,
            fraction: p.fraction,
            ...(p.stage === 'finalizing' ? { status: 'checking' as const } : {}),
          }),
        // The copyright question. Suspends THIS item only — the other workers carry on,
        // which is why the resolver is keyed by item id rather than held as one global.
        result => {
          patch(item.id, {
            status: 'awaiting_rights',
            scan: result,
            matchDescription: describeMatch(result),
          });
          signalParked();
          return new Promise<RightsDeclaration>(resolve => {
            rightsResolversRef.current.set(item.id, resolve);
          });
        },
        // The Publish gate. Everything above has happened; nothing visible has.
        scan => {
          // Arrived here because Publish already sent this item's rights answer: go on.
          if (releaseOnArrivalRef.current.delete(item.id)) return Promise.resolve();
          patch(item.id, { status: 'ready', scan, fraction: 1 });
          signalParked();
          return new Promise<void>((release, withdraw) => {
            gatesRef.current.set(item.id, { release, withdraw });
          });
        },
      );
      abortsRef.current.set(item.id, handle.abort);

      const settled = handle.result
        .then(result => {
          patch(item.id, { status: 'done', fraction: 1, postId: result.postId });
        })
        .catch(err => {
          // Backing out — at the rights question, or by going back to edit — is a choice,
          // not a failure. The row returns to `pending` so it can be edited, removed or
          // re-checked, with no red error text telling someone who just decided not to
          // publish that something broke. Its uploaded files are already gone.
          if (err instanceof UploadCancelledError) {
            patch(item.id, {
              status: 'pending',
              fraction: 0,
              stage: null,
              error: null,
              matchDescription: null,
              scan: null,
              rightsAnswer: null,
              rightsDraft: null,
            });
            return;
          }
          patch(item.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Upload failed.',
            matchDescription: null,
            scan: null,
            rightsAnswer: null,
            rightsDraft: null,
          });
        })
        .finally(() => {
          abortsRef.current.delete(item.id);
          rightsResolversRef.current.delete(item.id);
          gatesRef.current.delete(item.id);
          settledRef.current.delete(item.id);
          draftsRef.current.delete(item.id);
          releaseOnArrivalRef.current.delete(item.id);
        });
      settledRef.current.set(item.id, settled);

      // Whichever comes first: parked and waiting on the artist, or finished outright
      // (a failure, or a cancellation while uploading).
      await Promise.race([settled, parked]);
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

    const queue = snapshot.filter(
      it => (it.status === 'pending' || it.status === 'failed') && !settledRef.current.has(it.id),
    );
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
    draftsRef.current.clear();
    for (const gate of gatesRef.current.values()) gate.withdraw(new UploadCancelledError());
    gatesRef.current.clear();
  }, []);

  /**
   * Publish every item parked in `ready`: release their gates so each writes its credits
   * and its post. Resolves once every released item has settled (done or failed).
   *
   * An item with a saved rights answer is released by SENDING that answer — this is the
   * moment it becomes final — and its gate is marked to open on arrival.
   *
   * Items still on the rights question are left alone — they have not been answered, and
   * publishing past an unanswered match is exactly what the question exists to prevent.
   */
  const publishAll = useCallback(async () => {
    const released: Promise<void>[] = [];
    for (const [id, draft] of draftsRef.current) {
      const resolve = rightsResolversRef.current.get(id);
      if (!resolve) continue;
      rightsResolversRef.current.delete(id);
      releaseOnArrivalRef.current.add(id);
      patch(id, { status: 'publishing' });
      const settled = settledRef.current.get(id);
      if (settled) released.push(settled);
      resolve(draft);
    }
    draftsRef.current.clear();
    for (const [id, gate] of gatesRef.current) {
      patch(id, { status: 'publishing' });
      const settled = settledRef.current.get(id);
      if (settled) released.push(settled);
      gate.release();
    }
    gatesRef.current.clear();
    await Promise.all(released);
  }, [patch]);

  /**
   * Leaving the page mid-flow must not strand anything. An item parked on the rights
   * question or on Publish holds an uploaded, unposted track; without this, unmounting
   * would leave those promises pending forever and the tracks orphaned in storage.
   * Cancelling routes every one of them through the normal rollback.
   */
  useEffect(() => {
    const aborts = abortsRef.current;
    const resolvers = rightsResolversRef.current;
    const gates = gatesRef.current;
    return () => {
      for (const abort of aborts.values()) abort();
      for (const resolve of resolvers.values()) resolve({ acknowledgement: 'cancelled' });
      for (const gate of gates.values()) gate.withdraw(new UploadCancelledError());
    };
  }, []);

  /**
   * Save the artist's answer to the copyright question — as a DRAFT.
   *
   * Nothing is sent yet. The item shows as `ready`, but its rights promise stays
   * unresolved and the answer waits in `draftsRef` until Publish, so it can still be read
   * back and changed. Sending it here would make it final on the spot: the database
   * refuses to overwrite an answer once given.
   *
   * A missing resolver is a no-op — a double click, or an item cancelled underneath.
   */
  const answerRights = useCallback(
    (id: string, answer: RightsDeclaration) => {
      if (!rightsResolversRef.current.has(id)) return;
      draftsRef.current.set(id, answer);
      patch(id, {
        status: 'ready',
        rightsAnswer: answer.acknowledgement,
        rightsDraft: answer,
      });
    },
    [patch],
  );

  /**
   * Reopen a saved answer for editing. Takes it out of `draftsRef` so Publish cannot send
   * it while it is open; the item returns to `awaiting_rights`, which blocks Publish until
   * it is saved again. The draft stays on the item so the form opens prefilled.
   */
  const editRights = useCallback(
    (id: string) => {
      if (!rightsResolversRef.current.has(id)) return;
      draftsRef.current.delete(id);
      patch(id, { status: 'awaiting_rights' });
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
    editRights,
    publishAll,
  };
}
