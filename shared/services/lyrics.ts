/**
 * Lyrics: LRC and plain text.
 *
 * Shared because the RAW file is what gets stored — parsing here means both clients derive
 * identical lines from identical bytes, and fixing the parser is a code change rather than a
 * data migration.
 *
 * LRC is a loose de-facto format with no specification, so this is written to be forgiving of
 * what real files contain rather than strict about what they should:
 *
 *   [ar:Artist]                 metadata tags, ignored for display
 *   [00:12.34]first line        one timestamp
 *   [00:45.00][01:30.00]chorus  the SAME line at several times — common, easy to miss
 *   [00:50.5]                   an empty line is a legitimate instrumental gap
 *   [offset:-500]               a global shift in milliseconds, applied on parse
 */

export type LyricsFormat = 'lrc' | 'plain';

export type LyricLine = {
  /** Milliseconds from the start of the track. Null for plain text. */
  atMs: number | null;
  text: string;
};

export type ParsedLyrics = {
  format: LyricsFormat;
  lines: LyricLine[];
  /** Metadata tags an LRC may carry — shown nowhere yet, kept so nothing is silently lost. */
  meta: Record<string, string>;
};

export const LYRICS_MAX_CHARS = 20000;

/** Timestamp at the start of a line: [mm:ss], [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx]. */
const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
/** Metadata tag: [ar:...], [ti:...], [offset:-500]. A letter first is what separates it
 *  from a timestamp — `[01:23]` is a time, `[ar:x]` is a tag. */
const META_TAG = /^\[([a-z]+):(.*)\]$/i;

/**
 * Which format is this?
 *
 * Any line carrying a timestamp makes the whole file LRC — real LRC files routinely have
 * untimed header lines, so requiring every line to be timed would misclassify most of them.
 */
export function detectFormat(raw: string): LyricsFormat {
  TIMESTAMP.lastIndex = 0;
  return TIMESTAMP.test(raw) ? 'lrc' : 'plain';
}

function toMs(min: string, sec: string, frac: string | undefined): number {
  const minutes = Number(min);
  const seconds = Number(sec);
  // Fractions are ambiguous: `.5` is centiseconds in most files but tenths in some. Two
  // digits is the overwhelming convention, so pad or truncate to hundredths and treat three
  // digits as milliseconds.
  let ms = 0;
  if (frac) {
    ms = frac.length >= 3 ? Number(frac.slice(0, 3)) : Number(frac.padEnd(2, '0')) * 10;
  }
  return minutes * 60_000 + seconds * 1000 + ms;
}

export function parseLyrics(raw: string, format?: LyricsFormat): ParsedLyrics {
  const text = raw.replace(/\r\n?/g, '\n');
  const fmt = format ?? detectFormat(text);
  const meta: Record<string, string> = {};

  if (fmt === 'plain') {
    return {
      format: 'plain',
      lines: text.split('\n').map(l => ({ atMs: null, text: l.trim() })),
      meta,
    };
  }

  const lines: LyricLine[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const metaMatch = line.match(META_TAG);
    if (metaMatch && !/^\d+$/.test(metaMatch[1]!)) {
      meta[metaMatch[1]!.toLowerCase()] = metaMatch[2]!.trim();
      continue;
    }

    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = TIMESTAMP.exec(line)) !== null) {
      // Only leading timestamps count. A `[03:00]` inside the words is lyric content, not a
      // cue, and treating it as one would silently delete part of the line.
      if (match.index !== lastEnd) break;
      stamps.push(toMs(match[1]!, match[2]!, match[3]));
      lastEnd = match.index + match[0].length;
    }

    if (stamps.length === 0) {
      // An untimed line in an LRC file — a title or a stray note. Keep the words rather than
      // discard them; a null time simply means "no cue".
      lines.push({ atMs: null, text: line });
      continue;
    }

    const body = line.slice(lastEnd).trim();
    // One line repeated at several timestamps becomes several lines. This is how a chorus is
    // written in LRC, and collapsing it would make the chorus appear only once.
    for (const at of stamps) lines.push({ atMs: at, text: body });
  }

  const offset = Number(meta.offset ?? 0);
  if (Number.isFinite(offset) && offset !== 0) {
    for (const l of lines) if (l.atMs !== null) l.atMs = Math.max(0, l.atMs - offset);
  }

  // Timed lines in order; untimed ones keep their position at the front, where headers live.
  lines.sort((a, b) => {
    if (a.atMs === null && b.atMs === null) return 0;
    if (a.atMs === null) return -1;
    if (b.atMs === null) return 1;
    return a.atMs - b.atMs;
  });

  return { format: 'lrc', lines, meta };
}

/** Which line is showing at this position. Null before the first cue. */
export function lineAt(parsed: ParsedLyrics, positionMs: number): number | null {
  if (parsed.format !== 'lrc') return null;
  let found: number | null = null;
  for (let i = 0; i < parsed.lines.length; i++) {
    const at = parsed.lines[i]!.atMs;
    if (at === null) continue;
    if (at <= positionMs) found = i;
    else break;
  }
  return found;
}

/** Reject before upload, with a reason the artist can act on. */
export function validateLyrics(raw: string): string | null {
  if (!raw.trim()) return 'That file is empty.';
  if (raw.length > LYRICS_MAX_CHARS) {
    return `Lyrics are limited to ${LYRICS_MAX_CHARS.toLocaleString()} characters.`;
  }
  // A binary file read as text is mostly replacement characters and control bytes. Catching
  // it here gives a real message instead of a database constraint error.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000E-\u001F]/.test(raw)) {
    return "That doesn't look like a text file — use .lrc or .txt.";
  }
  return null;
}
