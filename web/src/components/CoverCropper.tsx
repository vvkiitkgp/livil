import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';
import {
  clampPan,
  clampZoom,
  coverScale,
  drawRect,
  MAX_ZOOM,
  minZoom,
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
 *
 * Zoom goes below 1 for a non-square image, down to the point where the whole thing fits
 * and the square is padded. The pad colour is the app background, so a fitted cover reads
 * as intentional rather than as a rendering error.
 */
const OUTPUT_PX = 1024;
const FRAME_PX = 280;
const JPEG_QUALITY = 0.9;
/** COLORS.bg — matched to the app background so padding is invisible in the feed. */
const PAD_COLOR = '#0A0A0F';

export function CoverCropper({
  file,
  onCancel,
  onDone,
  outputPx = OUTPUT_PX,
  round,
  title = 'Crop cover art',
}: {
  file: File;
  onCancel: () => void;
  onDone: (cropped: File) => void;
  /** Avatars want 512; cover art wants the full 1024. */
  outputPx?: number;
  /** Round preview mask for avatars — the crop itself is still square. */
  round?: boolean;
  title?: string;
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

  const zoomFloor = size ? minZoom(size, FRAME_PX) : 1;
  const canFit = zoomFloor < 1;

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
      const canvas = document.createElement('canvas');
      canvas.width = outputPx;
      canvas.height = outputPx;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.imageSmoothingQuality = 'high';

      // Filled first so a fitted (zoomed-out) crop has a background rather than JPEG's
      // undefined-alpha garbage in the padding.
      ctx.fillStyle = PAD_COLOR;
      ctx.fillRect(0, 0, outputPx, outputPx);

      const k = outputPx / FRAME_PX;
      const { dx, dy, dw, dh } = drawRect(size, FRAME_PX, zoom, pan);
      // Drawn from the ORIGINAL pixels straight to output scale — one resample, so a large
      // photo keeps its detail. The canvas clips whatever falls outside.
      ctx.drawImage(image, dx * k, dy * k, dw * k, dh * k);

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

  const scale = size ? coverScale(size, FRAME_PX) * clampZoom(zoom, zoomFloor) : 1;

  return (
    <div className="modal" role="dialog" aria-label="Crop cover art">
      <div className="modal__panel">
        <h3 className="card__title">{title}</h3>
        <p className="hint">
          Drag to reposition, zoom to fill.
          {canFit && ' Zoom out to fit the whole image.'}
        </p>

        <div
          className="cropframe"
          data-round={round || undefined}
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
          min={zoomFloor}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          aria-label="Zoom"
          onChange={e => setZoom(clampZoom(Number(e.target.value), zoomFloor))}
        />

        {canFit && (
          <div className="filerow">
            <Button variant="ghost" size="sm" onClick={() => setZoom(zoomFloor)}>
              Fit whole image
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
              Fill square
            </Button>
          </div>
        )}

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
