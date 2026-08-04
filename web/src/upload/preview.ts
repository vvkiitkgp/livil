import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local preview playback, so an artist can check what they are about to publish.
 *
 * This is a plain `<audio>` element over an object URL — the file never leaves the machine
 * and nothing is fetched. It has no relationship to the mobile single-engine rule (ADR-0001),
 * which is about the OS MediaSession on the phone; this is a different app, a local file, and
 * no notification is ever posted.
 *
 * One element is reused for every row rather than one per row, which is what makes "starting
 * a second track stops the first" fall out for free instead of needing coordination.
 *
 * AUDIO ONLY. An `<audio>` element will happily play an mp4's soundtrack, which is exactly
 * why this gap was easy to miss — pressing play on a video appeared to work while showing
 * nothing. Video rows route to `VideoPreview` instead; this element is for audio.
 */
export type PreviewState = {
  playingId: string | null;
  /** Seconds into the previewing track. */
  position: number;
  /** Length of the previewing track, 0 until metadata loads. */
  duration: number;
  toggle: (id: string, file: File) => void;
  seek: (seconds: number) => void;
  stop: () => void;
};

export function usePreviewPlayer(): PreviewState {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const release = useCallback(() => {
    const el = elementRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    release();
    setPlayingId(null);
    setPosition(0);
    setDuration(0);
  }, [release]);

  const toggle = useCallback(
    (id: string, file: File) => {
      const el = elementRef.current;

      // Same track: pause and resume in place rather than reloading, so scrubbing to a
      // spot and pausing does not throw the position away.
      if (playingId === id && el) {
        if (el.paused) {
          el.play().catch(() => setPlayingId(null));
        } else {
          el.pause();
        }
        setPlayingId(el.paused ? null : id);
        return;
      }

      // Switching tracks: tear the previous source down first so its object URL is not
      // orphaned while the element re-points.
      release();
      setPosition(0);
      setDuration(0);

      const next = el ?? new Audio();
      elementRef.current = next;
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      next.src = url;

      next.onloadedmetadata = () => {
        setDuration(Number.isFinite(next.duration) ? next.duration : 0);
      };
      // `timeupdate` fires roughly four times a second — enough for a progress bar, and far
      // cheaper than driving it from an animation frame.
      next.ontimeupdate = () => setPosition(next.currentTime);
      next.onended = () => {
        setPlayingId(null);
        setPosition(0);
      };
      // A codec the browser cannot play is not an upload problem — the file still uploads
      // fine — so the preview just stops rather than surfacing an error.
      next.onerror = () => setPlayingId(null);

      next.play().then(
        () => setPlayingId(id),
        () => setPlayingId(null),
      );
    },
    [playingId, release],
  );

  const seek = useCallback((seconds: number) => {
    const el = elementRef.current;
    if (!el) return;
    el.currentTime = seconds;
    // Set locally too: `timeupdate` will not fire while paused, so the bar would otherwise
    // snap back to the old position under the thumb.
    setPosition(seconds);
  }, []);

  // Leaving the page mid-preview must not leave audio playing or an object URL pinned.
  useEffect(() => release, [release]);

  return { playingId, position, duration, toggle, seek, stop };
}
