import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  fetchCreatorPosts,
  attachSearchOpens,
  deleteBlockedTrack,
  fetchMyBlockedTracks,
  type BlockedTrack,
  type CreatorPost,
} from '../data/creator';
import {
  dismissRemoval,
  fetchMyRemovals,
  removalBody,
  removalHeadline,
  type PostRemoval,
} from '@shared/services/postRemovals';
import { supabase } from '../supabase';
import {
  bitrateKbps,
  formatBitrate,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
} from '../format';

type Ctx = { session: Session };
type SortKey =
  | 'publishedAt'
  | 'title'
  | 'plays'
  | 'searchOpens'
  | 'likes'
  | 'comments'
  | 'reposts'
  | 'sizeBytes';
type Filter = 'all' | 'audio' | 'video';

/**
 * Every track the artist has uploaded, as a table.
 *
 * A table rather than the mobile app's 2-up card grid, and that is the whole point: the
 * question being asked here is "how did each one do", and comparing numbers wants columns.
 * A grid of covers on a 1440px screen shows eight thumbnails and zero data.
 */
export function Catalogue() {
  const { session } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<CreatorPost[] | null>(null);
  // Removed posts do not appear above: a takedown DELETES the post, so the catalogue —
  // which reads posts — simply stops seeing it. Without this section the track would
  // vanish with no explanation, which is the whole complaint this answers.
  const [removals, setRemovals] = useState<PostRemoval[]>([]);
  // Blocked tracks are absent from `posts` by construction — a takedown deletes the post —
  // so they are fetched separately and rendered as rows of their own. Without this the
  // owner's upload disappears from the owner's own catalogue with no explanation.
  const [blocked, setBlocked] = useState<BlockedTrack[]>([]);
  /** The blocked track the creator has asked to delete, while they confirm it. */
  const [confirmDelete, setConfirmDelete] = useState<BlockedTrack | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sort, setSort] = useState<SortKey>('publishedAt');
  const [asc, setAsc] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    // Never blocks the catalogue: `fetchMyRemovals` resolves to [] on any failure, so a
    // notice query that errors costs a notice rather than the page.
    fetchMyRemovals(supabase).then(setRemovals);
    fetchMyBlockedTracks(supabase, session.user.id).then(setBlocked);

    fetchCreatorPosts(session.user.id, 200)
      .then(p => {
        if (!cancelled) setPosts(p);
        // Second pass: the catalogue renders on the tracks, and the search column fills in a
        // moment later. Blocking the whole table on an analytics number would make the page
        // feel slower to show something nobody is waiting on.
        return attachSearchOpens(p).then(withOpens => {
          if (!cancelled) setPosts(withOpens);
        });
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  const rows = useMemo(() => {
    if (!posts) return [];
    const filtered = filter === 'all' ? posts : posts.filter(p => p.mediaKind === filter);
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title) * dir;
      if (sort === 'publishedAt') {
        return (Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) * dir;
      }
      if (sort === 'sizeBytes') {
        // Unknown sizes sort last in either direction rather than pretending to be 0 —
        // an old track without a size is not the smallest track.
        const av = a.sizeBytes ?? -1;
        const bv = b.sizeBytes ?? -1;
        if (av < 0 && bv < 0) return 0;
        if (av < 0) return 1;
        if (bv < 0) return -1;
        return (av - bv) * dir;
      }
      return (a[sort] - b[sort]) * dir;
    });
  }, [posts, sort, asc, filter]);

  function toggleSort(key: SortKey) {
    if (key === sort) {
      setAsc(a => !a);
    } else {
      setSort(key);
      // Numbers and dates are most useful largest-first; titles alphabetical.
      setAsc(key === 'title');
    }
  }

  const header = (key: SortKey, label: string, numeric = false) => (
    <th className={numeric ? 'num' : undefined} aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th" onClick={() => toggleSort(key)}>
        {label}
        <span className="th__caret" aria-hidden="true">
          {sort === key ? (asc ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">The set list</p>
          <h1 className="display page__title">Catalogue</h1>
        </div>
        <div className="filters">
          {(['all', 'audio', 'video'] as const).map(f => (
            <button
              key={f}
              type="button"
              className="chip"
              data-active={filter === f || undefined}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {/* REPOSTS ONLY. A removed repost has no track of yours to list, so it needs a
          notice of its own. A removed UPLOAD does have one — it appears as a blocked row
          in the table below, which is where its owner will look for it. */}
      {removals.filter(r => r.kind === 'repost').length > 0 && (
        <div className="removals">
          {removals.filter(r => r.kind === 'repost').map(r => (
            <div className="removal panel" key={r.id}>
              <p className="removal__title">
                {removalHeadline(r)}
                {r.trackTitle ? ` — “${r.trackTitle}”` : ''}
              </p>
              {r.reason && <p className="removal__reason">{r.reason}</p>}
              <p className="removal__note">{removalBody(r)}</p>
              {r.caption && <p className="removal__note">Your caption: “{r.caption}”</p>}
              <div className="removal__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Dismisses the NOTICE. The post is already gone and the moderation
                    // ledger is untouched — nobody clears a strike by tidying up here.
                    void dismissRemoval(supabase, r.id).then(ok => {
                      if (ok) setRemovals(list => list.filter(x => x.id !== r.id));
                    });
                  }}
                >
                  Delete this notice
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {posts === null && <div className="skeleton skeleton--rows" />}

      {/* `blocked.length` is part of this condition, and leaving it out was a real bug:
          a creator whose ONLY upload had been taken down was told "Nothing published yet"
          while their blocked row sat in a table that never rendered — the exact silent
          disappearance the blocked card exists to prevent. The mobile profile guarded
          this; the web catalogue did not. */}
      {posts !== null && rows.length === 0 && blocked.length === 0 && (
        <div className="empty panel">
          <p className="empty__title">
            {filter === 'all' ? 'Nothing published yet' : `No ${filter} tracks`}
          </p>
          <p className="hint">
            {filter === 'all'
              ? 'Your catalogue will fill in here as you publish.'
              : 'Try a different filter.'}
          </p>
          {filter === 'all' && (
            /* Router navigation, not `window.location`: the app is served under the
               `/studio` basename, so a raw href lands on the marketing apex instead. */
            <Button onClick={() => navigate('/upload')}>Upload music</Button>
          )}
        </div>
      )}

      {posts !== null && (rows.length > 0 || blocked.length > 0) && (
        <div className="tablewrap panel">
          <table className="table">
            <thead>
              <tr>
                <th className="table__art" />
                {header('title', 'Title')}
                <th>Kind</th>
                <th className="num">Length</th>
                {header('sizeBytes', 'Size', true)}
                <th className="num">Bitrate</th>
                {header('publishedAt', 'Published')}
                {header('plays', 'Plays', true)}
                {/* Distinct PEOPLE who found this through search — not opens. One listener
                    finding the same song five times is one person who wanted it. */}
                {header('searchOpens', 'Searches', true)}
                {header('likes', 'Likes', true)}
                {header('comments', 'Comments', true)}
                {header('reposts', 'Reposts', true)}
              </tr>
            </thead>
            <tbody>
              {/* Blocked first: somebody whose upload was removed is looking for it, and
                  burying it under everything still live is the wrong way round. */}
              {blocked.map(b => (
                <tr key={b.trackId} data-blocked="true">
                  <td className="table__art">
                    {b.coverUrl ? (
                      <img src={b.coverUrl} alt="" />
                    ) : (
                      <span className="stripes table__art-empty" />
                    )}
                  </td>
                  <td>
                    {/* Not a link. There is no post to open, and a dead link would be a
                        second small mystery on top of the first. */}
                    <span className="table__title">{b.title}</span>
                    <div className="removal__reason">{b.reason ?? 'No reason was recorded.'}</div>
                    <div className="hint">
                      Hidden from your followers and from everyone else — only you can see
                      this. It cannot be played.
                    </div>
                    <div className="removal__actions">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmDelete(b)}
                      >
                        Delete permanently
                      </Button>
                    </div>
                  </td>
                  <td>
                    <span className="badge" data-kind="blocked">Blocked</span>
                  </td>
                  <td className="num">{formatDuration(b.durationSeconds)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td>{formatDate(b.takenDownAt)}</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                </tr>
              ))}

              {rows.map(p => (
                <tr key={p.postId}>
                  <td className="table__art">
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt="" />
                    ) : (
                      <span className="stripes table__art-empty" />
                    )}
                  </td>
                  <td>
                    <Link className="table__title" to={`/tracks/${p.postId}`}>
                      {p.title}
                    </Link>
                  </td>
                  <td>
                    <span className="badge" data-kind={p.mediaKind}>
                      {p.mediaKind}
                    </span>
                  </td>
                  <td className="num">{formatDuration(p.durationSeconds)}</td>
                  <td className="num">{formatBytes(p.sizeBytes)}</td>
                  <td className="num muted">
                    {formatBitrate(bitrateKbps(p.sizeBytes, p.durationSeconds))}
                  </td>
                  <td>{formatDate(p.publishedAt)}</td>
                  <td className="num num--strong">{formatCount(p.plays)}</td>
                  <td className="num">{formatCount(p.searchOpens)}</td>
                  <td className="num">{formatCount(p.likes)}</td>
                  <td className="num">{formatCount(p.comments)}</td>
                  <td className="num">{formatCount(p.reposts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* `window.confirm` is banned here for the same reason `Alert.alert` is banned in
          the app — see ConfirmDialog's header. This one is destructive and irreversible,
          so it says what survives as well as what goes. */}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${confirmDelete.title}” permanently?`}
          body={
            'This removes the track for good and cannot be undone. It does not lift the '
            + 'block, and it does not remove the record of why the track was taken down — '
            + 'that is kept separately.'
          }
          confirmLabel="Delete permanently"
          destructive
          busy={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setDeleting(true);
            // Permitted since the strike moved to the moderation ledger: deleting the
            // track can no longer erase the record of why it went.
            void deleteBlockedTrack(supabase, target.trackId)
              .then(() => setBlocked(list => list.filter(x => x.trackId !== target.trackId)))
              .catch(() => {/* row stays on screen; nothing was deleted */})
              .finally(() => {
                setDeleting(false);
                setConfirmDelete(null);
              });
          }}
        />
      )}
    </div>
  );
}
