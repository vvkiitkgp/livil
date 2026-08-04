import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../components/Button';
import { CoverCropper } from '../components/CoverCropper';
import { CoverThumb } from '../components/CoverThumb';
import { usePreviewPlayer } from '../upload/preview';
import { MAX_WEB_UPLOAD_BYTES } from '@shared/services/media';
import { filesFromDataTransfer, pairAssets } from '../upload/files';
import { itemsFromPaired, useUploadQueue, type QueueItem } from '../upload/queue';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

const formatSize = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`;

/**
 * Batch upload. A single track is just a queue of one, so there is no separate code path
 * for it — the case that used to be "the" upload screen is now the degenerate case.
 */
export function Upload() {
  const queue = useUploadQueue();
  const preview = usePreviewPlayer();
  const [dragging, setDragging] = useState(false);
  const [busyReadingDrop, setBusyReadingDrop] = useState(false);

  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // 'ALL' applies the chosen art to every not-yet-started row.
  const coverForId = useRef<string | 'ALL' | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  // The cropper is modal, so at most one is open at a time.
  const [cropping, setCropping] = useState<{ id: string | 'ALL'; file: File } | null>(null);

  function accept(files: File[]) {
    const { items } = pairAssets(files);
    if (items.length > 0) queue.add(itemsFromPaired(items));
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    setBusyReadingDrop(true);
    try {
      // Walks directory entries — a dropped folder yields no `files` without this.
      accept(await filesFromDataTransfer(event.dataTransfer));
    } finally {
      setBusyReadingDrop(false);
    }
  }

  const pending = queue.items.filter(i => i.status === 'pending' || i.status === 'failed');
  const done = queue.items.filter(i => i.status === 'done');
  const missingArt = pending.filter(i => !i.image).length;
  const oversize = queue.items.filter(i => i.media.size > MAX_WEB_UPLOAD_BYTES).length;

  return (
    <section className="card card--wide">
      <div className="rowbetween">
        <h2 className="card__title">New upload</h2>
        <div className="filerow">
          {pending.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                coverForId.current = 'ALL';
                coverInput.current?.click();
              }}
            >
              Cover art for all {pending.length}
            </Button>
          )}
          {done.length > 0 && (
            <Button variant="ghost" size="sm" onClick={queue.clearFinished}>
              Clear {done.length} published
            </Button>
          )}
        </div>
      </div>

      <div
        className="dropzone"
        data-dragging={dragging || undefined}
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone__title">
          {busyReadingDrop ? 'Reading folder…' : 'Drop tracks or a whole folder here'}
        </p>
        <p className="hint">
          Up to {formatSize(MAX_WEB_UPLOAD_BYTES)} each · uploads resume if your connection
          drops · cover art matched by filename
        </p>
        <div className="filerow">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => filesInput.current?.click()}
          >
            Choose files
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => folderInput.current?.click()}
          >
            Choose folder
          </Button>
        </div>
        <input
          ref={filesInput}
          type="file"
          multiple
          accept="audio/*,video/*,image/*"
          hidden
          onChange={e => accept(Array.from(e.target.files ?? []))}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          webkitdirectory=""
          hidden
          onChange={e => accept(Array.from(e.target.files ?? []))}
        />
      </div>

      {queue.items.length > 0 && (
        <ul className="queue">
          {queue.items.map(item => (
            <QueueRow
              key={item.id}
              item={item}
              playing={preview.playingId === item.id}
              position={preview.playingId === item.id ? preview.position : 0}
              previewDuration={preview.playingId === item.id ? preview.duration : 0}
              onPreview={() => preview.toggle(item.id, item.media)}
              onSeek={preview.seek}
              onTitle={title => queue.patch(item.id, { title })}
              onDescription={description => queue.patch(item.id, { description })}
              onRemove={() => {
                if (preview.playingId === item.id) preview.stop();
                queue.remove(item.id);
              }}
              onPickCover={() => {
                coverForId.current = item.id;
                coverInput.current?.click();
              }}
            />
          ))}
        </ul>
      )}

      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          const id = coverForId.current;
          // Straight into the cropper — cover art is square everywhere it renders, so an
          // uncropped image gets centre-cropped by something downstream regardless.
          if (file && id) setCropping({ id, file });
          coverForId.current = null;
          e.target.value = '';
        }}
      />

      {cropping && (
        <CoverCropper
          file={cropping.file}
          onCancel={() => setCropping(null)}
          onDone={cropped => {
            if (cropping.id === 'ALL') {
              // Overwrites art already matched from filenames or read from tags. That is
              // the point of the action — it is only reachable by explicitly asking for it.
              queue.patchPending({ image: cropped, artFromTag: false, error: null });
            } else {
              queue.patch(cropping.id, { image: cropped, artFromTag: false, error: null });
            }
            setCropping(null);
          }}
        />
      )}

      {missingArt > 0 && (
        <p className="alert" role="alert">
          {missingArt} {missingArt === 1 ? 'track needs' : 'tracks need'} cover art before
          publishing.
        </p>
      )}
      {oversize > 0 && (
        <p className="alert" role="alert">
          {oversize} file{oversize === 1 ? ' is' : 's are'} over the{' '}
          {formatSize(MAX_WEB_UPLOAD_BYTES)} limit.
        </p>
      )}

      <div className="filerow">
        <Button
          size="lg"
          disabled={pending.length === 0 || missingArt > 0 || oversize > 0 || queue.running}
          busy={queue.running}
          onClick={() => {
            // Every failure is already captured per item; nothing escapes to handle here.
            queue.start().catch(() => {});
          }}
        >
          {pending.length > 1 ? `Publish ${pending.length} tracks` : 'Publish'}
        </Button>
        {queue.running && (
          <Button variant="ghost" onClick={queue.cancelAll}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  );
}

function QueueRow({
  item,
  playing,
  position,
  previewDuration,
  onPreview,
  onSeek,
  onTitle,
  onDescription,
  onRemove,
  onPickCover,
}: {
  item: QueueItem;
  playing: boolean;
  position: number;
  previewDuration: number;
  onPreview: () => void;
  onSeek: (seconds: number) => void;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onRemove: () => void;
  onPickCover: () => void;
}) {
  const locked = item.status === 'uploading' || item.status === 'done';

  return (
    <li className="queue__row" data-status={item.status}>
      <CoverThumb file={item.image} onClick={onPickCover} disabled={locked} />

      <div className="queue__main">
        <input
          className="queue__title"
          value={item.title}
          onChange={e => onTitle(e.target.value)}
          disabled={locked}
          aria-label="Track title"
        />
        <input
          className="queue__desc"
          value={item.description}
          onChange={e => onDescription(e.target.value)}
          disabled={locked}
          placeholder="Add a description"
          aria-label="Track description"
        />
        <span className="hint">
          {item.media.name} · {formatSize(item.media.size)} · {item.mode}
          {item.duration !== null && ` · ${formatTime(item.duration)}`}
          {item.artFromTag && ' · art from file'}
        </span>
        {item.error && <span className="queue__error">{item.error}</span>}

        {playing && (
          <div className="seek">
            <input
              type="range"
              className="seek__input"
              min={0}
              // Fall back to the metadata duration until the preview reports its own, so
              // the thumb is not pinned at the far left for the first moment of playback.
              max={previewDuration || item.duration || 0}
              step={0.1}
              value={position}
              aria-label="Seek preview"
              onChange={e => onSeek(Number(e.target.value))}
            />
            <span className="hint seek__time">
              {formatTime(position)} / {formatTime(previewDuration || item.duration || 0)}
            </span>
          </div>
        )}
      </div>

      <div className="queue__side">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPreview}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          title={playing ? 'Pause' : 'Play to check this file'}
        >
          {playing ? '❚❚' : '▶'}
        </Button>

        {item.status === 'done' ? (
          <span className="hint">Published</span>
        ) : item.status === 'uploading' ? (
          <span className="hint">
            {item.stage} · {Math.round(item.fraction * 100)}%
          </span>
        ) : null}

        {!locked && (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove">
            ✕
          </Button>
        )}
      </div>

      {item.status === 'uploading' && (
        <div className="queue__bar">
          <div className="queue__barfill" style={{ width: `${item.fraction * 100}%` }} />
        </div>
      )}
    </li>
  );
}
