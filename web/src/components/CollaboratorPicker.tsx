import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { TextField } from './TextField';
import { searchProfiles, type ProfileMatch } from '../data/collaborators';
import { AI_ROLES, ROLES, type PendingCollaborator } from '@shared/constants/roles';
import { ROLE_MAX_LENGTH } from '@shared/services/publishTrack';

/**
 * Adding a credit.
 *
 * Two ways to name somebody, and the database allows exactly one of them per row
 * (`collab_user_xor_custom`): a Livil profile, or a name typed by hand for the drummer who
 * has no account. The tabs exist to make that XOR obvious in the UI rather than discovered
 * as a constraint error after the upload.
 *
 * An AI tool is credited through those same two choices, not a third one. The company holds
 * a profile like anybody else — tag it if it is here, type the name if it is not — and what
 * makes the credit an AI credit is the ROLE. Modelling it the other way would have meant a
 * tool could only ever be typed, never tagged, and a tagged profile is what makes a credit
 * verifiable rather than a claim.
 *
 * A modal, matching `CoverCropper` and `VideoPreview`, rather than the mobile app's
 * full-screen picker route — there is no navigation stack here, and a credit is a detail of
 * the row you are already looking at.
 *
 * Crediting a profile creates a PENDING row. The person confirms in the app; the uploader
 * does not get to assert someone else's involvement on their behalf. The copy says so,
 * because "added" would read as settled.
 */
export function CollaboratorPicker({
  scope,
  excludeUserIds,
  onAdd,
  onClose,
}: {
  /** What the credit will be attached to, so the button can say it. */
  scope: { label: string; trackCount: number };
  /** Already credited on this row — a profile cannot be credited twice for one track. */
  excludeUserIds: string[];
  onAdd: (collaborator: PendingCollaborator) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'user' | 'custom'>('user');
  const [query, setQuery] = useState('');
  const [customName, setCustomName] = useState('');
  const [selected, setSelected] = useState<ProfileMatch | null>(null);
  const [role, setRole] = useState('');
  /** Typing a role rather than picking one — the chip row and the field share `role`. */
  const [custom, setCustom] = useState(false);
  const [results, setResults] = useState<ProfileMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'user') return;
    let cancelled = false;
    setSearching(true);
    // Debounced: a query per keystroke is a query per keystroke against a table every
    // authenticated user can read.
    const timer = setTimeout(() => {
      searchProfiles(query, { excludeUserIds })
        .then(found => {
          if (cancelled) return;
          setResults(found);
          setError('');
        })
        .catch(() => {
          if (!cancelled) setError('Could not search right now.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `excludeUserIds` is a fresh array each render; its CONTENT is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, excludeUserIds.join(',')]);

  const named = mode === 'user' ? selected !== null : customName.trim().length > 0;
  const ready = named && role.trim().length > 0;

  const heading = useMemo(
    () => (scope.trackCount > 1 ? `Credit on all ${scope.trackCount} tracks` : 'Add a credit'),
    [scope.trackCount],
  );

  function submit() {
    if (!ready) return;
    onAdd(
      mode === 'user'
        ? {
            clientId: `${selected!.id}-${role}`,
            kind: 'user',
            userId: selected!.id,
            name: selected!.displayName || selected!.username,
            username: selected!.username,
            avatarUrl: selected!.avatarUrl ?? undefined,
            role: role.trim(),
          }
        : {
            // No id to key on, so the typed name and role make one. Crediting the same
            // person twice for the same role is the case this collapses, which is right.
            clientId: `custom-${customName.trim().toLowerCase()}-${role}`,
            kind: 'custom',
            name: customName.trim(),
            role: role.trim(),
          },
    );
    onClose();
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__panel picker">
        <h3 className="card__title">{heading}</h3>
        <p className="hint">{scope.label}</p>

        <div className="picker__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'user'}
            className="picker__tab"
            data-active={mode === 'user' || undefined}
            onClick={() => setMode('user')}
          >
            On Livil
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'custom'}
            className="picker__tab"
            data-active={mode === 'custom' || undefined}
            onClick={() => setMode('custom')}
          >
            Not on Livil
          </button>
        </div>

        {mode === 'user' ? (
          <>
            <TextField
              label="Search people"
              value={query}
              autoFocus
              placeholder="Name, @handle, or an AI tool"
              onChange={e => {
                setQuery(e.target.value);
                setSelected(null);
              }}
            />
            <div className="picker__results">
              {searching && results.length === 0 && <p className="hint">Searching…</p>}
              {!searching && results.length === 0 && (
                <p className="hint">
                  Nobody by that name. Credit them under &ldquo;Not on Livil&rdquo; instead —
                  the credit still shows on the track.
                </p>
              )}
              {results.map(person => (
                <button
                  type="button"
                  key={person.id}
                  className="picker__person"
                  data-selected={selected?.id === person.id || undefined}
                  onClick={() => setSelected(person)}
                >
                  <Avatar url={person.avatarUrl} name={person.displayName || person.username} size={32} />
                  <span className="picker__person-main">
                    <span className="picker__person-name">
                      {person.displayName || person.username}
                    </span>
                    <span className="hint">@{person.username}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <TextField
            label="Name"
            value={customName}
            autoFocus
            placeholder="Who played on it, or what you used"
            maxLength={60}
            onChange={e => setCustomName(e.target.value)}
          />
        )}

        <div className="picker__roles">
          <p className="picker__label">Role</p>
          <div className="chiprow">
            {ROLES.map(r => (
              <button
                type="button"
                key={r}
                className="rolechip"
                data-active={!custom && role === r || undefined}
                onClick={() => {
                  setCustom(false);
                  setRole(r);
                }}
              >
                {r}
              </button>
            ))}
          </div>

          {/* A separate group, not six more chips in the list above. A generated vocal is
              not "Vocals", and somebody picking their instrument should not scroll past
              the AI entries to reach "Bass". */}
          <p className="picker__label picker__label--sub">Made with AI</p>
          <div className="chiprow">
            {AI_ROLES.map(r => (
              <button
                type="button"
                key={r}
                className="rolechip"
                data-ai
                data-active={!custom && role === r || undefined}
                onClick={() => {
                  setCustom(false);
                  setRole(r);
                }}
              >
                {r}
              </button>
            ))}
          </div>

          {/* The list will always be missing somebody's instrument — a sitar, a modular
              rig, "Additional production". A closed list would just mean the wrong credit
              or none. The column takes free text; only the length is enforced. */}
          <div className="chiprow picker__other">
            <button
              type="button"
              className="rolechip"
              data-active={custom || undefined}
              onClick={() => {
                setCustom(true);
                setRole('');
              }}
            >
              Something else…
            </button>
            {custom && (
              <input
                className="rolechip rolechip--input"
                value={role}
                autoFocus
                maxLength={ROLE_MAX_LENGTH}
                placeholder="Sitar, modular, mix notes…"
                aria-label="Custom role"
                onChange={e => setRole(e.target.value)}
              />
            )}
          </div>
        </div>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <p className="hint">
          {mode === 'user'
            ? 'They confirm the credit in the Livil app before it shows publicly.'
            : 'Shown as a credit on the track. Nobody is notified.'}
        </p>

        <div className="filerow picker__actions">
          <Button disabled={!ready} onClick={submit}>
            {scope.trackCount > 1 ? `Add to all ${scope.trackCount}` : 'Add credit'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
