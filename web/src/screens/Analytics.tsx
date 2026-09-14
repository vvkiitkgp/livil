import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, type Bar } from '../components/BarChart';
import {
  fetchPlaysByDay,
  fetchPlaysByHour,
  fetchTopTracks,
  fillDays,
  localTimeZone,
  windowForDays,
  type DayPoint,
  type HourPoint,
  type TopTrack,
} from '../data/analytics';
import { formatCount } from '../format';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const;

/**
 * Analytics.
 *
 * Everything here is an aggregate. There is no view anywhere that says who listened, because
 * a play is not a public act the way a like or a comment is — and building that view would
 * convert a bug we just closed into a feature.
 */
export function Analytics() {
  const [days, setDays] = useState<number>(30);
  const [excludeSelf, setExcludeSelf] = useState(false);
  const [byDay, setByDay] = useState<DayPoint[] | null>(null);
  const [byHour, setByHour] = useState<HourPoint[] | null>(null);
  const [top, setTop] = useState<TopTrack[] | null>(null);

  const window = useMemo(() => windowForDays(days), [days]);

  useEffect(() => {
    let cancelled = false;
    const args = { window, excludeSelf };
    setByDay(null);
    setByHour(null);
    setTop(null);

    Promise.all([fetchPlaysByDay(args), fetchPlaysByHour(args), fetchTopTracks(args)])
      .then(([d, h, t]) => {
        if (cancelled) return;
        setByDay(d);
        setByHour(h);
        setTop(t);
      })
      .catch(() => {
        if (cancelled) return;
        setByDay([]);
        setByHour([]);
        setTop([]);
      });

    return () => {
      cancelled = true;
    };
  }, [window, excludeSelf]);

  const filled = byDay ? fillDays(byDay, window) : null;
  const totalPlays = byDay?.reduce((s, d) => s + d.plays, 0) ?? null;
  // Daily uniques do NOT sum to a window-unique — the same person listening on two days is
  // two rows. Presented as a peak-day figure rather than a total, because a summed "unique
  // listeners" would be a number that is simply wrong.
  const peakListeners = byDay?.reduce((m, d) => Math.max(m, d.listeners), 0) ?? null;
  const bestDay = byDay?.reduce<DayPoint | null>(
    (best, d) => (best === null || d.plays > best.plays ? d : best),
    null,
  );

  const dayBars: Bar[] =
    filled?.map(d => ({
      label: d.day.slice(5),
      value: d.plays,
      hint: `${d.day}: ${d.plays} plays, ${d.listeners} listeners`,
    })) ?? [];

  const hourBars: Bar[] = Array.from({ length: 24 }, (_, h) => {
    const found = byHour?.find(p => p.hour === h);
    return {
      label: `${h}`,
      value: found?.plays ?? 0,
      hint: `${String(h).padStart(2, '0')}:00 — ${found?.plays ?? 0} plays`,
    };
  });

  return (
    <div className="page fade-up">
      <header className="page__head">
        <div>
          <p className="kicker">Front of house</p>
          <h1 className="display page__title">Analytics</h1>
        </div>
        <div className="filters">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              className="chip"
              data-active={days === r.days || undefined}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div className="filerow analytics__toggle">
        <button
          type="button"
          className="chip"
          data-active={excludeSelf || undefined}
          onClick={() => setExcludeSelf(v => !v)}
        >
          {excludeSelf ? 'Excluding your own plays' : 'Including your own plays'}
        </button>
        <span className="hint">
          {excludeSelf
            ? 'Only other people’s listens. Lower than the count shown in the app.'
            : 'Matches the play count shown in the app, including your own listens.'}
        </span>
      </div>

      <div className="metrics">
        <Metric label="Plays" value={totalPlays} strong />
        <Metric label="Best day" value={bestDay?.plays ?? null} sub={bestDay?.day.slice(5)} />
        <Metric label="Peak listeners / day" value={peakListeners} />
        <Metric label="Tracks charting" value={top?.length ?? null} />
      </div>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Plays per day</h2>
          <span className="hint">{localTimeZone()}</span>
        </div>
        {filled === null ? (
          <div className="skeleton skeleton--rows" />
        ) : (
          <BarChart bars={dayBars} height={180} />
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">When people listen</h2>
          <span className="hint">hour of day · your local time</span>
        </div>
        {byHour === null ? (
          <div className="skeleton skeleton--rows" />
        ) : (
          <>
            <BarChart bars={hourBars} height={140} emptyLabel="No plays yet" />
            <p className="hint">
              Binned in your timezone, not each listener&apos;s — Livil doesn&apos;t record
              where people listen from. Useful while your audience is mostly one region.
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Top tracks</h2>
        </div>
        {top === null && <div className="skeleton skeleton--rows" />}
        {top !== null && top.length === 0 && (
          <div className="empty">
            <p className="empty__title">Nothing charted yet</p>
            <p className="hint">Plays in this window will rank here.</p>
          </div>
        )}
        {top !== null && top.length > 0 && (
          <ul className="releases">
            {top.map(t => (
              <li key={t.postId}>
                <Link className="release" to={`/tracks/${t.postId}`}>
                  <span className="release__art">
                    {t.coverUrl ? (
                      <img src={t.coverUrl} alt="" />
                    ) : (
                      <span className="stripes release__art-empty" />
                    )}
                  </span>
                  <span className="release__main">
                    <span className="release__title">{t.title}</span>
                    <span className="hint">{formatCount(t.listeners)} listeners</span>
                  </span>
                  <span className="release__plays">
                    <span className="release__plays-n">{formatCount(t.plays)}</span>
                    <span className="hint">plays</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="hint analytics__note">
        Follower growth isn&apos;t here yet: unfollows delete the record, so history has to be
        snapshotted daily and that hasn&apos;t started. Location isn&apos;t here because
        Livil doesn&apos;t collect it.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: number | null;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className="metric">
      <span className="metric__value" data-strong={strong || undefined}>
        {value === null ? '—' : formatCount(value)}
      </span>
      <span className="metric__label">
        {label}
        {sub ? ` · ${sub}` : ''}
      </span>
    </div>
  );
}
