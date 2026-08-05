import { useEffect, useState } from 'react';
import { Image } from 'react-native';

/**
 * Resolves a remote image's intrinsic aspect ratio (width / height).
 *
 * Returns `null` until it is known, so a caller can hold off drawing rather than
 * lay out a guessed rectangle that pops to the real shape a frame later.
 *
 * Uses `Image.getSize` rather than the rendered `<Image>`'s `onLoad`: onLoad can
 * only report AFTER the view has been laid out at some assumed size, which is
 * exactly the pop we are avoiding. getSize hits the same cache the `<Image>`
 * will, so the wait is nil on a warm image.
 *
 * A failure (offline, 404, malformed) resolves to `1` — a square card with the
 * fill showing is better than a hole where the artwork belongs.
 */
export function useImageAspect(uri: string | null | undefined): number | null {
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    setAspect(null);
    if (!uri) { return; }
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => { if (!cancelled && w > 0 && h > 0) { setAspect(w / h); } },
      () => { if (!cancelled) { setAspect(1); } },
    );
    return () => { cancelled = true; };
  }, [uri]);

  return aspect;
}

export default useImageAspect;
