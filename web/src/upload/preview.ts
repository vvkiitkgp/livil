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
 * An `<audio>` element plays the audio track of a video file too, which is enough to confirm
 * the right file is queued. Seeing the picture is not.
 */
export function usePreviewPlayer() {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

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
  }, [release]);

  const toggle = useCallback(
    (id: string, file: File) => {
      if (playingId === id) {
        stop();
        return;
      }
      // Switching tracks: tear the previous source down first so its object URL is not
      // orphaned while the element re-points.
      release();

      const el = elementRef.current ?? new Audio();
      elementRef.current = el;
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      el.src = url;
      el.onended = () => setPlayingId(null);
      // A codec the browser cannot play is not an upload problem — the file still uploads
      // fine — so the preview just stops rather than surfacing an error.
      el.onerror = () => setPlayingId(null);
      el.play().then(
        () => setPlayingId(id),
        () => setPlayingId(null),
      );
    },
    [playingId, release, stop],
  );

  // Leaving the page mid-preview must not leave audio playing or an object URL pinned.
  useEffect(() => release, [release]);

  return { playingId, toggle, stop };
}
