import { useMemo, useState } from 'react';
import { Button } from './Button';
import { TextField } from './TextField';
import {
  isDeclarationComplete,
  type Acknowledgement,
  type ClaimBasis,
  type ClaimScope,
  type RightsDeclaration,
} from '@shared/services/copyrightScan';

type Props = {
  /** What was matched, already formatted — see `describeMatch`. */
  matchDescription: string;
  onAnswer: (declaration: RightsDeclaration) => void;
};

/**
 * The rights declaration, shown inline on a queue row that matched a known recording.
 *
 * Inline rather than a page-level dialog because the batch uploader runs three at a time,
 * so several rows can be waiting at once and a modal could only ever address one.
 *
 * ── THE FOURTH OPTION IS THE ONE THAT MATTERS ───────────────────────────────
 *
 * "I think this match is wrong" exists because fingerprinting produces false positives —
 * covers, remixes, live takes, sampled material, thin regional catalogue coverage.
 * Without it a creator whose OWN work was wrongly matched must either abandon a
 * legitimate upload or click a claim that is not quite true. The second is worse: it
 * quietly devalues every honest row in the table.
 *
 * ── NOT ACCUSATORY, AND NOT A GATE ──────────────────────────────────────────
 *
 * A match is NOT evidence of infringement — the uploader may own the recording, hold a
 * licence, or be the artist. The copy asks a question; it does not deliver a verdict.
 *
 * And the declaration is recorded while the track publishes either way. Livil cannot hold
 * an upload pending review (ADR-0017 §D), so this UI must not imply that it does.
 *
 * The reference field takes an ISRC or catalogue number. That IDENTIFIES a recording and
 * says nothing about who may distribute it — friction and a cross-check, never a
 * credential. The helper text says so, deliberately.
 */
