import { useCallback, useState } from 'react';
import { createRepost, createSpotifyRepost, isPlayableInLivil, type FeedPost } from '../../services/posts';
import { artistLine, type SpotifyTrack } from '../../services/spotify';
import { getWaveformPeaks } from '../../services/tracks';

/**
 * The guide's "Your 3 favourites" step: the new user picks three songs and they are
 * reposted for them — no caption, no clip editing (the owner's spec, 2026-10-18). It is
 * the one step of the first run that cannot be skipped: an empty profile and an empty
 * notifications tab are what make a new account feel dead.
 */

export const PICK_COUNT = 3;

export type GuidePick =
  | {
      kind: 'livil';
      /** One pick per song, however many reposts of it the search returned. */
      key: string;
      /** The UPLOAD being reposted — `createRepost` refuses a repost of a repost. */
      uploadPostId: string;
      trackId: string;
      /** Whole seconds, when known — the repost's window is the whole song. */
      durationSec: number | null;
      title: string;
      artist: string;
      art: string | null;
    }
  | {
      kind: 'spotify';
      key: string;
      trackId: string;
      title: string;
      artist: string;
      art: string | null;
    };

/** A Livil search/suggestion row as a pick, or null when there is no upload left to repost. */
export function pickFromPost(post: FeedPost): GuidePick | null {
  if (!isPlayableInLivil(post)) {return null;}
  const uploadPostId = post.kind === 'upload' ? post.id : post.originalPostId;
  if (!uploadPostId) {return null;}
  const who = post.kind === 'upload' ? post.author : post.originalAuthor;
  return {
    kind: 'livil',
    key: `livil:${uploadPostId}`,
    uploadPostId,
    trackId: post.track.id,
    durationSec: post.track.durationSeconds,
    title: post.track.title,
    artist: who ? (who.displayName?.trim() || `@${who.username}`) : '',
    art: post.track.coverArtUrl ?? post.track.thumbnailUrl ?? null,
  };
}

export function pickFromSpotify(track: SpotifyTrack): GuidePick {
  return {
    kind: 'spotify',
    key: `spotify:${track.id}`,
    trackId: track.id,
    title: track.title,
    artist: artistLine(track),
    art: track.imageUrl,
  };
}

/** Rows as picks, one per song, in the order they came. */
export function uniquePicks(picks: (GuidePick | null)[]): GuidePick[] {
  const seen = new Set<string>();
  return picks.filter((p): p is GuidePick => {
    if (!p || seen.has(p.key)) {return false;}
    seen.add(p.key);
    return true;
  });
}

/**
 * A tap on a row: picked → unpicked, unpicked → picked while there is room. A song that
 * is already reposted stays — un-picking it would not un-post it.
 */
export function togglePick(
  picks: GuidePick[],
  pick: GuidePick,
  posted: ReadonlySet<string>,
): { picks: GuidePick[]; result: 'added' | 'removed' | 'full' | 'locked' } {
  if (picks.some(p => p.key === pick.key)) {
    if (posted.has(pick.key)) {return { picks, result: 'locked' };}
    return { picks: picks.filter(p => p.key !== pick.key), result: 'removed' };
  }
  if (picks.length >= PICK_COUNT) {return { picks, result: 'full' };}
  return { picks: [...picks, pick], result: 'added' };
}

/**
 * A guide repost's window: the whole song (the owner's call, 2026-10-18 — no clip
 * editing in the guide). Saved as an explicit 0 → length window rather than none, because
 * the feed draws the purple highlight only around a repost that carries one; without it
 * the song shows unmarked. The length comes from the track, else from its stored
 * loudness map; null when neither knows it, which leaves the repost unmarked.
 */
export function fullSongClip(
  durationSec: number,
  loudness: { hz: number; peaks: number[] } | null,
): { start: number; end: number } | null {
  const mapped = loudness && loudness.hz > 0 ? loudness.peaks.length / loudness.hz : 0;
  const duration = durationSec > 0 ? durationSec : mapped;
  return duration > 0 ? { start: 0, end: Math.round(duration * 10) / 10 } : null;
}

async function repost(pick: GuidePick): Promise<void> {
  if (pick.kind === 'spotify') {
    await createSpotifyRepost(pick.trackId, '');
    return;
  }
  const clip = fullSongClip(
    pick.durationSec ?? 0,
    // getWaveformPeaks never throws; only asked when the track's length is missing.
    pick.durationSec ? null : await getWaveformPeaks(pick.trackId),
  );
  await createRepost(pick.uploadPostId, '', clip?.start, clip?.end);
}

export type PickStatus = 'picking' | 'posting' | 'done';

/**
 * The step's state, held by the guide screen rather than the step itself so Back and
 * Next do not lose it — and so a finished step stays finished.
 *
 * Reposts go one at a time and each success is remembered: when the second of three
 * fails, a retry posts only the second and third, never the first twice.
 */
export function usePickThree() {
  const [picks, setPicks] = useState<GuidePick[]>([]);
  const [posted, setPosted] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<PickStatus>('picking');

  const toggle = useCallback((pick: GuidePick) => {
    // The picks are frozen while they are being sent: `submit` is walking this list.
    if (status === 'posting') {return 'locked' as const;}
    const next = togglePick(picks, pick, posted);
    if (next.picks !== picks) {setPicks(next.picks);}
    return next.result;
  }, [picks, posted, status]);

  /** Resolves to the pick that failed, or null when all of them are reposted. */
  const submit = useCallback(async (): Promise<GuidePick | null> => {
    setStatus('posting');
    const done = new Set(posted);
    for (const pick of picks) {
      if (done.has(pick.key)) {continue;}
      try {
        await repost(pick);
      } catch {
        setPosted(new Set(done));
        setStatus('picking');
        return pick;
      }
      done.add(pick.key);
    }
    setPosted(done);
    setStatus('done');
    return null;
  }, [picks, posted]);

  return { picks, posted, status, toggle, submit };
}
