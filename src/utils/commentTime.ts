/** The time beside a comment's author: "just now", then 1m, 2h, 3d, 1w, 2mo, 1y. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) { return ''; }
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  // Under a minute it is "just now", not a seconds count that looks like it is ticking.
  if (diffSec < 60) { return 'just now'; }
  const m = Math.floor(diffSec / 60);
  if (m < 60) { return `${m}m`; }
  const h = Math.floor(m / 60);
  if (h < 24) { return `${h}h`; }
  const d = Math.floor(h / 24);
  if (d < 7) { return `${d}d`; }
  const w = Math.floor(d / 7);
  if (w < 4) { return `${w}w`; }
  const mo = Math.floor(d / 30);
  if (mo < 12) { return `${mo}mo`; }
  return `${Math.floor(d / 365)}y`;
}