export function RightsDeclarationForm({ matchDescription, onAnswer }: Props) {
  const [choice, setChoice] = useState<Acknowledgement | null>(null);
  const [basis, setBasis] = useState<ClaimBasis | null>(null);
  const [grantor, setGrantor] = useState('');
  const [scope, setScope] = useState<ClaimScope[]>([]);
  const [territory, setTerritory] = useState('');
  const [term, setTerm] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [responsible, setResponsible] = useState(false);
  const [licence, setLicence] = useState(false);

  const declaration = useMemo<RightsDeclaration | null>(
    () =>
      choice
        ? {
            acknowledgement: choice,
            acceptedResponsibility: responsible,
            grantedStreamingLicence: licence,
            basis, grantor, scope, territory, term, reference, note,
          }
        : null,
    [choice, responsible, licence, basis, grantor, scope, territory, term, reference, note],
  );

  const toggleScope = (s: ClaimScope) =>
    setScope(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]));

  const ready = declaration !== null && isDeclarationComplete(declaration);

  return (
    <div className="rights">
      <p className="rights__title">We found a possible match</p>
      <p className="rights__body">
        This sounds like {matchDescription}. That does not always mean there is a problem.
        What is your right to upload this recording?
      </p>

      <div className="rights__choices">
        {/* Most common legitimate case first, and it asks for nothing. */}
        <Choice
          label="I made this recording myself"
          hint="I performed and recorded it, including a cover of someone else's song"
          selected={choice === 'self_recorded'}
          onSelect={() => setChoice('self_recorded')}
        />
        <Choice
          label="I hold the rights another way"
          hint="I did not make it, but the rights are mine"
          selected={choice === 'owner'}
          onSelect={() => setChoice('owner')}
        />
        <Choice
          label="I have permission or a licence"
          hint="Someone else owns it and authorised me"
          selected={choice === 'permission'}
          onSelect={() => setChoice('permission')}
        />
        <Choice
          label="I think this match is wrong"
          hint="This is not the recording it says it is"
          selected={choice === 'disputed'}
          onSelect={() => setChoice('disputed')}
        />
      </div>

      {choice === 'owner' && (
        <fieldset className="rights__group">
          <legend className="rights__legend">How did you get the rights?</legend>
          <Choice label="They were assigned or transferred to me" selected={basis === 'assigned'} onSelect={() => setBasis('assigned')} compact />
          <Choice label="My company or label owns them" selected={basis === 'company'} onSelect={() => setBasis('company')} compact />
          <Choice label="Something else" selected={basis === 'other'} onSelect={() => setBasis('other')} compact />
        </fieldset>
      )}

      {choice === 'permission' && (
        <fieldset className="rights__group">
          <legend className="rights__legend">Who gave you permission?</legend>
          <TextField
            label="Label, artist or distributor"
            value={grantor}
            onChange={e => setGrantor(e.target.value)}
          />

          <p className="rights__legend">What does it cover?</p>
          {/* A licence that excludes streaming, or excludes user-generated-content
              platforms, does not authorise this upload — and that stays invisible unless
              somebody asks. */}
          <Choice label="Streaming" selected={scope.includes('streaming')} onSelect={() => toggleScope('streaming')} compact shape="checkbox" />
          <Choice label="User-generated-content platforms" selected={scope.includes('ugc')} onSelect={() => toggleScope('ugc')} compact shape="checkbox" />
          <Choice label="Online distribution" selected={scope.includes('online_distribution')} onSelect={() => toggleScope('online_distribution')} compact shape="checkbox" />
          <Choice label="Commercial use" selected={scope.includes('commercial')} onSelect={() => toggleScope('commercial')} compact shape="checkbox" />
          <Choice label="Something else" selected={scope.includes('other')} onSelect={() => toggleScope('other')} compact shape="checkbox" />

          <TextField
            label="Territory (optional)"
            value={territory}
            onChange={e => setTerritory(e.target.value)}
          />
          <TextField
            label="Dates (optional)"
            value={term}
            onChange={e => setTerm(e.target.value)}
          />
        </fieldset>
      )}

      {choice !== null && (
        <fieldset className="rights__group">
          <TextField
            label="Reference number (optional)"
            value={reference}
            onChange={e => setReference(e.target.value)}
          />
          <p className="rights__help">
            This identifies the recording. It does not prove who may distribute it — it
            just helps us check we are talking about the same track.
          </p>
          <TextField
            label="Anything else we should know? (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </fieldset>
      )}

      {/* Ticked, not merely shown. The previous version displayed the responsibility line
          as text nobody could decline, and recorded nothing about whether they had even
          seen it. */}
      {choice !== null && (
        <div className="rights__consent">
          <Choice
            label="I am responsible for what I upload to Livil"
            selected={responsible}
            onSelect={() => setResponsible(v => !v)}
            compact
            shape="checkbox"
          />
          <Choice
            label="I grant Livil permission to stream this recording in the app"
            selected={licence}
            onSelect={() => setLicence(v => !v)}
            compact
            shape="checkbox"
          />
        </div>
      )}

      <div className="rights__actions">
        <Button
          size="sm"
          disabled={!ready}
          onClick={() => declaration && onAnswer(declaration)}
        >
          Submit and publish
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onAnswer({ acknowledgement: 'cancelled' })}
        >
          Cancel this upload
        </Button>
      </div>
    </div>
  );
}

/**
 * A selectable row. Native button so it is keyboard-reachable without extra wiring.
 *
 * SHAPE CARRIES MEANING, so it is not decoration: a circle means "pick one of these" and
 * a square means "pick any that apply". The scope list is genuinely multi-select — a
 * licence can cover streaming AND user-generated content — and rendering it identically
 * to the four mutually-exclusive options would tell the reader the wrong thing before
 * they have clicked anything.
 */
export function Choice({
  label,
  hint,
  selected,
  onSelect,
  compact = false,
  shape = 'radio',
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
  shape?: 'radio' | 'checkbox';
}) {
  return (
    <button
      type="button"
      className="rights__choice"
      data-selected={selected}
      data-compact={compact}
      data-shape={shape}
      role={shape === 'radio' ? 'radio' : 'checkbox'}
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className="rights__dot" aria-hidden="true" />
      <span className="rights__choicetext">
        <span className="rights__choicelabel">{label}</span>
        {hint && <span className="rights__choicehint">{hint}</span>}
      </span>
    </button>
  );
}
