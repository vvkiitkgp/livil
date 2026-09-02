import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { EarlyAccessCard } from '../components/EarlyAccessCard';
import {
  fetchCreatorPosts,
  fetchCreatorTotals,
  type CreatorPost,
  type CreatorProfile,
  type CreatorTotals,
} from '../data/creator';
import { formatCount, formatDate, formatDuration } from '../format';

type Ctx = { session: Session; profile: CreatorProfile | null };

/**
 * How many tracks the upload screen published on its way here, if it sent us. Route state
 * rather than a query string: it is a one-shot announcement, not part of the address.
 */
function publishedCount(state: unknown): number {
  const n = (state as { published?: unknown } | null)?.published;
  return typeof n === 'number' && n > 0 ? Math.round(n) : 0;
}

/**
 * The landing screen.
 *
 * Four true numbers and the recent work, no charts. With a young catalogue a time series is
 * a flat line near zero, and an empty chart says less than a number that is simply correct.
 * Charts arrive when there is something to plot.
 *
 * The identity block is a laminate pass — the same object the onboarding hands you. It is the
 * one place the pass metaphor earns its keep in an ops tool: this is literally the artist's
 * credential.
 */
export function Overview() {
  const { session, profile } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const [totals, setTotals] = useState<CreatorTotals | null>(null);
  const [recent, setRecent] = useState<CreatorPost[] | null>(null);

  // Read once into state, then wiped off the history entry: the banner has to outlive the
  // wipe, and a refresh an hour later must not re-announce an upload that is long done.
  // Replacing with the same path keeps this component mounted, so the captured count holds.
  const location = useLocation();
  const [published] = useState(() => publishedCount(location.state));
  useEffect(() => {
    if (published > 0) navigate('.', { replace: true, state: null });
  }, [published, navigate]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCreatorTotals(session.user.id),
      fetchCreatorPosts(session.user.id, 5),
    ])
      .then(([t, r]) => {
        if (cancelled) return;
        setTotals(t);
        setRecent(r);
      })
      .catch(() => {
        if (!cancelled) {
          setTotals({ plays: 0, tracks: 0, likes: 0, reposts: 0 });
          setRecent([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  const name = profile?.displayName || profile?.username || 'Artist';
  const loading = totals === null || recent === null;

  return (
    <div className="page fade-up">
      {published > 0 && (
        <div className="done" role="status">
          <p className="done__title">
            {published === 1 ? 'Track published' : `${published} tracks published`}
          </p>
          <p className="hint">
            {published === 1 ? "It's" : "They're"} live in the Livil app now — on your
            profile and in your followers&apos; feeds. There&apos;s no player here yet, so
            open the app to hear {published === 1 ? 'it' : 'them'} in place.
          </p>
        </div>
      )}

      {/* Above the fold on purpose. A creator who signs up on the web can publish but has
          no way into the app, and nothing else in the studio says a path exists. */}
      <EarlyAccessCard email={session.user.email} />

      <section className="overview">
        {/* ── The pass ───────────────────────────────────────────────── */}
        <aside className="pass overview__pass">
          <div className="holo holo-strip" />
          <div className="pass__punch" />
          <div className="holo pass__sticker">
            100%
            <br />
            REAL
          </div>

          <div className="pass__body">
            <Logo size={104} />
            <span className="pass__tagline">artist &amp; fan network</span>

            <div className="pass__photo">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" />
              ) : (
                <div className="pass__photo-empty stripes">[ your face here ]</div>
              )}
            </div>

            <div className="pass__specs">
              <div className="spec">
                <span className="spec__label">Name</span>
                <span className="spec__leader" />
                <span className="spec__value">{name}</span>
              </div>
              <div className="spec">
                <span className="spec__label">Handle</span>
                <span className="spec__leader" />
                <span className="spec__value spec__value--accent">
                  @{profile?.username ?? '—'}
                </span>
              </div>
              <div className="spec">
                <span className="spec__label">Fans</span>
                <span className="spec__leader" />
                <span className="spec__value spec__value--info">
                  {formatCount(profile?.followers ?? 0)}
                </span>
              </div>
              <div className="spec">
                <span className="spec__label">Access</span>
                <span className="spec__leader" />
                <span className="spec__value">All areas</span>
              </div>
            </div>

            <div className="barcode" />
          </div>
        </aside>

        {/* ── Numbers + recent ───────────────────────────────────────── */}
        <div className="overview__main">
          <header className="overview__head">
            <p className="kicker">Tonight&apos;s numbers</p>
            <h1 className="display overview__title">
              {loading ? 'Counting…' : greetingFor(totals!)}
            </h1>
          </header>

          <div className="metrics">
            <Metric label="Plays" value={totals?.plays} />
            <Metric label="Tracks" value={totals?.tracks} />
            <Metric label="Likes" value={totals?.likes} />
            <Metric label="Reposts" value={totals?.reposts} />
          </div>

          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Recent releases</h2>
              {recent && recent.length > 0 && (
                <Link className="linkish" to="/tracks">
                  See all
                </Link>
              )}
            </div>

            {loading && <div className="skeleton skeleton--rows" />}

            {!loading && recent!.length === 0 && (
              <div className="empty">
                <p className="empty__title">Nothing published yet</p>
                <p className="hint">
                  Drop a folder of tracks in and they&apos;ll appear here with their play
                  counts.
                </p>
                {/* Router navigation, not `window.location`: the app is served under the
                    `/studio` basename, so a raw href lands on the marketing apex instead. */}
                <Button onClick={() => navigate('/upload')}>Upload your first track</Button>
              </div>
            )}

            {!loading && recent!.length > 0 && (
              <ul className="releases">
                {recent!.map(post => (
                  <li key={post.postId}>
                    <Link className="release" to={`/tracks/${post.postId}`}>
                      <span className="release__art">
                        {post.coverUrl ? (
                          <img src={post.coverUrl} alt="" />
                        ) : (
                          <span className="stripes release__art-empty" />
                        )}
                      </span>
                      <span className="release__main">
                        <span className="release__title">{post.title}</span>
                        <span className="hint">
                          {post.mediaKind} · {formatDuration(post.durationSeconds)} ·{' '}
                          {formatDate(post.publishedAt)}
                        </span>
                      </span>
                      <span className="release__plays">
                        <span className="release__plays-n">{formatCount(post.plays)}</span>
                        <span className="hint">plays</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="metric">
      <span className="metric__value">{value === undefined ? '—' : formatCount(value)}</span>
      <span className="metric__label">{label}</span>
    </div>
  );
}

/** A line that reflects the actual state rather than greeting everyone identically. */
function greetingFor(t: CreatorTotals): string {
  if (t.tracks === 0) return 'Your stage is empty';
  if (t.plays === 0) return 'Published. Now the waiting';
  return `${formatCount(t.plays)} plays and counting`;
}
