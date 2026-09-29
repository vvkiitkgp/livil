import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { CoverCropper } from '../components/CoverCropper';
import { VideoPreview } from '../components/VideoPreview';
import { CoverThumb } from '../components/CoverThumb';
import { CollaboratorPicker } from '../components/CollaboratorPicker';
import { TagField } from '../components/TagField';
import { LevelMeter } from '../components/LevelMeter';
import { usePreviewPlayer, type PreviewState } from '../upload/preview';
import { MAX_WEB_UPLOAD_BYTES } from '@shared/services/media';
import { filesFromDataTransfer, pairAssets } from '../upload/files';
import { mergeCredits } from '../upload/credits';
import { describeQuality } from '../upload/quality';
import {
  HELD_STATUSES,
  LOCKED_STATUSES,
  itemsFromPaired,
  useUploadQueue,
  type QueueItem,
} from '../upload/queue';
import type { Acknowledgement } from '@shared/services/copyrightScan';
import { Choice, RightsDeclarationForm } from '../components/RightsDeclarationForm';
import { ROLES, getChipTone, isPresetRole } from '@shared/constants/roles';
import { mergeTags } from '@shared/constants/tags';
import { ROLE_MAX_LENGTH } from '@shared/services/publishTrack';

/** Sentinel for the dropdown's "type your own" entry — never a stored role. */
const CUSTOM_ROLE = '__custom__';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** The quality reading for a queued item — bitrate for audio, frame size for video. */
const qualityOf = (item: QueueItem) =>
  describeQuality({ ...item, name: item.media.name, size: item.media.size });

const formatSize = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const isEditable = (item: QueueItem) => !LOCKED_STATUSES.has(item.status);

/**
 * The steps, in order. Each has one job, so a batch of twelve is twelve small decisions
 * per screen rather than one screen holding every decision about every track at once.
 *
 * `rights` is only in the list when the copyright check actually matched something — for
 * most uploads it never appears.
 */
type StepKey = 'files' | 'details' | 'credits' | 'tags' | 'check' | 'rights' | 'publish';

const STEP_LABELS: Record<StepKey, string> = {
  files: 'Files',
  details: 'Details',
  credits: 'Credits',
  tags: 'Tags',
  check: 'Copyright',
  rights: 'Rights',
  publish: 'Publish',
};

/** What the artist said, in their words, for the review step. */
const ANSWER_LABELS: Record<Exclude<Acknowledgement, 'cancelled'>, string> = {
  self_recorded: 'You said you made this recording',
  owner: 'You said you hold the rights',
  permission: 'You said you have permission or a licence',
  disputed: 'You said the match is wrong',
};

/**
 * Batch upload, as a sequence of steps. A single track is just a queue of one, so there is
 * no separate code path for it.
 *
 * Steps 1–4 only edit rows in memory; nothing leaves the machine. Step 5 uploads the files
 * and runs the copyright check, then PARKS every track — uploaded, but with no post and no
 * credits, so nobody can see it. Only the final Publish press releases them. That split is
 * what makes the check a step the artist can read and act on, rather than something that
 * happens somewhere inside a single Publish click.
 */
