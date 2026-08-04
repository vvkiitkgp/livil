import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import {
  clampPan,
  clampZoom,
  coverScale,
  MAX_ZOOM,
  MIN_ZOOM,
  sourceRect,
  type Pan,
} from '../upload/cropMath';

/**
 * Square cover-art cropper.
 *
 * Cover art is square everywhere it appears — feed cards, the player, the lock screen — so
 * an uncropped 16:9 photo gets centre-cropped by whatever renders it, with no say from the
 * artist. This gives them the say.
 *
 * Output is 1024 px JPEG. Larger than the mobile avatar path's 512 because this is artwork
 * shown full-width in a player, and JPEG rather than WebP because the bucket's MIME
 * allowlist accepts both but every existing stored cover is JPEG or PNG.
 */
const OUTPUT_PX = 1024;
const FRAME_PX = 280;
const JPEG_QUALITY = 0.9;

export function CoverCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const dragFrom = useRef<{ x: number; y: number; pan: Pan } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Memoized because it is a dependency of both the pan clamp and the zoom effect below:
  // as a fresh object literal it would change identity every render and re-run the
  // re-clamp on every keystroke elsewhere in the tree.
  const size = useMemo(
    () => (image ? { width: image.naturalWidth, height: image.naturalHeight } : null),
    [image],
  );

  const setPanClamped = useCallback(
    (next: Pan) => {
      if (!size) return;
      setPan(clampPan(next, size, FRAME_PX, zoom));
    },
    [size, zoom],
  );

  // Re-clamp on zoom out, or the image can be left panned off the frame edge.
  useEffect(() => {
    if (size) setPan(prev => clampPan(prev, size, FRAME_PX, zoom));
  }, [zoom, size]);

  async function exportCrop() {
    if (!image || !size) return;
    setBusy(true);
    try {
      const { sx, sy, size: srcSize } = sourceRect(size, FRAME_PX, zoom, pan);
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.imageSmoothingQuality = 'high';
      // Drawn from the ORIGINAL pixels straight to the output size — one resample, so a
      // large photo keeps its detail.
      ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, OUTPUT_PX, OUTPUT_PX);

      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
      );
      if (!blob) throw new Error('Could not render the crop');

      const base = file.name.replace(/\.[^.]+$/, '');
      onDone(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
    } catch {
      // Falling back to the original is better than blocking the upload: an uncropped
      // cover still publishes, it just gets centre-cropped downstream.
      onDone(file);
    } finally {
      setBusy(false);
    }
  }

  const scale = size ? coverScale(size, FRAME_PX) * clampZoom(zoom) : 1;

  return (
    <div className="modal" role="dialog" aria-label="Crop cover art">
      <div className="modal__panel">
        <h3 className="card__title">Crop cover art</h3>
        <p className="hint">Drag to reposition, and zoom to fill the square.</p>

        <div
          className="cropframe"
          style={{ width: FRAME_PX, height: FRAME_PX }}
          onPointerDown={e => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragFrom.current = { x: e.clientX, y: e.clientY, pan };
          }}
          onPointerMove={e => {
            const from = dragFrom.current;
            if (!from) return;
            setPanClamped({
              x: from.pan.x + (e.clientX - from.x),
              y: from.pan.y + (e.clientY - from.y),
            });
          }}
          onPointerUp={() => {
            dragFrom.current = null;
          }}
        >
          {image && (
            <img
              className="cropframe__img"
              src={image.src}
              alt=""
              draggable={false}
              style={{
                width: image.naturalWidth * scale,
                height: image.naturalHeight * scale,
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
              }}
            />
          )}
        </div>

        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          aria-label="Zoom"
          onChange={e => setZoom(clampZoom(Number(e.target.value)))}
        />

        <div className="filerow">
          <Button onClick={exportCrop} busy={busy} disabled={!image}>
            Use this crop
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
