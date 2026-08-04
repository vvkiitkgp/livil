import { useEffect } from 'react';
import { Button } from './Button';

/**
 * Confirmation modal.
 *
 * The mobile app forbids `Alert.alert` because the OS dialog clashes with the dark theme and
 * looks unprofessional. `window.confirm` is the same failure on web — unstyleable browser
 * chrome in the middle of a designed product — so this is its twin rule: never
 * `window.confirm`, never `window.alert`.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape closes. A modal that can only be dismissed by hitting the right button is a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={e => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="modal__panel confirm">
        <h3 className="confirm__title display">{title}</h3>
        <p className="hint">{body}</p>
        <div className="filerow confirm__actions">
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
