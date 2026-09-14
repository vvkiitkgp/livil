/**
 * LRC parsing.
 *
 * Worth pinning because every failure here is silent and looks like content: a mis-parsed
 * timestamp shows the wrong line at the wrong moment, and a dropped one deletes a lyric
 * nobody notices is missing. There is no error to catch.
 */
import {
  detectFormat,
  lineAt,
  parseLyrics,
  validateLyrics,
  LYRICS_MAX_CHARS,
} from '../../../shared/services/lyrics';

describe('detectFormat', () => {
  it('treats any timestamped line as LRC', () => {
    expect(detectFormat('[00:12.00]hello')).toBe('lrc');
  });

  it('treats a file with no timestamps as plain', () => {
    expect(detectFormat('just\nsome\nwords')).toBe('plain');
  });

  it('still detects LRC when the file opens with untimed header lines', () => {
    // Real LRC files routinely carry a title before the first cue. Requiring every line to be
    // timed would misclassify most of them as plain text.
    expect(detectFormat('My Song\n[ar:Someone]\n[00:05.00]first')).toBe('lrc');
  });
});

describe('parseLyrics — plain', () => {
  it('keeps every line, untimed', () => {
    const p = parseLyrics('one\ntwo\nthree');
    expect(p.format).toBe('plain');
    expect(p.lines.map(l => l.text)).toEqual(['one', 'two', 'three']);
    expect(p.lines.every(l => l.atMs === null)).toBe(true);
  });

  it('handles Windows line endings', () => {
    expect(parseLyrics('one\r\ntwo').lines.map(l => l.text)).toEqual(['one', 'two']);
  });
});

describe('parseLyrics — LRC timing', () => {
  it('reads minutes, seconds and centiseconds', () => {
    const p = parseLyrics('[01:23.45]line');
    expect(p.lines[0]!.atMs).toBe(83_450);
  });

  it('reads a timestamp with no fraction', () => {
    expect(parseLyrics('[00:30]line').lines[0]!.atMs).toBe(30_000);
  });

  it('treats a three-digit fraction as milliseconds', () => {
    expect(parseLyrics('[00:01.500]line').lines[0]!.atMs).toBe(1_500);
  });

  it('treats a one-digit fraction as centiseconds, not milliseconds', () => {
    // `.5` means 50 centiseconds in the overwhelming convention — reading it as 5 ms would
    // put the line half a second early.
    expect(parseLyrics('[00:01.5]line').lines[0]!.atMs).toBe(1_500);
  });

  it('accepts a colon before the fraction, which some tools emit', () => {
    expect(parseLyrics('[00:01:50]line').lines[0]!.atMs).toBe(1_500);
  });

  it('handles timestamps past an hour', () => {
    expect(parseLyrics('[75:00.00]line').lines[0]!.atMs).toBe(4_500_000);
  });
});

describe('parseLyrics — LRC structure', () => {
  it('expands a line repeated at several timestamps', () => {
    // This is how a chorus is written. Collapsing it would show the chorus once.
    const p = parseLyrics('[00:10.00][01:00.00][02:00.00]chorus');
    expect(p.lines).toHaveLength(3);
    expect(p.lines.map(l => l.atMs)).toEqual([10_000, 60_000, 120_000]);
    expect(p.lines.every(l => l.text === 'chorus')).toBe(true);
  });

  it('captures metadata tags without rendering them as lyrics', () => {
    const p = parseLyrics('[ar:Someone]\n[ti:A Song]\n[00:01.00]words');
    expect(p.meta).toMatchObject({ ar: 'Someone', ti: 'A Song' });
    expect(p.lines.map(l => l.text)).toEqual(['words']);
  });

  it('applies a negative offset by shifting lines later', () => {
    const p = parseLyrics('[offset:-500]\n[00:10.00]line');
    expect(p.lines[0]!.atMs).toBe(10_500);
  });

  it('never shifts a line before zero', () => {
    expect(parseLyrics('[offset:5000]\n[00:01.00]line').lines[0]!.atMs).toBe(0);
  });

  it('sorts out-of-order timestamps', () => {
    const p = parseLyrics('[00:30.00]second\n[00:10.00]first');
    expect(p.lines.map(l => l.text)).toEqual(['first', 'second']);
  });

  it('keeps an empty timed line as an instrumental gap', () => {
    const p = parseLyrics('[00:10.00]words\n[00:20.00]');
    expect(p.lines).toHaveLength(2);
    expect(p.lines[1]).toEqual({ atMs: 20_000, text: '' });
  });

  it('keeps an untimed line rather than discarding its words', () => {
    const p = parseLyrics('My Song\n[00:01.00]first');
    expect(p.lines.map(l => l.text)).toContain('My Song');
  });

  it('does not treat a bracketed time INSIDE the words as a cue', () => {
    // "meet me at [03:00] tonight" is content. Reading it as a cue would delete "meet me at".
    const p = parseLyrics('[00:05.00]meet me at [03:00] tonight');
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.text).toBe('meet me at [03:00] tonight');
    expect(p.lines[0]!.atMs).toBe(5_000);
  });
});

describe('lineAt', () => {
  const p = parseLyrics('[00:10.00]a\n[00:20.00]b\n[00:30.00]c');

  it('returns null before the first cue', () => {
    expect(lineAt(p, 0)).toBeNull();
  });

  it('holds a line until the next cue', () => {
    expect(lineAt(p, 10_000)).toBe(0);
    expect(lineAt(p, 19_999)).toBe(0);
    expect(lineAt(p, 20_000)).toBe(1);
  });

  it('holds the last line past the end', () => {
    expect(lineAt(p, 999_999)).toBe(2);
  });

  it('returns null for plain text, which has nothing to sync to', () => {
    expect(lineAt(parseLyrics('words'), 5_000)).toBeNull();
  });
});

describe('validateLyrics', () => {
  it('rejects an empty file', () => {
    expect(validateLyrics('   ')).toMatch(/empty/i);
  });

  it('rejects a file over the column limit', () => {
    expect(validateLyrics('x'.repeat(LYRICS_MAX_CHARS + 1))).toMatch(/limited/i);
  });

  it('rejects a binary file read as text', () => {
    // Otherwise this surfaces as a database constraint error with no useful message.
    expect(validateLyrics('lyrics\u0000\u0001binary')).toMatch(/text file/i);
  });

  it('accepts a normal LRC', () => {
    expect(validateLyrics('[00:01.00]hello\n[00:05.00]world')).toBeNull();
  });

  it('accepts accented and non-Latin text', () => {
    expect(validateLyrics('déjà vu\nनमस्ते\n日本語')).toBeNull();
  });
});