export function Upload() {
  const queue = useUploadQueue();
  const preview = usePreviewPlayer();
  const [dragging, setDragging] = useState(false);
  const [busyReadingDrop, setBusyReadingDrop] = useState(false);
  const [stepKey, setStepKey] = useState<StepKey>('files');
  const [publishing, setPublishing] = useState(false);
  /**
   * The streaming grant, ticked for the whole batch next to Publish. Required on EVERY
   * upload, not only matched ones: the grant is recorded per track at the Publish press
   * (`recordUploadConsent`), and a record of consent nobody was asked for is not consent.
   */
  const [grantedStreaming, setGrantedStreaming] = useState(false);
  // Set when the last track was cancelled out of a later step and the flow restarted, so
  // step 1 can say why it is suddenly empty. Cleared as soon as files are added again.
  const [restarted, setRestarted] = useState(false);

  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // 'ALL' applies the chosen art to every not-yet-started row.
  const coverForId = useRef<string | 'ALL' | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  // The cropper is modal, so at most one is open at a time.
  const [cropping, setCropping] = useState<{ id: string | 'ALL'; file: File } | null>(null);
  // Video cannot share the audio preview element — you would hear the clip and never see
  // it, which is not what "check what I'm uploading" means for a video. Held by id so the
  // modal keeps up with a title edit and with the metadata probe landing.
  const [watchingId, setWatchingId] = useState<string | null>(null);
  // 'ALL' credits every not-yet-started row at once — the same scope as the cover-art
  // control, and for the same reason: an album is the same people twelve times.
  const [creditingId, setCreditingId] = useState<string | 'ALL' | null>(null);
  // What the batch tag field is showing. Not the truth about any row — each row owns its own
  // list — just the record of what has been applied to the batch so far, so the field can
  // tell a new tag from one already sent.
  const [batchTags, setBatchTags] = useState<string[]>([]);

  function accept(files: File[]) {
    const { items } = pairAssets(files);
    if (items.length > 0) {
      setRestarted(false);
      queue.add(itemsFromPaired(items));
    }
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    setBusyReadingDrop(true);
    try {
      // Walks directory entries — a dropped folder yields no `files` without this.
      accept(await filesFromDataTransfer(event.dataTransfer));
    } finally {
      setBusyReadingDrop(false);
    }
  }

  const pending = queue.items.filter(i => i.status === 'pending' || i.status === 'failed');
  const done = queue.items.filter(i => i.status === 'done');
  const failed = queue.items.filter(i => i.status === 'failed');
  const inFlight = queue.items.filter(
    i => i.status === 'uploading' || i.status === 'checking' || i.status === 'publishing',
  );
  const awaitingRights = queue.items.filter(i => i.status === 'awaiting_rights');
  const ready = queue.items.filter(i => i.status === 'ready');
  const held = queue.items.filter(i => HELD_STATUSES.has(i.status));
  // Everything the review step lists: the parked tracks plus any that already published.
  const reviewable = queue.items.filter(
    i => i.status === 'ready' || i.status === 'publishing' || i.status === 'done',
  );
  const answered = queue.items.filter(i => i.rightsAnswer !== null);
  const missingArt = pending.filter(i => !i.image).length;
  const missingRole = pending.filter(i => !i.uploaderRole.trim()).length;
  const oversize = pending.filter(i => i.media.size > MAX_WEB_UPLOAD_BYTES).length;
  // Nothing left to do: the run is over and something actually published.
  const finished =
    !queue.running &&
    done.length > 0 &&
    pending.length === 0 &&
    held.length === 0 &&
    inFlight.length === 0;

  const steps: StepKey[] = [
    'files',
    'details',
    'credits',
    'tags',
    'check',
    // Present while there is a match to answer, and afterwards so the answer stays
    // reviewable — it would be strange for a step you just completed to vanish.
    ...(awaitingRights.length > 0 || answered.length > 0 ? (['rights'] as const) : []),
    'publish',
  ];

  /**
   * Whether each step is complete enough to move past. Computed over the rows still
   * editable — a row already uploaded was validated before it went.
   */
  const complete: Record<StepKey, boolean> = {
    files: queue.items.length > 0 && oversize === 0,
    details: missingArt === 0,
    credits: missingRole === 0,
    tags: true,
    check:
      pending.length === 0 &&
      !queue.running &&
      inFlight.length === 0 &&
      (held.length > 0 || done.length > 0),
    rights: awaitingRights.length === 0,
    publish: finished,
  };
  // A step is reachable when every step before it is complete, so the stepper can be used
  // to jump back and forth without skipping a requirement.
  const reachable = (key: StepKey) => steps.slice(0, steps.indexOf(key)).every(k => complete[k]);

  // A step can leave the list while it is showing — the rights step, when its only matched
  // row is withdrawn. Land on the next sensible step rather than on nothing.
  const step: StepKey = steps.includes(stepKey)
    ? stepKey
    : reachable('publish')
      ? 'publish'
      : 'check';
  const stepIndex = steps.indexOf(step);

  const go = (key: StepKey) => {
    if (reachable(key)) setStepKey(key);
  };
  const next = () => {
    const following = steps[stepIndex + 1];
    if (following && complete[step]) setStepKey(following);
  };
  const back = () => {
    const previous = steps[stepIndex - 1];
    if (previous) setStepKey(previous);
  };

  /**
   * A finished run ends the artist's business with this screen, so it hands them back to
   * Overview rather than leaving them on a spent form — which reads as "nothing happened".
   * The confirmation travels with them as route state; Overview announces it there, next
   * to the recent-uploads list the new tracks now appear in.
   *
   * `replace` because Back must not return to an upload screen whose queue died with the
   * unmount. The ref only guards against firing twice under StrictMode's double effect —
   * `finished` cannot go true again from here, since navigating unmounts this.
   */
  const navigate = useNavigate();
  const handedOff = useRef(false);
  useEffect(() => {
    if (!finished || handedOff.current) return;
    handedOff.current = true;
    navigate('/', { replace: true, state: { published: done.length } });
  }, [finished, done.length, navigate]);

  /**
   * Closing the tab while tracks are uploaded but unpublished would strand them — uploaded,
   * never posted, and invisible to the artist. The browser's own "leave site?" prompt is
   * the only thing that can interrupt a tab close.
   */
  /**
   * Cancelling the only track left — at the rights question, or with ✕ on the review step —
   * leaves every later step with nothing to show. Start over at step 1 rather than leave the
   * artist on an empty Rights or Publish page. Its uploaded files are already gone: removal
   * rolls the track back.
   */
  const empty = queue.items.length === 0;
  useEffect(() => {
    if (empty && stepKey !== 'files') {
      setStepKey('files');
      setRestarted(true);
    }
  }, [empty, stepKey]);

  const unsaved = inFlight.length + held.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // The meter outlives playback on purpose: pausing, or a track running out, is exactly
  // when the artist wants to read the verdict. It goes away when the row it measured does.
  const [meteredId, setMeteredId] = useState<string | null>(null);
  if (preview.playingId && preview.playingId !== meteredId) setMeteredId(preview.playingId);
  const metered = queue.items.find(i => i.id === meteredId) ?? null;
  const watching = queue.items.find(i => i.id === watchingId) ?? null;
  // For 'ALL' the picker still needs a row to read already-credited people from, so it
  // excludes them from search; the first pending row stands in for the batch.
  const crediting =
    creditingId === 'ALL'
      ? pending[0] ?? null
      : queue.items.find(i => i.id === creditingId) ?? null;

  const removeItem = (item: QueueItem) => {
    if (preview.playingId === item.id) preview.stop();
    queue.remove(item.id);
  };
  const pickCover = (id: string | 'ALL') => {
    coverForId.current = id;
    coverInput.current?.click();
  };
  /**
   * Copy one track's cover onto every other not-yet-uploaded track. The common case is a
   * single file that carried its artwork in its tag while the rest of the album did not —
   * making the artist hunt down that same image on disk to use "cover art for all" is
   * busywork. Overwrites, like "cover art for all": it is only reachable by asking for it.
   */
  const applyCoverToAll = (source: QueueItem) => {
    if (!source.image) return;
    const image = source.image;
    queue.patchPendingWith(item =>
      item.id === source.id ? {} : { image, artFromTag: false, error: null },
    );
  };
  // Offered on a row only when there is somewhere for its cover to go.
  const canShareCover = (item: QueueItem) =>
    !!item.image &&
    isEditable(item) &&
    pending.some(other => other.id !== item.id && other.image !== item.image);
  const shareCoverButton = (item: QueueItem) =>
    canShareCover(item) && (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => applyCoverToAll(item)}
        title="Use this track's cover art on every track in this upload"
        aria-label={`Use the cover art of ${item.title || item.media.name} for all tracks`}
      >
        Use for all
      </Button>
    );

  // ── Step bodies ──────────────────────────────────────────────────────────

  const filesStep = (
    <>
      {restarted && (
        <p className="stepnote" role="status">
          Upload cancelled — nothing was published and the uploaded files were removed. Add
          files to start again.
        </p>
      )}
      <StepIntro
        title="Add your tracks"
        action={
          pending.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => pickCover('ALL')}>
              Cover art for all {pending.length}
            </Button>
          )
        }
      >
        Audio or video, one file or a whole folder. Cover art in the same folder is matched
        to its track by filename.
      </StepIntro>
      <div
        className="dropzone"
        data-dragging={dragging || undefined}
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="dropzone__title">
          {busyReadingDrop ? 'Reading folder…' : 'Drop tracks or a whole folder here'}
        </p>
        <p className="hint">
          Up to {formatSize(MAX_WEB_UPLOAD_BYTES)} each · uploads resume if your connection
          drops · cover art matched by filename
        </p>
        <div className="filerow">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => filesInput.current?.click()}
          >
            Choose files
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => folderInput.current?.click()}
          >
            Choose folder
          </Button>
        </div>
        <input
          ref={filesInput}
          type="file"
          multiple
          accept="audio/*,video/*,image/*"
          hidden
          onChange={e => {
            accept(Array.from(e.target.files ?? []));
            // Cleared so choosing the same file again after removing it still fires.
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          webkitdirectory=""
          hidden
          onChange={e => {
            accept(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {queue.items.length > 0 && (
        <ul className="queue">
          {queue.items.map(item => (
            <li key={item.id} className="queue__row" data-status={item.status}>
              <CoverThumb
                file={item.image}
                onClick={() => pickCover(item.id)}
                disabled={!isEditable(item)}
              />
              <div className="queue__main">
                <span className="queue__name">{item.title || item.media.name}</span>
                <FileLine item={item} />
                {item.media.size > MAX_WEB_UPLOAD_BYTES && (
                  <span className="queue__error">
                    Over the {formatSize(MAX_WEB_UPLOAD_BYTES)} limit — remove this file.
                  </span>
                )}
                <LockedNote item={item} />
                <SeekBar item={item} preview={preview} />
              </div>
              <div className="queue__side">
                {shareCoverButton(item)}
                <PreviewButton
                  item={item}
                  preview={preview}
                  onWatch={() => setWatchingId(item.id)}
                />
                {isEditable(item) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item)}
                    aria-label="Remove"
                  >
                    ✕
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {oversize > 0 && (
        <p className="alert" role="alert">
          {oversize} file{oversize === 1 ? ' is' : 's are'} over the{' '}
          {formatSize(MAX_WEB_UPLOAD_BYTES)} limit.
        </p>
      )}
    </>
  );

  const detailsStep = (
    <>
      <StepIntro
        title="Name them and add cover art"
        action={
          pending.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => pickCover('ALL')}>
              Cover art for all {pending.length}
            </Button>
          )
        }
      >
        Titles start from the filename. Click the square to add or change a track's cover
        art — every track needs one. “Use for all” copies a track's cover to the rest.
      </StepIntro>
      <ul className="queue">
        {queue.items.map(item => {
          const locked = !isEditable(item);
          return (
            <li
              key={item.id}
              className="queue__row"
              data-status={item.status}
              data-missing={(!locked && !item.image) || undefined}
            >
              <CoverThumb
                file={item.image}
                onClick={() => pickCover(item.id)}
                disabled={locked}
              />
              <div className="queue__main">
                {/* Captioned rather than bare: two unlabelled boxes in a row leave the
                    artist guessing which is which, and the title arrives prefilled from
                    the filename so nothing in the value itself says what it is. */}
                <label className="queue__labelled">
                  <span className="queue__label">Title</span>
                  <input
                    className="queue__field queue__title"
                    value={item.title}
                    onChange={e => queue.patch(item.id, { title: e.target.value })}
                    disabled={locked}
                    placeholder="Track title"
                  />
                </label>
                {/* "Description" asked for metadata and got blank fields. The caption asks
                    the artist for the one thing only they can write — what the track is to
                    them. */}
                <label className="queue__labelled">
                  <span className="queue__label">How you feel about it</span>
                  <input
                    className="queue__field queue__desc"
                    value={item.description}
                    onChange={e => queue.patch(item.id, { description: e.target.value })}
                    disabled={locked}
                    placeholder="Optional — what this one means to you"
                  />
                </label>
                <FileLine item={item} />
                {!locked && !item.image && (
                  <span className="queue__error">Needs cover art — click the square.</span>
                )}
                <LockedNote item={item} />
                <SeekBar item={item} preview={preview} />
              </div>
              <div className="queue__side">
                {shareCoverButton(item)}
                <PreviewButton
                  item={item}
                  preview={preview}
                  onWatch={() => setWatchingId(item.id)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {missingArt > 0 && (
        <p className="alert" role="alert">
          {missingArt} {missingArt === 1 ? 'track needs' : 'tracks need'} cover art before
          publishing.
        </p>
      )}
    </>
  );

  const creditsStep = (
    <>
      <StepIntro
        title="Who made it"
        action={
          pending.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => setCreditingId('ALL')}>
              Credits for all {pending.length}
            </Button>
          )
        }
      >
        Say what you did on each track, then credit everyone else. People you tag confirm
        their credit in the app.
      </StepIntro>
      <ul className="queue">
        {queue.items.map(item => (
          <li
            key={item.id}
            className="queue__row"
            data-status={item.status}
            data-missing={(isEditable(item) && !item.uploaderRole.trim()) || undefined}
          >
            <CoverThumb file={item.image} onClick={() => pickCover(item.id)} disabled />
            <div className="queue__main">
              <span className="queue__name">{item.title || item.media.name}</span>
              <CreditsEditor
                item={item}
                locked={!isEditable(item)}
                onUploaderRole={role => queue.patch(item.id, { uploaderRole: role })}
                onAddCredit={() => setCreditingId(item.id)}
                onRemoveCredit={clientId =>
                  queue.patch(item.id, {
                    collaborators: item.collaborators.filter(c => c.clientId !== clientId),
                  })
                }
              />
              <LockedNote item={item} />
            </div>
          </li>
        ))}
      </ul>
      {missingRole > 0 && (
        <p className="alert" role="alert">
          {missingRole === 1 ? 'One track needs' : `${missingRole} tracks need`} your own role.
          A credit list that names everyone except the person who made the record is not a
          credit list.
        </p>
      )}
    </>
  );

  const tagsStep = (
    <>
      <StepIntro title="How people find it">
        Take off the moods a track isn't with ×, and type your own into the box — press space
        or Enter after each one. Listeners never see these — they feed search.
      </StepIntro>

      {/* Tags for the whole batch. Appends on every commit, like "credits for all" and for
          the same reason: a row may already carry a tag set on it individually, and
          replacing would throw that away.

          Removing a chip here removes it from this field only. Un-applying a tag from twelve
          rows that have since been edited individually cannot be done correctly, so it is
          not offered — the per-row field is where a tag comes off a track. */}
      {pending.length > 1 && (
        <div className="queue__labelled batchtags">
          <span className="queue__label">Tags for all {pending.length}</span>
          <TagField
            tags={batchTags}
            onChange={nextTags => {
              const added = nextTags.filter(t => !batchTags.includes(t));
              setBatchTags(nextTags);
              if (added.length > 0) {
                queue.patchPendingWith(item => ({ tags: mergeTags(item.tags, added) }));
              }
            }}
            label={`Tags applied to all ${pending.length} queued tracks`}
            placeholder="lofi, latenight — press space or enter"
          />
        </div>
      )}

      <ul className="queue">
        {queue.items.map(item => {
          const locked = !isEditable(item);
          return (
            <li key={item.id} className="queue__row" data-status={item.status}>
              <CoverThumb file={item.image} onClick={() => pickCover(item.id)} disabled />
              <div className="queue__main">
                <span className="queue__name">{item.title || item.media.name}</span>
                {/* A div, not a label: a label here would also wrap each chip's remove
                    button, making a click on one ambiguous to assistive tech. The input
                    carries its own `aria-label`. */}
                <div className="queue__labelled">
                  <TagField
                    tags={item.tags}
                    onChange={tags => queue.patch(item.id, { tags })}
                    disabled={locked}
                    label="Tags for this track"
                    placeholder="lofi, latenight — press space or enter"
                  />
                </div>
                <LockedNote item={item} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  const checkStep = (
    <>
      <StepIntro title="Copyright check">
        We upload your files and listen to each one with AudD, a music-recognition service,
        to see whether it matches a released commercial recording. Covers you performed
        yourself don't match — it only recognises the exact original recording. Nothing is
        published yet.
      </StepIntro>

      <ul className="queue">
        {queue.items.map(item => (
          <li key={item.id} className="queue__row" data-status={item.status}>
            <CoverThumb file={item.image} onClick={() => pickCover(item.id)} disabled />
            <div className="queue__main">
              <span className="queue__name">{item.title || item.media.name}</span>
              <CheckStatus item={item} />
              {item.error && <span className="queue__error">{item.error}</span>}
            </div>
            <div className="queue__side">
              {isEditable(item) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(item)}
                  aria-label="Remove"
                >
                  ✕
                </Button>
              )}
            </div>
            {item.status === 'uploading' && (
              <div className="queue__bar">
                <div className="queue__barfill" style={{ width: `${item.fraction * 100}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {failed.length > 0 && !queue.running && (
        <p className="alert" role="alert">
          {plural(failed.length, 'track')} didn't upload. Fix what's flagged on{' '}
          {failed.length === 1 ? 'that row' : 'those rows'} and try again — the ones that
          already went up won't be re-uploaded.
        </p>
      )}

      {(pending.length > 0 || queue.running) && (
        <div className="filerow">
          <Button
            size="lg"
            disabled={
              pending.length === 0 ||
              missingArt > 0 ||
              missingRole > 0 ||
              oversize > 0 ||
              queue.running
            }
            busy={queue.running}
            onClick={() => {
              // Every failure is already captured per item; nothing escapes to handle here.
              queue.start().catch(() => {});
            }}
          >
            {failed.length > 0 && failed.length === pending.length
              ? 'Try again'
              : `Upload & check ${plural(pending.length, 'track')}`}
          </Button>
          {queue.running && (
            <Button variant="ghost" onClick={queue.cancelAll}>
              Cancel
            </Button>
          )}
        </div>
      )}

      {complete.check && (
        <p className="stepnote" data-tone={awaitingRights.length > 0 ? 'attention' : 'good'}>
          {awaitingRights.length > 0
            ? `${plural(awaitingRights.length, 'track')} matched a released recording. Next, tell us about your rights to ${awaitingRights.length === 1 ? 'it' : 'them'}.`
            : 'Check finished. Next, review and publish.'}
        </p>
      )}
    </>
  );

  const rightsStep = (
    <>
      <StepIntro title="About those matches">
        A match doesn't mean you've done anything wrong — you may have made the recording,
        own it, or have a licence. Tell us which, and it can publish. You can change an answer
        until you press Publish — after that it's final.
      </StepIntro>
      {/* Uncapped: the rights form is tall, and inside the list's own scroll box it was
          read through a letterbox with a second scrollbar. */}
      <ul className="queue queue--uncapped">
        {queue.items
          .filter(i => i.status === 'awaiting_rights' || i.rightsAnswer !== null)
          .map(item => (
            <li key={item.id} className="queue__row" data-status={item.status}>
              <CoverThumb file={item.image} onClick={() => pickCover(item.id)} disabled />
              <div className="queue__main">
                <span className="queue__name">{item.title || item.media.name}</span>
                {item.status === 'awaiting_rights' ? (
                  <span className="hint">Sounds like {item.matchDescription}</span>
                ) : (
                  <span className="hint">
                    Matched {item.matchDescription} ·{' '}
                    {item.rightsAnswer && item.rightsAnswer !== 'cancelled'
                      ? ANSWER_LABELS[item.rightsAnswer]
                      : 'Answered'}
                  </span>
                )}
              </div>
              {/* Editable until Publish; after that the database holds it as final. Editing
                  un-saves the answer and reopens the form filled with it. */}
              {item.status === 'ready' && item.rightsDraft && (
                <div className="queue__side">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => queue.editRights(item.id)}
                    aria-label={`Edit your answer for ${item.title || item.media.name}`}
                    title="Edit answer"
                  >
                    ✎
                  </Button>
                </div>
              )}
              {/* Deliberately NOT styled as an error: a fingerprint match is not a finding
                  of infringement. Covers never reach here at all — fingerprinting matches
                  one specific master, and a cover is a different recording. */}
              {item.status === 'awaiting_rights' && (
                <div className="queue__rights">
                  <RightsDeclarationForm
                    // Keyed so reopening a saved answer mounts a fresh form from it.
                    key={item.rightsDraft ? 'editing' : 'new'}
                    matchDescription={item.matchDescription ?? 'an existing commercial recording'}
                    submitLabel="Save answer"
                    initial={item.rightsDraft}
                    onAnswer={answer => {
                      // Backing out here takes the track out of this upload altogether —
                      // its files come down with it.
                      if (answer.acknowledgement === 'cancelled') removeItem(item);
                      else queue.answerRights(item.id, answer);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
      </ul>
    </>
  );

  const publishStep = (
    <>
      <StepIntro title="Review and publish">
        Everything is uploaded and checked. Nothing is live until you press Publish.
      </StepIntro>
      <ul className="queue">
        {reviewable.map(item => (
          <li key={item.id} className="queue__row" data-status={item.status}>
            <CoverThumb file={item.image} onClick={() => pickCover(item.id)} disabled />
            <div className="queue__main">
              <span className="queue__name">{item.title || item.media.name}</span>
              {item.description.trim() && (
                <span className="hint queue__quote">“{item.description.trim()}”</span>
              )}
              <span className="hint queue__wrap">
                You: {item.uploaderRole}
                {item.collaborators.length > 0 &&
                  ` · ${item.collaborators.map(c => `${c.name} (${c.role})`).join(', ')}`}
              </span>
              <span className="hint queue__wrap">
                {item.tags.length > 0 ? `Tags: ${item.tags.join(', ')}` : 'No tags'}
              </span>
              <CheckStatus item={item} />
              {item.error && <span className="queue__error">{item.error}</span>}
            </div>
            <div className="queue__side">
              <PreviewButton
                item={item}
                preview={preview}
                onWatch={() => setWatchingId(item.id)}
              />
              {item.status === 'done' ? (
                <span className="hint">Published</span>
              ) : item.status === 'publishing' ? (
                <span className="hint">Publishing…</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={publishing}
                  onClick={() => removeItem(item)}
                  aria-label={`Don't publish ${item.title}`}
                  title="Don't publish this one"
                >
                  ✕
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {(pending.length > 0 || awaitingRights.length > 0) && (
        <p className="alert" role="alert">
          {pending.length > 0 &&
            `${plural(pending.length, 'track')} still ${pending.length === 1 ? 'needs' : 'need'} uploading and checking. `}
          {awaitingRights.length > 0 &&
            `${plural(awaitingRights.length, 'track')} still ${awaitingRights.length === 1 ? 'needs' : 'need'} a rights answer. `}
          Only the tracks listed here will publish.
        </p>
      )}

      {ready.length > 0 && (
        <Choice
          label={
            ready.length === 1
              ? 'I grant Livil permission to stream this recording in the app'
              : `I grant Livil permission to stream these ${ready.length} recordings in the app`
          }
          hint="Required to publish. You keep your rights — this lets Livil play it to listeners."
          selected={grantedStreaming}
          onSelect={() => setGrantedStreaming(v => !v)}
          compact
          shape="checkbox"
        />
      )}

      <div className="filerow">
        <Button
          size="lg"
          disabled={ready.length === 0 || publishing || !grantedStreaming}
          busy={publishing}
          onClick={() => {
            setPublishing(true);
            queue.publishAll().finally(() => setPublishing(false));
          }}
        >
          {ready.length > 1 ? `Publish ${ready.length} tracks` : 'Publish'}
        </Button>
        {done.length > 0 && (
          <Button variant="ghost" size="sm" onClick={queue.clearFinished}>
            Clear {done.length} published
          </Button>
        )}
        {/* Changing anything after the upload means re-uploading: the details went up with
            the files, and a track's media cannot be swapped once it is stored. */}
        {held.length > 0 && !publishing && (
          <Button variant="ghost" size="sm" onClick={() => {
            queue.cancelAll();
            setStepKey('details');
          }}>
            Go back and edit
          </Button>
        )}
      </div>
      {held.length > 0 && !publishing && (
        <p className="hint">
          Going back takes the uploaded files down; they'll be uploaded and checked again
          when you continue.
        </p>
      )}
    </>
  );

  const bodies: Record<StepKey, ReactNode> = {
    files: filesStep,
    details: detailsStep,
    credits: creditsStep,
    tags: tagsStep,
    check: checkStep,
    rights: rightsStep,
    publish: publishStep,
  };

  const following = steps[stepIndex + 1];

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">Loading dock</p>
          <h1 className="display page__title">Upload</h1>
        </div>
      </header>

      {/* The meter is a sibling of the card, not a child: it is a read-out on playback, and
          the card is a form. On a wide screen it floats in the margin beside the card
          (absolute, so appearing mid-preview cannot shove the form sideways); narrower, it
          drops underneath. */}
      <div className="stage">
        {metered && (
          <LevelMeter
            tap={preview.tap}
            title={metered.title}
            quality={qualityOf(metered)}
            active={preview.playingId === metered.id}
          />
        )}

        <section className="card card--wide card--centred wizard">
          <ol className="steps" aria-label="Upload steps">
            {steps.map((key, i) => {
              const state = key === step ? 'current' : i < stepIndex ? 'past' : 'upcoming';
              return (
                <li key={key} className="steps__item">
                  <button
                    type="button"
                    className="steps__btn"
                    data-state={state}
                    data-complete={(state === 'past' && complete[key]) || undefined}
                    disabled={!reachable(key)}
                    aria-current={state === 'current' ? 'step' : undefined}
                    onClick={() => go(key)}
                  >
                    <span className="steps__num">{i + 1}</span>
                    <span className="steps__label">{STEP_LABELS[key]}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <p className="kicker steps__count">
            Step {stepIndex + 1} of {steps.length}
            {queue.items.length > 0 && ` · ${plural(queue.items.length, 'track')}`}
          </p>

          {bodies[step]}

          {step !== 'publish' && (
            <div className="wizard__nav">
              <Button variant="ghost" onClick={back} disabled={stepIndex === 0}>
                Back
              </Button>
              {following && (
                <Button variant="secondary" onClick={next} disabled={!complete[step]}>
                  Next: {STEP_LABELS[following]}
                </Button>
              )}
            </div>
          )}
          {step === 'publish' && (
            <div className="wizard__nav">
              <Button variant="ghost" onClick={back}>
                Back
              </Button>
            </div>
          )}
        </section>
      </div>

      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          const id = coverForId.current;
          // Straight into the cropper — cover art is square everywhere it renders, so an
          // uncropped image gets centre-cropped by something downstream regardless.
          if (file && id) setCropping({ id, file });
          coverForId.current = null;
          e.target.value = '';
        }}
      />

      {cropping && (
        <CoverCropper
          file={cropping.file}
          onCancel={() => setCropping(null)}
          // Offered when cropping ONE track's art while others are still editable. Pre-ticked
          // only when none of the others has art yet, so a default never overwrites anything.
          applyToAll={
            cropping.id !== 'ALL' && pending.some(i => i.id !== cropping.id)
              ? {
                  count: pending.length,
                  initiallyChecked: pending.every(i => i.id === cropping.id || !i.image),
                }
              : undefined
          }
          onDone={(cropped, toAll) => {
            if (cropping.id === 'ALL' || toAll) {
              // Overwrites art already matched from filenames or read from tags. That is
              // the point of the action — it is only reachable by explicitly asking for it.
              queue.patchPending({ image: cropped, artFromTag: false, error: null });
            } else {
              queue.patch(cropping.id, { image: cropped, artFromTag: false, error: null });
            }
            setCropping(null);
          }}
        />
      )}

      {crediting && (
        <CollaboratorPicker
          scope={
            creditingId === 'ALL'
              ? { label: `Everything in the queue that hasn't started`, trackCount: pending.length }
              : { label: crediting.title, trackCount: 1 }
          }
          existing={crediting.collaborators}
          onAdd={collaborator => {
            if (creditingId === 'ALL') {
              // Appends rather than replaces, unlike "cover art for all": art is one slot
              // and credits are a list, so overwriting would silently drop a per-row credit
              // somebody had already added. Deduped by clientId, which is derived from the
              // person and the role.
              queue.patchPendingWith(item => ({
                collaborators: mergeCredits(item.collaborators, collaborator),
              }));
            } else {
              queue.patch(creditingId!, {
                collaborators: mergeCredits(crediting.collaborators, collaborator),
              });
            }
          }}
          onClose={() => setCreditingId(null)}
        />
      )}

      {/* Outside `.stage`, and that placement is load-bearing: the stage owns the gutter
          layout for the meter beside the card, and a modal nested inside it would inherit
          that positioning for its own meter. A modal is not part of the stage anyway. */}
      {watching && (
        <VideoPreview
          file={watching.media}
          title={watching.title}
          quality={qualityOf(watching)}
          onClose={() => setWatchingId(null)}
        />
      )}
    </div>
  );
}

// ── Pieces shared between steps ────────────────────────────────────────────

function StepIntro({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="stepintro">
      <div className="rowbetween">
        <h2 className="card__title">{title}</h2>
        {action && <div className="filerow">{action}</div>}
      </div>
      <p className="hint stepintro__body">{children}</p>
    </div>
  );
}

/** What the file itself says: name, size, kind, length, and where the art came from. */
function FileLine({ item }: { item: QueueItem }) {
  return (
    <span className="hint queue__fileline">
      {item.media.name} · {formatSize(item.media.size)} · {item.mode}
      {item.duration !== null && ` · ${formatTime(item.duration)}`}
      {item.artFromTag && ' · art from file'}
    </span>
  );
}

/** Why a row in an editing step cannot be edited. */
function LockedNote({ item }: { item: QueueItem }) {
  if (isEditable(item)) return null;
  const text =
    item.status === 'done'
      ? 'Published'
      : item.status === 'publishing'
        ? 'Publishing…'
        : item.status === 'uploading' || item.status === 'checking'
          ? 'Uploading — locked while it goes up'
          : 'Uploaded — use “Go back and edit” on the Publish step to change it';
  return <span className="hint queue__locked">{text}</span>;
}

/** The copyright check's result for one row, in plain words. */
function CheckStatus({ item }: { item: QueueItem }) {
  let tone: 'good' | 'attention' | 'muted' | 'working' = 'muted';
  let text: string;

  switch (item.status) {
    case 'pending':
      text = 'Not checked yet';
      break;
    case 'failed':
      text = "Didn't upload";
      tone = 'attention';
      break;
    case 'uploading':
      text = `Uploading · ${Math.round(item.fraction * 100)}%`;
      tone = 'working';
      break;
    case 'checking':
      text = 'Checking with AudD…';
      tone = 'working';
      break;
    case 'awaiting_rights':
      text = `Possible match: ${item.matchDescription} — needs your answer`;
      tone = 'attention';
      break;
    default: {
      const scan = item.scan;
      if (item.rightsAnswer && item.rightsAnswer !== 'cancelled') {
        text = `Matched ${item.matchDescription} · ${ANSWER_LABELS[item.rightsAnswer]}`;
        tone = 'attention';
      } else if (scan?.status === 'complete' && scan.matchFound === false) {
        text = 'No copyright match found';
        tone = 'good';
      } else if (scan?.status === 'skipped') {
        // The only skip today is video, which AudD is not yet trusted to read.
        text = 'Not checked — video scanning isn’t switched on yet. It can still publish.';
      } else {
        // Fail-safe, never fail-silent: an outage must not read as a clean result.
        text = "Couldn't check right now — it can still publish.";
      }
    }
  }

  return (
    <span className="checkstatus" data-tone={tone}>
      <span className="checkstatus__dot" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Play / pause for audio, or open the video preview. */
function PreviewButton({
  item,
  preview,
  onWatch,
}: {
  item: QueueItem;
  preview: PreviewState;
  onWatch: () => void;
}) {
  const playing = preview.playingId === item.id;
  if (item.mode === 'video') {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onWatch}
        aria-label="Watch preview"
        title="Watch this file before publishing"
      >
        ▶
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => preview.toggle(item.id, item.media)}
      aria-label={playing ? 'Pause preview' : 'Play preview'}
      title={playing ? 'Pause' : 'Play to check this file'}
    >
      {playing ? '❚❚' : '▶'}
    </Button>
  );
}

/**
 * Preview scrubber. Shown only on the row currently previewing, so twelve rows do not each
 * carry a control that does nothing.
 */
function SeekBar({ item, preview }: { item: QueueItem; preview: PreviewState }) {
  if (preview.playingId !== item.id) return null;
  // Fall back to the metadata duration until the preview reports its own, so the thumb is
  // not pinned at the far left for the first moment of playback.
  const length = preview.duration || item.duration || 0;
  return (
    <div className="seek">
      <input
        type="range"
        className="seek__input"
        min={0}
        max={length}
        step={0.1}
        value={preview.position}
        aria-label="Seek preview"
        onChange={e => preview.seek(Number(e.target.value))}
      />
      <span className="hint seek__time">
        {formatTime(preview.position)} / {formatTime(length)}
      </span>
    </div>
  );
}

/**
 * The uploader's own role plus everyone else's credits. Credits sit with the track, not
 * behind a disclosure: an uncredited track is the failure this exists to prevent, and a
 * collapsed section is how it keeps happening.
 */
function CreditsEditor({
  item,
  locked,
  onUploaderRole,
  onAddCredit,
  onRemoveCredit,
}: {
  item: QueueItem;
  locked: boolean;
  onUploaderRole: (role: string) => void;
  onAddCredit: () => void;
  onRemoveCredit: (clientId: string) => void;
}) {
  // Typing rather than picking. Sticky once chosen, and true on load for a role that is
  // not in the list — otherwise re-rendering would snap a typed role back to the dropdown.
  const [ownRoleCustom, setOwnRoleCustom] = useState(false);
  const ownRoleIsCustom =
    ownRoleCustom || (item.uploaderRole !== '' && !isPresetRole(item.uploaderRole));

  return (
    <div className="credits">
      {/* The uploader's own credit, first — it is the one credit every track has. */}
      <label className="credit credit--self" data-unset={!item.uploaderRole.trim() || undefined}>
        <span className="credit__name">You</span>
        {/* Human roles only. An AI role describes what a TOOL did, and the tool gets
            credited as a collaborator in its own right — "AI vocals" is never an answer to
            what the person uploading did. */}
        {ownRoleIsCustom ? (
          <input
            className="credit__role-input"
            value={item.uploaderRole}
            disabled={locked}
            autoFocus={ownRoleCustom}
            maxLength={ROLE_MAX_LENGTH}
            placeholder="e.g. Tabla"
            aria-label="Your role on this track"
            onChange={e => onUploaderRole(e.target.value)}
          />
        ) : (
          <select
            className="credit__role-select"
            value={item.uploaderRole}
            disabled={locked}
            aria-label="Your role on this track"
            onChange={e => {
              if (e.target.value === CUSTOM_ROLE) {
                setOwnRoleCustom(true);
                // Cleared, not carried over: the preset that was showing is not a sensible
                // starting point for typing a different role, and an empty value keeps the
                // step blocked until they actually write one.
                onUploaderRole('');
                return;
              }
              onUploaderRole(e.target.value);
            }}
          >
            <option value="">what did you do?</option>
            {ROLES.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value={CUSTOM_ROLE}>Something else…</option>
          </select>
        )}
      </label>

      {item.collaborators.map(c => (
        <span key={c.clientId} className="credit" data-tone={getChipTone(c.kind)}>
          <span className="credit__name">{c.name}</span>
          <span className="credit__role">{c.role}</span>
          {!locked && (
            <button
              type="button"
              className="credit__remove"
              aria-label={`Remove ${c.name} as ${c.role}`}
              onClick={() => onRemoveCredit(c.clientId)}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!locked && (
        <button type="button" className="credit credit--add" onClick={onAddCredit}>
          {item.collaborators.length === 0 ? '＋ Add credits' : '＋'}
        </button>
      )}
    </div>
  );
}
