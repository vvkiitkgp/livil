import { useCallback, useEffect, useState } from 'react';
import { Button } from './Button';
import { LevelMeter } from './LevelMeter';
import { levelTapFor, type LevelTap } from '../upload/levels';
import type { Quality } from '../upload/quality';

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
 * The level meter rides along INSIDE the modal. It cannot live beside the upload card the
 * way the audio one does — the modal covers that — and a video's soundtrack is exactly as
 * publishable, and exactly as easy to export quiet, as an audio track's.
 *
 * Nothing is uploaded or fetched: this plays an object URL over the local file, revoked on
 * close so a long batch session does not pin every video the artist previewed.
 */
export function VideoPreview({
  file,
  title,
  quality,
  onClose,
}: {
  file: File;
  title: string;
  /** Frame size for this file, from the queue's metadata probe. Null while it is pending. */
  quality: Quality | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [tap, setTap] = useState<LevelTap | null>(null);
  const [playing, setPlaying] = useState(false);

  // A ref callback rather than an effect: the tap must be attached to the element itself,
  // and this fires with the node the moment React has one. `levelTapFor` is idempotent per
  // element, so a re-render that hands back the same node costs nothing.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    const next = levelTapFor(el);
    next?.reset();
    setTap(next);
  }, []);

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

        <div className="videopreview__stage">
          {/* The frame exists to be shrinkable. A `<video>` is a replaced element, so its
              min-content width is its intrinsic width — as a flex item directly it refuses
              to shrink, and a 2880-wide landscape clip shoved the meter clean out of the
              panel. The wrapper takes `min-width: 0` and the video scales inside it. */}
          <div className="videopreview__frame">
            {url && (
              // autoPlay because the artist explicitly asked to watch this one; controls so
              // they can scrub to the moment they actually care about.
              <video
                ref={attach}
                className="videopreview__el"
                src={url}
                controls
                autoPlay
                playsInline
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            )}
          </div>
          <LevelMeter tap={tap} title={title} quality={quality} active={playing} />
        </div>

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
