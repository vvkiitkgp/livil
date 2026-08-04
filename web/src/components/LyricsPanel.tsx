import { useMemo, useRef, useState } from 'react';
import {
  LYRICS_MAX_CHARS,
  detectFormat,
  parseLyrics,
  validateLyrics,
  type LyricsFormat,
} from '@shared/services/lyrics';
import { Button } from './Button';

/**
 * Attach, review and remove a track's lyrics.
 *
 * WEB ONLY, deliberately. An `.lrc` is a desktop artifact — produced by a DAW or a syncing
 * tool — and not something an artist attaches from a phone. Mobile will READ lyrics
 * (LIV-90) and never write them.
 *
 * The parsed preview is the point of this panel, not decoration. LRC failures are silent by
 * nature: a mis-timed file still renders, it just shows the wrong words at the wrong moment,
 * and nobody discovers that until a listener does. Showing the parsed timings back means the
 * artist can see that line one lands at 0:12 before publishing.
 */
export function LyricsPanel({
  lyrics,
  format,
  busy,
  onSave,
  onRemove,
}: {
  lyrics: string | null;
  format: LyricsFormat | null;
  busy: boolean;
  onSave: (raw: string, format: LyricsFormat) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => (lyrics ? parseLyrics(lyrics, format ?? undefined) : null),
    [lyrics, format],
  );

  async function onPick(file: File) {
    setError(null);
    // A lyrics file is kilobytes. Anything far past the column limit is the wrong file, and
    // saying so beats reading megabytes to reject them.
    if (file.size > LYRICS_MAX_CHARS * 4) {
      setError('That file is too large to be lyrics.');
      return;
    }
    try {
      const raw = await file.text();
      const problem = validateLyrics(raw);
      if (problem) {
        setError(problem);
        return;
      }
      onSave(raw, detectFormat(raw));
    } catch {
      setError('Could not read that file.');
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Lyrics</h2>
        {parsed && (
          <span className="hint">
            {parsed.format === 'lrc'
              ? `synced · ${parsed.lines.filter(l => l.atMs !== null).length} cues`
              : `${parsed.lines.length} lines`}
          </span>
        )}
      </div>

      {!parsed && (
        <p className="hint">
          Attach a <code>.lrc</code> for lyrics that follow the music, or a{' '}
          <code>.txt</code> for plain words. Listeners see them on the track.
        </p>
      )}

      {parsed && (
        <div className="lyrics">
          {parsed.lines.slice(0, 60).map((line, i) => (
            <div className="lyrics__line" key={i}>
              {line.atMs !== null && (
                <span className="lyrics__at">{formatCue(line.atMs)}</span>
              )}
              <span className={line.text ? undefined : 'lyrics__gap'}>
                {line.text || '♪'}
              </span>
            </div>
          ))}
          {parsed.lines.length > 60 && (
            <p className="hint">…and {parsed.lines.length - 60} more lines</p>
          )}
        </div>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="filerow">
        <Button
          variant="secondary"
          size="sm"
          busy={busy}
          onClick={() => inputRef.current?.click()}
        >
          {parsed ? 'Replace lyrics' : 'Attach lyrics'}
        </Button>
        {parsed && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".lrc,.txt,text/plain"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function formatCue(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
