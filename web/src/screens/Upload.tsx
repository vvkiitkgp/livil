import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../components/Button';
import { CoverCropper } from '../components/CoverCropper';
import { VideoPreview } from '../components/VideoPreview';
import { CoverThumb } from '../components/CoverThumb';
import { CollaboratorPicker } from '../components/CollaboratorPicker';
import { TagField } from '../components/TagField';
import { LevelMeter } from '../components/LevelMeter';
import { usePreviewPlayer } from '../upload/preview';
import { MAX_WEB_UPLOAD_BYTES } from '@shared/services/media';
import { filesFromDataTransfer, pairAssets } from '../upload/files';
import { mergeCredits } from '../upload/credits';
import { describeQuality } from '../upload/quality';
import { itemsFromPaired, useUploadQueue, type QueueItem } from '../upload/queue';
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

/**
 * Batch upload. A single track is just a queue of one, so there is no separate code path
 * for it — the case that used to be "the" upload screen is now the degenerate case.
 */
export function Upload() {
  const queue = useUploadQueue();
  const preview = usePreviewPlayer();
  const [dragging, setDragging] = useState(false);
  const [busyReadingDrop, setBusyReadingDrop] = useState(false);

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
  // control above it, and for the same reason: an album is the same people twelve times.
  const [creditingId, setCreditingId] = useState<string | 'ALL' | null>(null);
  // What the batch tag field is showing. Not the truth about any row — each row owns its own
  // list — just the record of what has been applied to the batch so far, so the field can
  // tell a new tag from one already sent.
  const [batchTags, setBatchTags] = useState<string[]>([]);

  function accept(files: File[]) {
    const { items } = pairAssets(files);
    if (items.length > 0) queue.add(itemsFromPaired(items));
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
  // Nothing left to do: the run is over and something actually published.
  const finished = !queue.running && done.length > 0 && pending.length === 0;
  const missingArt = pending.filter(i => !i.image).length;
  const missingRole = pending.filter(i => !i.uploaderRole.trim()).length;
  const oversize = queue.items.filter(i => i.media.size > MAX_WEB_UPLOAD_BYTES).length;

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

      <section className="card card--wide card--centred">
        <div className="rowbetween">
          <h2 className="card__title">New upload</h2>
        <div className="filerow">
          {pending.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                coverForId.current = 'ALL';
                coverInput.current?.click();
              }}
            >
              Cover art for all {pending.length}
            </Button>
          )}
          {pending.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => setCreditingId('ALL')}>
              Credits for all {pending.length}
            </Button>
          )}
          {done.length > 0 && (
            <Button variant="ghost" size="sm" onClick={queue.clearFinished}>
              Clear {done.length} published
            </Button>
          )}
        </div>
      </div>

      {/* Tags for the whole batch. A field rather than a button, unlike the two controls
          above it, because there is nothing to open — the tags ARE the input. Appends on
          every commit, like "credits for all" and for the same reason: a row may already
          carry a tag set on it individually, and replacing would throw that away.

          Removing a chip here removes it from this field only. Un-applying a tag from twelve
          rows that have since been edited individually cannot be done correctly, so it is
          not offered — the per-row field is where a tag comes off a track. */}
      {pending.length > 1 && (
        <div className="queue__labelled batchtags">
          <span className="queue__label">Tags for all {pending.length}</span>
          <TagField
            tags={batchTags}
            onChange={next => {
              const added = next.filter(t => !batchTags.includes(t));
              setBatchTags(next);
              if (added.length > 0) {
                queue.patchPendingWith(item => ({ tags: mergeTags(item.tags, added) }));
              }
            }}
            label={`Tags applied to all ${pending.length} queued tracks`}
            placeholder="lofi, latenight — press space or enter"
          />
        </div>
      )}

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
          onChange={e => accept(Array.from(e.target.files ?? []))}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          webkitdirectory=""
          hidden
          onChange={e => accept(Array.from(e.target.files ?? []))}
        />
      </div>

      {queue.items.length > 0 && (
        <ul className="queue">
          {queue.items.map(item => (
            <QueueRow
              key={item.id}
              item={item}
              onWatch={() => setWatchingId(item.id)}
              playing={preview.playingId === item.id}
              position={preview.playingId === item.id ? preview.position : 0}
              previewDuration={preview.playingId === item.id ? preview.duration : 0}
              onPreview={() => preview.toggle(item.id, item.media)}
              onSeek={preview.seek}
              onTitle={title => queue.patch(item.id, { title })}
              onDescription={description => queue.patch(item.id, { description })}
              onTags={tags => queue.patch(item.id, { tags })}
              onAddCredit={() => setCreditingId(item.id)}
              onUploaderRole={role => queue.patch(item.id, { uploaderRole: role })}
              onRemoveCredit={clientId =>
                queue.patch(item.id, {
                  collaborators: item.collaborators.filter(c => c.clientId !== clientId),
                })
              }
              onRemove={() => {
                if (preview.playingId === item.id) preview.stop();
                queue.remove(item.id);
              }}
              onPickCover={() => {
                coverForId.current = item.id;
                coverInput.current?.click();
              }}
            />
          ))}
        </ul>
      )}

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
          onDone={cropped => {
            if (cropping.id === 'ALL') {
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

      {finished && (
        <div className="done" role="status">
          <p className="done__title">
            {done.length === 1 ? 'Track published' : `${done.length} tracks published`}
          </p>
          <p className="hint">
            They're live in the Livil app now — on your profile and in your followers'
            feeds. There's no player here yet, so open the app to hear them in place.
          </p>
          <div className="filerow">
            <Button variant="secondary" size="sm" onClick={queue.clearFinished}>
              Upload more
            </Button>
          </div>
        </div>
      )}

      {failed.length > 0 && !queue.running && (
        <p className="alert" role="alert">
          {failed.length} {failed.length === 1 ? 'track' : 'tracks'} didn't publish. Fix
          what's flagged on {failed.length === 1 ? 'that row' : 'those rows'} and press
          Publish again — the ones that already succeeded won't be re-uploaded.
        </p>
      )}

      {missingRole > 0 && (
        <p className="alert" role="alert">
          {missingRole === 1 ? 'One track needs' : `${missingRole} tracks need`} your own role.
          A credit list that names everyone except the person who made the record is not a
          credit list.
        </p>
      )}

      {missingArt > 0 && (
        <p className="alert" role="alert">
          {missingArt} {missingArt === 1 ? 'track needs' : 'tracks need'} cover art before
          publishing.
        </p>
      )}
      {oversize > 0 && (
        <p className="alert" role="alert">
          {oversize} file{oversize === 1 ? ' is' : 's are'} over the{' '}
          {formatSize(MAX_WEB_UPLOAD_BYTES)} limit.
        </p>
      )}

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
          {pending.length > 1 ? `Publish ${pending.length} tracks` : 'Publish'}
        </Button>
        {queue.running && (
          <Button variant="ghost" onClick={queue.cancelAll}>
            Cancel
          </Button>
        )}
        </div>
      </section>
      </div>

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

function QueueRow({
  item,
  onWatch,
  playing,
  position,
  previewDuration,
  onPreview,
  onSeek,
  onTitle,
  onDescription,
  onTags,
  onAddCredit,
  onRemoveCredit,
  onUploaderRole,
  onRemove,
  onPickCover,
}: {
  item: QueueItem;
  onWatch: () => void;
  playing: boolean;
  position: number;
  previewDuration: number;
  onPreview: () => void;
  onSeek: (seconds: number) => void;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onTags: (tags: string[]) => void;
  onAddCredit: () => void;
  onRemoveCredit: (clientId: string) => void;
  onUploaderRole: (role: string) => void;
  onRemove: () => void;
  onPickCover: () => void;
}) {
  const locked = item.status === 'uploading' || item.status === 'done';
  // Typing rather than picking. Sticky once chosen, and true on load for a role that is
  // not in the list — otherwise re-rendering would snap a typed role back to the dropdown.
  const [ownRoleCustom, setOwnRoleCustom] = useState(false);
  const ownRoleIsCustom =
    ownRoleCustom || (item.uploaderRole !== '' && !isPresetRole(item.uploaderRole));

  return (
    <li className="queue__row" data-status={item.status}>
      <CoverThumb file={item.image} onClick={onPickCover} disabled={locked} />

      <div className="queue__main">
        {/* Captioned rather than bare: two unlabelled boxes in a row leave the artist
            guessing which is which, and the title arrives prefilled from the filename so
            nothing in the value itself says what it is. */}
        <label className="queue__labelled">
          <span className="queue__label">Title</span>
          <input
            className="queue__field queue__title"
            value={item.title}
            onChange={e => onTitle(e.target.value)}
            disabled={locked}
            placeholder="Track title"
          />
        </label>
        {/* "Description" asked for metadata and got blank fields. The caption asks the
            artist for the one thing only they can write — what the track is to them. */}
        <label className="queue__labelled">
          <span className="queue__label">How you feel about it</span>
          <input
            className="queue__field queue__desc"
            value={item.description}
            onChange={e => onDescription(e.target.value)}
            disabled={locked}
            placeholder="Optional — what this one means to you"
          />
        </label>
        {/* Credits sit with the fields, not behind a disclosure: an uncredited track is
            the failure this feature exists to prevent, and a collapsed section is how it
            keeps happening. */}
        <div className="credits">
          {/* The uploader's own credit, first — it is the one credit every track has. */}
          <label className="credit credit--self" data-unset={!item.uploaderRole.trim() || undefined}>
            <span className="credit__name">You</span>
            {/* Human roles only. An AI role describes what a TOOL did, and the tool gets
                credited as a collaborator in its own right — "AI vocals" is never an
                answer to what the person uploading did. */}
            {ownRoleIsCustom ? (
              <input
                className="credit__role-input"
                value={item.uploaderRole}
                disabled={locked}
                autoFocus
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
                    // Cleared, not carried over: the preset that was showing is not a
                    // sensible starting point for typing a different role, and an empty
                    // value keeps Publish blocked until they actually write one.
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

        {/* Below the credits, above the file line: tags are metadata the artist writes, so
            they belong with the fields rather than down with what the file itself says.
            Captioned with what they DO — "Tags" alone gets left blank, because nothing on
            screen says why anyone should bother filling it in. */}
        {/* A div, not a label: a label here would also wrap each chip's remove button,
            making a click on one ambiguous to assistive tech. The input carries its own
            `aria-label`. */}
        <div className="queue__labelled">
          <span className="queue__label">How people find it</span>
          <TagField
            tags={item.tags}
            onChange={onTags}
            disabled={locked}
            label="Tags for this track"
            placeholder="lofi, latenight — press space or enter"
          />
          {/* Asks for a removal first, because that is the state the row opens in: the
              moods are already applied. Says listeners never see them so nobody prunes for
              the wrong reason — these are read by search, not printed on the post. */}
          {!locked && (
            <span className="hint">
              Take off the moods this track isn't, and add your own. Listeners never see
              these — they feed search.
            </span>
          )}
        </div>

        <span className="hint">
          {item.media.name} · {formatSize(item.media.size)} · {item.mode}
          {item.duration !== null && ` · ${formatTime(item.duration)}`}
          {item.artFromTag && ' · art from file'}
        </span>
        {item.error && <span className="queue__error">{item.error}</span>}

        {playing && (
          <div className="seek">
            <input
              type="range"
              className="seek__input"
              min={0}
              // Fall back to the metadata duration until the preview reports its own, so
              // the thumb is not pinned at the far left for the first moment of playback.
              max={previewDuration || item.duration || 0}
              step={0.1}
              value={position}
              aria-label="Seek preview"
              onChange={e => onSeek(Number(e.target.value))}
            />
            <span className="hint seek__time">
              {formatTime(position)} / {formatTime(previewDuration || item.duration || 0)}
            </span>
          </div>
        )}
      </div>

      <div className="queue__side">
        {item.mode === 'video' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onWatch}
            aria-label="Watch preview"
            title="Watch this file before publishing"
          >
            ▶
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPreview}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            title={playing ? 'Pause' : 'Play to check this file'}
          >
            {playing ? '❚❚' : '▶'}
          </Button>
        )}

        {item.status === 'done' ? (
          <span className="hint">Published</span>
        ) : item.status === 'uploading' ? (
          <span className="hint">
            {item.stage} · {Math.round(item.fraction * 100)}%
          </span>
        ) : null}

        {!locked && (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove">
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
  );
}
