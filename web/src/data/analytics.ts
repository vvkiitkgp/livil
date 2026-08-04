/**
 * Analytics reads — RPCs only.
 *
 * `post_views` is no longer readable by any client (20260804050000), which is deliberate: a
 * creator learns how many people listened, never which people. These three functions are the
 * only door, they return aggregates, and their authorization is structural — a join on
 * `posts.author_id = auth.uid()` in the FROM clause rather than a check that could be
 * removed without breaking the query.
 */
import { supabase } from '../supabase';

export type DayPoint = { day: string; plays: number; listeners: number };
export type HourPoint = { hour: number; plays: number };
export type TopTrack = {
  postId: string;
  title: string;
  coverUrl: string | null;
  plays: number;
  listeners: number;
};

export type Window = { from: string; to: string };

/**
 * The browser's own IANA zone.
 *
 * Passed explicitly rather than letting the database bin in UTC, because an artist in IST
 * would otherwise see plays from 05:30 local attributed to the previous day. This must stay
 * consistent: re-binning later changes every number the artist has already looked at.
 */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function windowForDays(days: number): Window {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

type Args = { window: Window; excludeSelf: boolean };

export async function fetchPlaysByDay({ window, excludeSelf }: Args): Promise<DayPoint[]> {
  const { data, error } = await supabase.rpc('creator_plays_by_day', {
    p_from: window.from,
    p_to: window.to,
    p_tz: localTimeZone(),
    p_exclude_self: excludeSelf,
  });
  if (error || !data) return [];
  return (data as { day: string; plays: number; listeners: number }[]).map(r => ({
    day: r.day,
    plays: r.plays,
    listeners: r.listeners,
  }));
}

export async function fetchPlaysByHour({ window, excludeSelf }: Args): Promise<HourPoint[]> {
  const { data, error } = await supabase.rpc('creator_plays_by_hour', {
    p_from: window.from,
    p_to: window.to,
    p_tz: localTimeZone(),
    p_exclude_self: excludeSelf,
  });
  if (error || !data) return [];
  return (data as { hour: number; plays: number }[]).map(r => ({
    hour: r.hour,
    plays: r.plays,
  }));
}

export async function fetchTopTracks({ window, excludeSelf }: Args): Promise<TopTrack[]> {
  const { data, error } = await supabase.rpc('creator_top_tracks', {
    p_from: window.from,
    p_to: window.to,
    p_limit: 10,
    p_tz: localTimeZone(),
    p_exclude_self: excludeSelf,
  });
  if (error || !data) return [];
  return (
    data as {
      post_id: string;
      title: string;
      cover_art_url: string | null;
      plays: number;
      listeners: number;
    }[]
  ).map(r => ({
    postId: r.post_id,
    title: r.title,
    coverUrl: r.cover_art_url,
    plays: r.plays,
    listeners: r.listeners,
  }));
}

/**
 * Fill gaps so a chart shows days with no plays as zero rather than closing the gap.
 *
 * A line that skips empty days makes a quiet week look like a continuous one, which is the
 * single most misleading thing a sparse-data chart can do.
 */
export function fillDays(points: DayPoint[], window: Window): DayPoint[] {
  const byDay = new Map(points.map(p => [p.day, p]));
  const out: DayPoint[] = [];
  const cursor = new Date(`${window.from}T00:00:00Z`);
  const end = new Date(`${window.to}T00:00:00Z`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, plays: 0, listeners: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
