/**
 * Display formatting.
 *
 * These four exist three times over in the mobile app — the knowledge base records them as
 * repeatedly reimplemented across screens. They belong in `shared/` eventually, alongside the
 * posts read layer; extracting them is a change to the MOBILE app and should not ride on a
 * dashboard ticket, so they start here and move when that extraction happens.
 */

/** 1482 -> "1.5K". Keeps small numbers exact — an artist with 47 plays wants to see 47. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}K`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

/** Seconds -> "3:44". Null renders as an em dash rather than "0:00", which would be a lie. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Recent dates read better as "3 days ago"; older ones want the actual date. */
export function formatDate(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Bytes -> "7.4 MB". Em dash for unknown, never "0 B" — a zero here would be a lie. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Average bitrate, derived rather than stored: size * 8 / duration.
 *
 * "Average" is the honest word — a VBR mp3 has no single bitrate, and for a VIDEO this is the
 * whole container including the picture, so it is not an audio bitrate at all. Both are why
 * the label says kbps and the number is rounded rather than presented as a spec.
 */
export function bitrateKbps(
  bytes: number | null | undefined,
  seconds: number | null | undefined,
): number | null {
  if (!bytes || !seconds || bytes <= 0 || seconds <= 0) return null;
  return Math.round((bytes * 8) / seconds / 1000);
}

export function formatBitrate(kbps: number | null): string {
  return kbps === null ? '—' : `${kbps} kbps`;
}
