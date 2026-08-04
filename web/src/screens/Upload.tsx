import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { startPublish } from '../upload/publish';
import { MAX_WEB_UPLOAD_BYTES } from '@shared/services/media';

type Phase =
  | { name: 'idle' }
  | { name: 'working'; stage: string; fraction: number }
  | { name: 'done'; postId: string }
  | { name: 'failed'; message: string };

const GB = 1024 * 1024 * 1024;
const formatSize = (bytes: number) =>
  bytes >= GB
    ? `${(bytes / GB).toFixed(2)} GB`
    : `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

/**
 * Single-track upload.
 *
 * Batch/folder upload, artwork cropping and the clip window are the next slice; this one
 * proves the resumable path end to end.
 */
export function Upload() {
  const [media, setMedia] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [dragging, setDragging] = useState(false);

  const abortRef = useRef<(() => void) | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const mode: 'audio' | 'video' | null = media
    ? media.type.startsWith('video')
      ? 'video'
      : 'audio'
    : null;

  const oversize = media !== null && media.size > MAX_WEB_UPLOAD_BYTES;
  const busy = phase.name === 'working';
  const canPublish =
    media !== null && image !== null && title.trim() !== '' && !oversize && !busy;

  function acceptFiles(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      if (file.type.startsWith('image/')) setImage(file);
      else if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        setMedia(file);
        // A title is almost always the filename; prefill it rather than making the
        // artist retype what they already named the file.
        if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
      }
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    acceptFiles(event.dataTransfer.files);
  }

  async function onPublish() {
    if (!media || !image || !mode) return;
    setPhase({ name: 'working', stage: 'preparing', fraction: 0 });

    const handle = startPublish(
      { mode, media, image, title, description },
      p => setPhase({ name: 'working', stage: p.stage, fraction: p.fraction }),
    );
    abortRef.current = handle.abort;

    try {
      const result = await handle.result;
      setPhase({ name: 'done', postId: result.postId });
      setMedia(null);
      setImage(null);
      setTitle('');
      setDescription('');
    } catch (err) {
      setPhase({
        name: 'failed',
        message: err instanceof Error ? err.message : 'Upload failed.',
      });
    } finally {
      abortRef.current = null;
    }
  }

  if (phase.name === 'done') {
    return (
      <section className="card card--center">
        <h2 className="card__title">Published</h2>
        <p className="hint">It's live in the feed now.</p>
        <Button onClick={() => setPhase({ name: 'idle' })}>Upload another</Button>
      </section>
    );
  }

  return (
    <section className="card card--wide">
      <h2 className="card__title">New upload</h2>

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
        <p className="dropzone__title">Drop your audio or video here</p>
        <p className="hint">Up to {formatSize(MAX_WEB_UPLOAD_BYTES)} — uploads resume if your connection drops</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => mediaInput.current?.click()}
        >
          Choose file
        </Button>
        <input
          ref={mediaInput}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={e => acceptFiles(e.target.files)}
        />
      </div>

      {media && (
        <p className="filerow">
          <strong>{media.name}</strong>
          <span className="hint">
            {formatSize(media.size)} · {mode}
          </span>
        </p>
      )}

      {oversize && (
        <p className="alert" role="alert">
          That file is over the {formatSize(MAX_WEB_UPLOAD_BYTES)} limit.
        </p>
      )}

      <div className="filerow">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => imageInput.current?.click()}
        >
          {mode === 'video' ? 'Choose thumbnail' : 'Choose cover art'}
        </Button>
        <span className="hint">{image ? image.name : 'Required'}</span>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={e => acceptFiles(e.target.files)}
        />
      </div>

      <TextField
        label="Title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        disabled={busy}
      />
      <TextField
        label="Description (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        disabled={busy}
      />

      {phase.name === 'failed' && (
        <p className="alert" role="alert">
          {phase.message}
        </p>
      )}

      {busy && (
        <div className="progress" aria-label="Upload progress">
          <div className="progress__fill" style={{ width: `${phase.fraction * 100}%` }} />
          <span className="hint">
            {phase.stage} · {Math.round(phase.fraction * 100)}%
          </span>
        </div>
      )}

      <div className="filerow">
        <Button size="lg" disabled={!canPublish} busy={busy} onClick={onPublish}>
          Publish
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => abortRef.current?.()}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  );
}
