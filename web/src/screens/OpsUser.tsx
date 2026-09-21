import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { formatDate, formatDuration } from '../format';
import {
  fetchArtistForOps,
  fetchTracksForUser,
  type OpsArtist,
  type OpsTrack,
} from '../data/opsTracks';
import {
  OPS_BADGES,
  fetchAllBadgeHolders,
  fetchBadgeStatus,
  grantBadge,
  revokeBadge,
  type BadgeStatus,
} from '../data/profileBadges';

/**
 * One artist's uploads, so an operator can listen before granting the First 100 badge.
 *
 * WHY THIS PAGE EXISTS: the roster's track count is a number, and a number cannot answer
 * the only question that matters at grant time — is the work real. Granting from the
 * roster alone means granting on a count, which is what a bot farm looks like too.
 *
 * SECURITY: no route guard, same as /studio/ops — but NOT for the reason this comment
 * used to give. It claimed `tracks_select_authenticated` is `using (true)` and that nothing
 * here is privileged. Both were false: that policy has been block-aware since
 * 20260809000000, and this page now reads through `ops_tracks_for_user`, which is SECURITY
 * DEFINER. That stale sentence is what shipped the "No uploads" bug.
 *
 * The real reason the guard is unnecessary: every read on this page goes through an
 * is_ops()-gated function that returns EMPTY for anyone else, and grant/revoke RAISE. A
 * non-ops visitor who finds this URL sees an empty page and cannot grant.
 *
 * Do not add a query here that reads under the caller's own session. This file made that
 * mistake TWICE: first the track list, then — after that was fixed — the artist's own name,
 * which `fetchCreatorProfile` read straight from `profiles`. Both tables carry the same
 * block clause, so with a block and no shared conversation the page rendered "This artist"
 * with no handle and no error at all. Everything here now goes through an ops RPC.
 */
