import { useEffect, useState } from 'react';
import { ModalLayer } from './ModalLayer';
import { Button } from './Button';
import { Choice } from './RightsDeclarationForm';
import {
  TAKEDOWN_REASONS,
  composeTakedownReason,
  isTakedownReasonComplete,
  type TakedownReasonId,
} from '@shared/constants/takedownReasons';

/**
 * "Why is this coming down?" — asked properly.
 *
 * ── WHAT THIS REPLACES, AND WHY THAT HAD TO GO ─────────────────────────────
 *
 * Takedown and restore used `window.prompt`. Three things were wrong with it, in
 * increasing order of seriousness:
 *
 *   1. It is unstyleable browser chrome in the middle of a designed product — the same
 *      objection that bans `Alert.alert` in the app and `window.confirm` here
 *      (`ConfirmDialog`'s header states the rule).
 *   2. A single-line box cannot hold a warning. The "nothing is published" case had to be
 *      a SECOND dialog stacked in front of it, so the operator answered a question,
 *      then got asked another one.
 *   3. It produced whatever was typed under time pressure. That string is not an internal
 *      note: it is copied into `post_removals.reason` and shown to the creator as the
 *      whole explanation for why their upload vanished. "dup" is not an explanation.
 *
 * ── THE PRESET IS THE SENTENCE, THE NOTE IS THE SPECIFICS ──────────────────
 *
 * Picking a reason writes a complete sentence addressed to the creator; the note appends
 * the particulars ("the second verse, from 1:40"). Either alone is worse: the category
 * without specifics is impersonal, and specifics without the category leave the creator
 * guessing which rule they broke. `Something else` is the escape hatch and requires the
 * operator to write the sentence themselves.
 *
 * ── RESTORE ASKS THE SAME QUESTION WITHOUT THE PRESETS ─────────────────────
 *
 * A restore reason is an internal note — nobody is told "your track came back because
 * X" — so `mode="restore"` drops the vocabulary and keeps the box. Same component so the
 * two actions cannot drift apart visually.
 */
export function TakedownDialog({
  mode,
  trackTitle,
  trackIdShort,
  /** Rendered above the question when the action is probably not what they meant. */
  warning,
  /** What will actually be removed, in the operator's own words. */
  impact,
  busy,
  onConfirm,
  onCancel,
}: {
  mode: 'takedown' | 'restore';
  trackTitle: string;
  trackIdShort: string;
  warning?: string | null;
  impact?: string | null;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const isTakedown = mode === 'takedown';
  const [reasonId, setReasonId] = useState<TakedownReasonId | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  // A restore needs no category, so completeness is just "did they write anything".
  const ready = isTakedown
    ? isTakedownReasonComplete(reasonId, note)
    : note.trim().length > 0;

  const submit = () => {
    if (!ready || busy) return;
    onConfirm(isTakedown ? composeTakedownReason(reasonId, note) : note.trim());
  };

  return (
    <ModalLayer>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={isTakedown ? 'Take down this track' : 'Restore this track'}
        onMouseDown={e => {
          if (e.target === e.currentTarget && !busy) onCancel();
        }}
      >
        <div className="modal__panel takedown">
          <h3 className="confirm__title display">
            {isTakedown ? 'Take down' : 'Restore'} “{trackTitle}”
          </h3>
          <p className="hint takedown__id">Track {trackIdShort}</p>

          {/* Two uploads can share a title, and one of them having nothing published is
              the single strongest signal that the wrong row was clicked — which is
              exactly the mistake this warning exists because of. */}
          {warning && <p className="takedown__warning">{warning}</p>}
          {impact && <p className="hint">{impact}</p>}

          {isTakedown && (
            <fieldset className="rights__group takedown__reasons">
              <legend className="rights__legend">
                Why? The creator is shown this.
              </legend>
              {TAKEDOWN_REASONS.map(r => (
                <Choice
                  key={r.id}
                  label={r.label}
                  selected={reasonId === r.id}
                  onSelect={() => setReasonId(r.id)}
                  compact
                />
              ))}
            </fieldset>
          )}

          <label className="takedown__notelabel" htmlFor="takedown-note">
            {isTakedown
              ? reasonId === 'other'
                ? 'Write the reason the creator will read (required)'
                : 'Anything specific to add? (optional)'
              : 'Why is this being restored? (recorded in the ledger)'}
          </label>
          <textarea
            id="takedown-note"
            className="takedown__note"
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={busy}
            placeholder={
              isTakedown
                ? 'e.g. the second verse, from 1:40'
                : 'e.g. the uploader sent their distribution agreement'
            }
          />

          {isTakedown && (
            <p className="hint">
              The files are <strong>not</strong> removed — they stay reachable at their
              public URL. This can be undone.
            </p>
          )}

          <div className="filerow confirm__actions">
            <Button
              variant={isTakedown ? 'destructive' : 'primary'}
              busy={busy}
              disabled={!ready}
              onClick={submit}
            >
              {isTakedown ? 'Take it down' : 'Restore it'}
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </ModalLayer>
  );
}
