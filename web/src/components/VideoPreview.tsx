import { useEffect, useState } from 'react';
import { Button } from './Button';

/**
 * Watch a local video before publishing it.
 *
 * The queue's shared `<audio>` element plays an mp4's soundtrack perfectly well, which is
 * exactly why the gap was easy to miss: pressing play on a video appeared to work. You could
 * hear the file and never see it — and "is this the right video" is a question about the
 * picture.
 *
 * A modal rather than an inline player, because a video in a table row is either too small
 * to judge or it wrecks the row height for every other item in the queue.
 *
 * Nothing is uploaded or fetched: this plays an object URL over the local file, revoked on
 * close so a long batch session does not pin every video the artist previewed.
 */
export function VideoPreview({
  file,
  title,
  onClose,
}: {
  file: File;
  title: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${title}`}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__panel videopreview">
        <h3 className="card__title">{title}</h3>
        {url && (
          // autoPlay because the artist explicitly asked to watch this one; controls so they
          // can scrub to the moment they actually care about.
          <video className="videopreview__el" src={url} controls autoPlay playsInline />
        )}
        <p className="hint">
          Playing from your machine — nothing is uploaded until you publish.
        </p>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