export function OpsUser() {
  const { userId = '' } = useParams<{ userId: string }>();

  const [profile, setProfile] = useState<OpsArtist | null>(null);
  const [tracks, setTracks] = useState<OpsTrack[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** badge -> does this artist hold it. Null until loaded. */
  const [held, setHeld] = useState<Record<string, boolean> | null>(null);
  const [statuses, setStatuses] = useState<Record<string, BadgeStatus | null>>({});
  const [badgeBusy, setBadgeBusy] = useState<string | null>(null);
  const [badgeError, setBadgeError] = useState<string | null>(null);
  const [badgeNote, setBadgeNote] = useState<string | null>(null);

  /** Which track's player is open. One at a time — fifty <audio> elements is not a page. */
  const [openTrackId, setOpenTrackId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoadError(null);
    Promise.all([fetchArtistForOps(userId), fetchTracksForUser(userId)])
      .then(([p, t]) => {
        setProfile(p);
        setTracks(t);
      })
      .catch(e => {
        setTracks([]);
        setLoadError(e?.message ?? 'Could not load this artist.');
      });
  }, [userId]);

  const loadBadge = useCallback(() => {
    if (!userId) return;
    setBadgeError(null);
    Promise.all([
      fetchAllBadgeHolders([userId]),
      Promise.all(OPS_BADGES.map(b => fetchBadgeStatus(b.badge).then(st => [b.badge, st] as const))),
    ])
      .then(([byBadge, statusPairs]) => {
        setHeld(Object.fromEntries(
          OPS_BADGES.map(b => [b.badge, byBadge[b.badge]?.has(userId) ?? false]),
        ));
        setStatuses(Object.fromEntries(statusPairs));
      })
      .catch(e => {
        setHeld(null);
        setBadgeError(e?.message ?? 'Could not load badge state.');
      });
  }, [userId]);

  useEffect(loadBadge, [loadBadge]);

  // Never optimistic: the cap lives in the database, so the only honest answer to "did that
  // work" is the one the grant returns. A button that flips to Revoke and then silently
  // hasn't granted is worse than one that takes a moment.
  const toggleBadge = useCallback(async (badge: string, label: string) => {
    if (held === null) return;
    setBadgeBusy(badge);
    setBadgeError(null);
    setBadgeNote(null);
    try {
      const isHeld = held[badge] ?? false;
      const result = isHeld ? await revokeBadge(userId, badge) : await grantBadge(userId, badge);
      // Named in every message: with two badges, "Granted." leaves you guessing which.
      if (result === 'full') {
        setBadgeError(
          `Every ${label} slot is held. Revoke one to free it — slots left by deleted accounts cannot be recovered.`,
        );
      } else if (result === 'already') {
        setBadgeNote(`They already held ${label}.`);
      } else if (result === 'not_held') {
        setBadgeNote(`They did not hold ${label}.`);
      } else if (result === 'granted') {
        // NOT "they have been notified" — that reads as a phone buzz. The grant writes an
        // activity row; push is fired client-side elsewhere and the dashboard fires none.
        setBadgeNote(`${label} granted — it will show in their activity feed.`);
      } else if (result === 'revoked') {
        setBadgeNote(`${label} revoked. Any slot it held is back in the pool.`);
      }
      loadBadge();
    } catch (e) {
      setBadgeError(e instanceof Error ? e.message : 'Could not change that badge.');
    } finally {
      setBadgeBusy(null);
    }
  }, [held, userId, loadBadge]);

  const name = profile?.displayName ?? profile?.username ?? 'This artist';

  return (
    <div className="page">
      <p className="kicker">
        <Link className="linkish" to="/ops">← Back to ops</Link>
      </p>

      <header className="page__head">
        <div>
          <p className="kicker">Reviewing for badges</p>
          <h1 className="display page__title">{name}</h1>
          {profile?.username && <p className="hint">@{profile.username}</p>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          {held === null ? (
            <Button variant="ghost" disabled>Badges unavailable</Button>
          ) : (
            OPS_BADGES.map(({ badge, label }) => {
              const isHeld = held[badge] ?? false;
              const st = statuses[badge];
              // Out of slots blocks a new grant but must never block a revoke, or a
              // mistaken grant made at the cap could never be undone. `remaining` is null
              // for an uncapped badge, which is not the same as none left.
              const outOfSlots = !isHeld && st?.remaining != null && st.remaining <= 0;
              return (
                <div
                  key={badge}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}
                >
                  <Button
                    variant={isHeld ? 'secondary' : 'primary'}
                    busy={badgeBusy === badge}
                    disabled={outOfSlots}
                    onClick={() => toggleBadge(badge, label)}
                  >
                    {isHeld ? `Revoke ${label}` : `Grant ${label}`}
                  </Button>
                  {st && (
                    <span className="hint">
                      {st.live} live
                      {st.remaining != null
                        && ` · ${st.remaining} slot${st.remaining === 1 ? '' : 's'} left`}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </header>

      {badgeError && (
        <div className="empty panel">
          <p className="empty__title">First 100</p>
          <p className="hint">{badgeError}</p>
        </div>
      )}
      {badgeNote && !badgeError && <p className="hint">{badgeNote}</p>}

      {loadError && (
        <div className="empty panel">
          <p className="empty__title">Could not load this artist</p>
          <p className="hint">{loadError}</p>
        </div>
      )}

      {tracks === null && !loadError && <div className="skeleton skeleton--rows" />}

      {tracks !== null && tracks.length === 0 && !loadError && (
        <div className="empty panel">
          <p className="empty__title">No uploads</p>
          <p className="hint">
            {name} has not uploaded any tracks. A repost makes a post but no track, so a
            busy profile can still land here — but if the roster showed a track count above
            zero for this artist, that is a defect worth reporting rather than an empty
            catalogue.
          </p>
        </div>
      )}

      {tracks !== null && tracks.length > 0 && (
        <>
          <p className="hint">
            {tracks.length} track{tracks.length === 1 ? '' : 's'} uploaded
          </p>

          <div className="tablewrap panel">
            <table className="table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Kind</th>
                  <th className="num">Length</th>
                  <th>Uploaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tracks.map(t => (
                  <tr key={t.id}>
                    <td>
                      <span className="table__title">{t.title}</span>
                      {t.description && <div className="hint">{t.description}</div>}
                      {openTrackId === t.id && (
                        <div style={{ marginTop: 12 }}>
                          {t.mediaUrl === null ? (
                            <p className="hint">
                              This row has no media URL, which should be impossible under
                              tracks_media_shape_check. Worth investigating rather than
                              granting on.
                            </p>
                          ) : t.mediaKind === 'video' ? (
                            <video
                              className="player player--video"
                              controls
                              preload="metadata"
                              poster={t.thumbnailUrl ?? t.coverArtUrl ?? undefined}
                              src={t.mediaUrl}
                            />
                          ) : (
                            <audio className="player" controls preload="none" src={t.mediaUrl} />
                          )}
                        </div>
                      )}
                    </td>
                    <td>{t.mediaKind}</td>
                    <td className="num">{formatDuration(t.durationSeconds)}</td>
                    <td>{formatDate(t.createdAt)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpenTrackId(openTrackId === t.id ? null : t.id)}
                      >
                        {openTrackId === t.id ? 'Close' : 'Play'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
