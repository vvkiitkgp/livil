import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Button } from '../components/Button';
import { fetchCreatorPosts, type CreatorPost } from '../data/creator';
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
  const [posts, setPosts] = useState<CreatorPost[] | null>(null);
  const [sort, setSort] = useState<SortKey>('publishedAt');
  const [asc, setAsc] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    fetchCreatorPosts(session.user.id, 200)
      .then(p => {
        if (!cancelled) setPosts(p);
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

      {posts === null && <div className="skeleton skeleton--rows" />}

      {posts !== null && rows.length === 0 && (
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
            <Button onClick={() => (window.location.href = '/upload')}>Upload music</Button>
          )}
        </div>
      )}

      {posts !== null && rows.length > 0 && (
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
                {header('likes', 'Likes', true)}
                {header('comments', 'Comments', true)}
                {header('reposts', 'Reposts', true)}
              </tr>
            </thead>
            <tbody>
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
                  <td className="num">{formatCount(p.likes)}</td>
                  <td className="num">{formatCount(p.comments)}</td>
                  <td className="num">{formatCount(p.reposts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
