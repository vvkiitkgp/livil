import { MIN_CLIP_SECONDS } from '@shared/services/publishTrack';

/**
 * Two-handle clip window over the full track.
 *
 * Bounds are ABSOLUTE full-track seconds, matching the rest of the product: the player
 * always loads the whole track and only the lock screen translates to clip-relative. Any
 * other convention here would desynchronise the app from the notification.
 *
 * Built from two native range inputs rather than custom pointer handling, so keyboard and
 * screen-reader support come for free. They are stacked with `pointer-events: none` on the
 * track and re-enabled on the thumbs, which is what lets both remain grabbable where they
 * overlap.
 */
export function ClipRange({
  duration,
  start,
  end,
  disabled,
  onChange,
}: {
  duration: number;
  start: number;
  end: number;
  disabled?: boolean;
  onChange: (next: { start: number; end: number }) => void;
}) {
  const step = 0.1;

  // Each handle is bounded by the other so the window can never invert or collapse below
  // the minimum — clamping after the fact would let a handle jump past its partner and
  // snap back, which feels broken while dragging.
  const setStart = (value: number) =>
    onChange({ start: Math.min(value, end - MIN_CLIP_SECONDS), end });
  const setEnd = (value: number) =>
    onChange({ start, end: Math.max(value, start + MIN_CLIP_SECONDS) });

  const pct = (v: number) => (duration > 0 ? (v / duration) * 100 : 0);

  return (
    <div className="clip">
      <div className="clip__track">
        <div
          className="clip__window"
          style={{ left: `${pct(start)}%`, right: `${100 - pct(end)}%` }}
        />
        <input
          type="range"
          className="clip__input"
          min={0}
          max={duration}
          step={step}
          value={start}
          disabled={disabled}
          aria-label="Clip start"
          onChange={e => setStart(Number(e.target.value))}
        />
        <input
          type="range"
          className="clip__input"
          min={0}
          max={duration}
          step={step}
          value={end}
          disabled={disabled}
          aria-label="Clip end"
          onChange={e => setEnd(Number(e.target.value))}
        />
      </div>
      <span className="hint">
        {formatTime(start)} – {formatTime(end)} · {formatTime(end - start)} clip
      </span>
    </div>
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
