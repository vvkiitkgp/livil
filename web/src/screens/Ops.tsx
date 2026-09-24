import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { sendBadgePush } from '../data/push';
import { fetchWaitlist, recordSendResult, type WaitlistEntry } from '../data/waitlist';
import { sendInvite } from '../data/invite';
import { formatDate } from '../format';
import { fetchTeamMessages, type TeamMessage } from '../data/teamMessages';
import { fetchOpsUsers, type OpsUser } from '../data/opsUsers';
import { fetchTopSearchResults, type OpsSearchResult, type OpsSearchKind } from '../data/opsSearch';
import { fetchOpsReports, markReportReviewed, type OpsReport } from '../data/opsReports';
import { TakedownDialog } from '../components/TakedownDialog';
import {
  claimLabel,
  concernLabel,
  fetchOpsCopyrightScans,
  liveLabel,
  restoreTrack,
  scopeLabel,
  shortId,
  takeDownTrack,
  type Concern,
  type OpsCopyrightScan,
} from '../data/opsCopyright';
import {
  OPS_BADGES,
  fetchAllBadgeHolders,
  fetchBadgeStatus,
  grantBadge,
  revokeBadge,
  type BadgeStatus,
} from '../data/profileBadges';

/**
 * Waitlist ops.
 *
 * WHY THIS EXISTS: `waitlist` was created write-only — anon INSERT, no SELECT for anyone —
 * so a signup landed in Postgres and nothing observed it. Four people joined on 2026-07-22/23
 * and were not noticed for thirteen days. This page is the missing reader.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM: there is no "accepted as tester" column. The Play
 * Developer API's Testers resource exposes only `googleGroups[]` and has no read of an
 * individual's opt-in state, and consumer Google Groups have no membership API. A column
 * for it could never be filled, and a permanently-empty column reads as "nobody accepted"
 * rather than "unknowable". `email_sent_at` is the one contact fact we can actually assert.
 *
 * SECURITY: no privileged credential is involved. Every read and write here goes through
 * the operator's own session against `is_ops()`-gated RLS, so a non-ops visitor loading this
 * URL sees an empty table rather than data. That is why there is no route guard.
 */
/**
 * A takedown or restore that has been started but not yet confirmed.
 *
 * `resultKey` is the row the outcome gets written back to, and it is NOT the track id:
 * the same track can appear in the copyright queue and the report queue at once, and the
 * operator needs the answer under the row they actually clicked.
 */
type PendingAction = {
  mode: 'takedown' | 'restore';
  trackId: string;
  title: string;
  idShort: string;
  resultKey: string;
  source: 'copyright' | 'report';
  warning?: string | null;
  impact?: string | null;
};

/**
 * The tabs, in the order an operator should meet them.
 *
 * Grouped by what you came here to DO, not by which table the rows live in — six tables
 * stacked on one page meant scrolling past the queue with a deadline on it to reach the
 * search stats. Moderation leads because it is the only group anyone is waiting on:
 * Reports and Copyright matches are two views of the same question and end in the same
 * two RPCs, so splitting them across tabs would hide half an answer. Users and Waitlist
 * pair for the same reason in reverse — who is on Livil, and who is asking to be.
 */
const OPS_TABS = [
  { key: 'moderation', label: 'Moderation' },
  { key: 'people', label: 'People' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'insights', label: 'Insights' },
] as const;

type OpsTab = (typeof OPS_TABS)[number]['key'];

const DEFAULT_TAB: OpsTab = 'moderation';

/**
 * Which copyright rows are still asking for a human.
 *
 * 'explained' has been answered and 'nothing_live' is inert — neither is work. Reusing the
 * concern the section already ranks by means the badge can never disagree with the order
 * of the list underneath it.
 */
const CONCERNS_WANTING_A_HUMAN = new Set<Concern>([
  'unanswered',
  'reference_mismatch',
  'weak_claim',
]);

export function Ops() {
  // The tab lives in the URL, not in state, so a reload and the back button out of
  // /ops/user/:id both return you to the tab you were working in rather than the top of
  // Moderation. Written with replace: true — stepping back through four tab clicks to
  // leave the page would be its own annoyance.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: OpsTab = OPS_TABS.some(t => t.key === tabParam)
    ? (tabParam as OpsTab)
    : DEFAULT_TAB;

  const setTab = useCallback(
    (next: OpsTab) => {
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          if (next === DEFAULT_TAB) { params.delete('tab'); } else { params.set('tab', next); }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [users, setUsers] = useState<OpsUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [searchKind, setSearchKind] = useState<OpsSearchKind>('track');
  const [searchDays, setSearchDays] = useState(30);
  const [topSearched, setTopSearched] = useState<OpsSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [reports, setReports] = useState<OpsReport[] | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [reportBusyId, setReportBusyId] = useState<string | null>(null);
  const [holders, setHolders] = useState<Record<string, Set<string>> | null>(null);
  const [statuses, setStatuses] = useState<Record<string, BadgeStatus | null>>({});
  /** `${userId}:${badge}` — so one row's two buttons spin independently. */
  const [badgeBusyKey, setBadgeBusyKey] = useState<string | null>(null);
  const [badgeError, setBadgeError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchWaitlist()
      .then(setEntries)
      .catch(e => {
        setEntries([]);
        setLoadError(e?.message ?? 'Could not load the waitlist.');
      });
  }, []);

  useEffect(load, [load]);

  // Copyright matches. Loaded independently for the same reason as everything else here:
  // one failing RPC must not blank the rest of the page.
  const [scans, setScans] = useState<OpsCopyrightScan[] | null>(null);
  const [scansError, setScansError] = useState<string | null>(null);

  const loadScans = useCallback(() => {
    setScansError(null);
    fetchOpsCopyrightScans(true)
      .then(setScans)
      .catch(e => {
        setScans([]);
        setScansError(e?.message ?? 'Could not load copyright matches.');
      });
  }, []);

  useEffect(loadScans, [loadScans]);

  const loadReports = useCallback(() => {
    setReportsError(null);
    fetchOpsReports(showReviewed)
      .then(setReports)
      .catch(e => {
        setReports([]);
        setReportsError(e?.message ?? 'Could not load reports.');
      });
  }, [showReviewed]);

  useEffect(loadReports, [loadReports]);


  // Which row is mid-action. Not optimistic: the only honest answer to "did that work" is
  // the one the database returns, and a row that flips to "Taken down" and silently was
  // not is worse than a slow button.
  const [actingId, setActingId] = useState<string | null>(null);

  /**
   * The takedown / restore question, while it is being asked.
   *
   * One piece of state for BOTH queues — the copyright matches and the reports — because
   * they end in the same two RPCs. Two dialogs would be two chances for the wording of a
   * takedown to drift, and the wording is what the creator reads.
   */
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Outcome per ROW, not one banner at the top of the section. The first real use of the
  // actuator put the result in a page-level line the operator never saw, so a takedown
  // that correctly removed nothing read as a broken feature.
  const [rowResult, setRowResult] = useState<Record<string, string>>({});

  const onTakeDown = useCallback((row: OpsCopyrightScan) => {
    const live = row.liveUploads + row.liveReposts;
    setPending({
      mode: 'takedown',
      trackId: row.trackId,
      title: row.trackTitle,
      idShort: shortId(row.trackId),
      resultKey: row.id,
      source: 'copyright',
      // Nothing to remove is almost always a misclick — and it is exactly the misclick
      // that happened, between two rows with the same title. Say so before acting, and
      // name the track id, because the title alone did not distinguish them.
      warning:
        live === 0
          ? 'Nothing is published for this track. Taking it down removes no posts and '
            + 'changes nothing anyone can see — it only marks the track and counts as a '
            + 'strike against the artist. Two uploads can share a title: did you mean a '
            + 'different row?'
          : null,
      impact:
        live === 0
          ? null
          : `This removes ${liveLabel(row)}`
            + (row.liveReposts > 0
              ? " — including other people's reposts, which do NOT come back on restore."
              : '.'),
    });
  }, []);

  const onRestore = useCallback((row: OpsCopyrightScan) => {
    setPending({
      mode: 'restore',
      trackId: row.trackId,
      title: row.trackTitle,
      idShort: shortId(row.trackId),
      resultKey: row.id,
      source: 'copyright',
      impact:
        "The uploader's own post comes back with its caption and clip. Likes, comments "
        + 'and other people\'s reposts do NOT — they were deleted and cannot be recovered.',
    });
  }, []);

  /** Take down the track behind a REPORT. Same two RPCs, different queue. */
  const onReportAction = useCallback((r: OpsReport) => {
    if (!r.trackId) return;
    const down = r.trackTakenDownAt !== null;
    setPending({
      mode: down ? 'restore' : 'takedown',
      trackId: r.trackId,
      title: r.trackTitle ?? '(untitled)',
      idShort: shortId(r.trackId),
      resultKey: `${r.kind}-${r.id}`,
      source: 'report',
      // The reporter already said why. Carrying it in stops the operator retyping it and,
      // more usefully, puts the accusation next to the categories so a mismatch is
      // visible — "reported as spam" against a copyright takedown is worth noticing.
      impact: down
        ? "The uploader's own post comes back. Likes, comments and other people's reposts "
          + 'do NOT.'
        : `Reported as “${r.reason}”. Taking the track down removes the uploader's post `
          + 'and every repost of it.',
    });
  }, []);

  /**
   * Runs whichever question the dialog was asking.
   *
   * The outcome is written per ROW rather than into a page-level banner: the first version
   * of this put the result in a line at the top of the section that the operator never
   * scrolled to, so a takedown that correctly removed nothing read as a broken feature.
   */
  const runPending = useCallback(
    async (reason: string) => {
      if (!pending) return;
      setActingId(pending.resultKey);
      try {
        if (pending.mode === 'takedown') {
          const removed = await takeDownTrack(pending.trackId, reason);
          setRowResult(r => ({
            ...r,
            [pending.resultKey]:
              removed === 0
                ? 'Marked down. Nothing was published, so nothing was removed.'
                : `Taken down — ${removed} post${removed === 1 ? '' : 's'} removed.`,
          }));
        } else {
          await restoreTrack(pending.trackId, reason);
          setRowResult(r => ({
            ...r,
            [pending.resultKey]: "Restored — the uploader's post is back.",
          }));
        }
        setPending(null);
        // Both queues can show the same track, so both are refreshed whichever one the
        // action was started from.
        loadScans();
        loadReports();
      } catch (e) {
        setRowResult(r => ({
          ...r,
          [pending.resultKey]: (e as Error)?.message ?? 'That did not work.',
        }));
        setPending(null);
      } finally {
        setActingId(null);
      }
    },
    [pending, loadScans, loadReports],
  );

  // Loaded independently of the waitlist: a failure in one should not blank the other, and
  // the same is_ops() gate covers both, so there is nothing to sequence.

  // Loaded independently of the waitlist: a failure in one should not blank the other, and
  // the same is_ops() gate covers both, so there is nothing to sequence.
  useEffect(() => {
    fetchOpsUsers()
      .then(setUsers)
      .catch(e => {
        setUsers([]);
        setUsersError(e?.message ?? 'Could not load users.');
      });
  }, []);

  // Depends on the roster, so it runs after `users` lands rather than on mount.
  // Deliberately NOT folded into fetchOpsUsers: the roster is a different function
  // with a different shape, and threading badges through it would put award-order
  // columns one join away from a surface that has no business holding them.
  const loadBadges = useCallback((roster: OpsUser[]) => {
    setBadgeError(null);
    Promise.all([
      fetchAllBadgeHolders(roster.map(u => u.id)),
      // One status call per badge: each has its own cap and its own remaining count, and
      // an uncapped badge reports NULL rather than a number.
      Promise.all(OPS_BADGES.map(b => fetchBadgeStatus(b.badge).then(st => [b.badge, st] as const))),
    ])
      .then(([byBadge, statusPairs]) => {
        setHolders(byBadge);
        setStatuses(Object.fromEntries(statusPairs));
      })
      .catch(e => {
        // NULL, not {}. An empty map reads as "nobody holds anything", so every row would
        // offer "Grant First 100" next to people who already have it. Null is the state the
        // cell's "unavailable" branch tests for — matching OpsUser.
        setHolders(null);
        setBadgeError(e?.message ?? 'Could not load badges.');
      });
  }, []);

  useEffect(() => {
    if (users && users.length > 0) loadBadges(users);
  }, [users, loadBadges]);

  // Optimistic would be wrong here: the cap lives in the database, so the only
  // honest answer to "did that work" is the one the grant returns. A button that
  // flips to "First 100" and then silently isn't would be worse than a slow one.
  const handleToggleBadge = useCallback(
    async (u: OpsUser, badge: string, label: string) => {
      if (!holders) return;
      setBadgeBusyKey(`${u.id}:${badge}`);
      setBadgeError(null);
      try {
        const held = holders[badge]?.has(u.id) ?? false;
        const result = held ? await revokeBadge(u.id, badge) : await grantBadge(u.id, badge);
        // Only on a real grant. 'already' means they had it — re-announcing would buzz
        // somebody's phone about news they got days ago — and a revoke is not news we have
        // decided to send at all.
        if (result === 'granted') { void sendBadgePush(u.id, badge, label); }
        if (result === 'full') {
          setBadgeError(
            `Every ${label} slot is held. Revoke one to free it — slots left by deleted accounts cannot be recovered.`,
          );
        }
        if (users) loadBadges(users);
      } catch (e) {
        setBadgeError(e instanceof Error ? e.message : 'Could not change that badge.');
      } finally {
        setBadgeBusyKey(null);
      }
    },
    [holders, users, loadBadges],
  );

  // Optimistic, then reload: the row must leave the open queue the instant it is
  // actioned, or an operator working down a list re-reads rows they just cleared.
  const handleReviewed = useCallback(
    async (r: OpsReport) => {
      setReportBusyId(r.id);
      try {
        await markReportReviewed(r.kind, r.id, r.reviewedAt === null);
        loadReports();
      } catch (e) {
        setReportsError(e instanceof Error ? e.message : 'Could not update that report.');
      } finally {
        setReportBusyId(null);
      }
    },
    [loadReports],
  );

  useEffect(() => {
    setTopSearched(null);
    setSearchError(null);
    fetchTopSearchResults(searchKind, searchDays)
      .then(setTopSearched)
      .catch(e => {
        setTopSearched([]);
        setSearchError(e?.message ?? 'Could not load search analytics.');
      });
  }, [searchKind, searchDays]);

  useEffect(() => {
    fetchTeamMessages()
      .then(setMessages)
      .catch(e => {
        setMessages([]);
        setMessagesError(e?.message ?? 'Could not load messages.');
      });
  }, []);

  const stats = useMemo(() => {
    const list = entries ?? [];
    return {
      total: list.length,
      sent: list.filter(e => e.emailSentAt).length,
      auto: list.filter(e => e.emailSource === 'auto').length,
      failed: list.filter(e => !e.emailSentAt && e.emailError).length,
    };
  }, [entries]);

  /**
   * How much work is waiting behind each tab.
   *
   * Only counts things an operator can finish. A tab with nothing to do shows no number
   * at all rather than a zero, because the point of the badge is to say where to go —
   * and a badge that never moves is one more thing to learn to ignore, which is the
   * habit this page was built to break.
   *
   * Every section still loads on mount, hidden or not. That is deliberate: these numbers
   * have to be true before you click, so deferring a tab's fetch would only trade the
   * scrolling for a dashboard that cannot tell you where the work is.
   */
  const waiting: Record<OpsTab, number> = useMemo(() => ({
    moderation:
      (reports ?? []).filter(r => !r.reviewedAt).length
      + (scans ?? []).filter(
        sc => !sc.takenDownAt && CONCERNS_WANTING_A_HUMAN.has(sc.concern),
      ).length,
    // Someone who signed up and has never been emailed. Not "everyone on the list" —
    // that number only grows, so it would stop meaning anything within a week.
    people: (entries ?? []).filter(e => !e.emailSentAt).length,
    // Messages have no read state to count, and search stats are never owed a reply.
    inbox: 0,
    insights: 0,
  }), [reports, scans, entries]);

  async function onSend(entry: WaitlistEntry) {
    setBusyId(entry.id);
    // The send and the bookkeeping are separate calls, so a delivered email whose status
    // write fails shows as unsent. That direction is the safe one: re-sending an invite is
    // a minor annoyance, believing someone was contacted when they were not is the failure
    // this whole page exists to prevent.
    const result = await sendInvite(entry.email);
    try {
      const updated = await recordSendResult(entry, result);
      setEntries(prev => (prev ?? []).map(e => (e.id === entry.id ? updated : e)));
    } catch {
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function onCopy(entry: WaitlistEntry) {
    await navigator.clipboard.writeText(entry.email);
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId(c => (c === entry.id ? null : c)), 1600);
  }

  /**
   * Reports. The first tab, and the first section in it, on purpose: this is the only
   * queue here with a clock on it. Play's UGC policy expects reports to be acted on, and
   * the queue that gets scrolled past is the queue that rots — which is how post_reports
   * sat unread for two months.
   */
  const renderReports = () => (
    <>
      <header className="page__head">
        <div>
          <p className="kicker">Needs a decision</p>
          <h1 className="display page__title">Reports</h1>
        </div>
        <div className="filters">
          {reports !== null && !showReviewed && (
            <span className="chip" data-active>
              {reports.length} open
            </span>
          )}
          <Button
            variant={showReviewed ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowReviewed(v => !v)}
          >
            {showReviewed ? 'Open only' : 'Show reviewed'}
          </Button>
        </div>
      </header>

      {reportsError && (
        <div className="empty panel">
          <p className="empty__title">Could not load reports</p>
          <p className="hint">{reportsError}</p>
        </div>
      )}

      {reports === null && !reportsError && <div className="skeleton skeleton--rows" />}

      {reports !== null && reports.length === 0 && !reportsError && (
        <div className="empty panel">
          <p className="empty__title">{showReviewed ? 'No reports yet' : 'Nothing waiting'}</p>
          <p className="hint">
            Reports from posts, comments and stories all land here. Story reports are kept
            even after the story expires.
          </p>
        </div>
      )}

      {reports !== null && reports.length > 0 && (
        <div className="panel msglist">
          {reports.map(r => (
            <article className="msg" key={`${r.kind}-${r.id}`}>
              <div className="msg__head">
                <span className="badge" data-kind={r.kind}>{r.kind}</span>
                <span className="table__title">{r.reason}</span>
                {r.reportedUsername ? (
                  <span className="hint">on @{r.reportedUsername}</span>
                ) : (
                  <span className="hint">on a deleted account</span>
                )}
                {/* The reported thing can be gone — a deleted post, or a story past
                    its 24 hours — while the report and the reported USER remain. Say
                    so rather than dropping the row. */}
                {!r.targetExists && <span className="badge">content gone</span>}
                <span className="hint msg__when">{formatDate(r.createdAt)}</span>
              </div>

              <p className="msg__body">
                {r.targetExcerpt || '(nothing to show)'}
              </p>

              {/* THE REPORTED THING, PLAYABLE. Without this the queue was an accusation
                  and a username, and the only honest action was "I looked at some text".
                  `preload="none"` because a page of reports would otherwise open a
                  connection per row on load. A comment report plays the track the comment
                  sits under — the remark is what was reported, but the remark is not
                  judgeable on its own. */}
              {r.mediaUrl && (
                <div className="msg__media">
                  {r.coverUrl && <img src={r.coverUrl} alt="" />}
                  <div className="msg__mediatext">
                    <span className="hint">
                      {r.trackTitle ?? '(untitled)'}
                      {r.kind === 'comment' && ' — the post this comment is on'}
                      {r.trackTakenDownAt && ' · already taken down'}
                    </span>
                    {r.mediaKind === 'video' ? (
                      <video src={r.mediaUrl} controls preload="none" />
                    ) : (
                      <audio src={r.mediaUrl} controls preload="none" />
                    )}
                  </div>
                </div>
              )}

              <div className="msg__head">
                <span className="hint">
                  reported by {r.reporterUsername ? `@${r.reporterUsername}` : 'a deleted account'}
                </span>
                {r.reviewedAt && (
                  <span className="hint">
                    reviewed {formatDate(r.reviewedAt)}
                    {r.reviewerUsername ? ` by @${r.reviewerUsername}` : ''}
                  </span>
                )}
                <div className="filters" style={{ marginLeft: 'auto' }}>
                  {/* Only when there is a track to act on. A comment report offers this
                      too — a comment can be reported ON an upload that is itself the
                      problem — but the button says what it actually does, because taking
                      down the track does NOT delete the comment. */}
                  {r.trackId && (
                    <Button
                      variant={r.trackTakenDownAt ? 'secondary' : 'destructive'}
                      size="sm"
                      busy={actingId === `${r.kind}-${r.id}`}
                      onClick={() => onReportAction(r)}
                    >
                      {r.trackTakenDownAt
                        ? 'Restore track'
                        : r.kind === 'comment'
                          ? 'Take down the track'
                          : 'Take down'}
                    </Button>
                  )}
                  <Button
                    variant={r.reviewedAt ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={reportBusyId === r.id}
                    onClick={() => handleReviewed(r)}
                  >
                    {r.reviewedAt ? 'Reopen' : 'Mark reviewed'}
                  </Button>
                </div>
              </div>

              {/* Per row, not a page-level banner: an operator working down a list never
                  scrolls back up to find out whether the last click did anything. */}
              {rowResult[`${r.kind}-${r.id}`] && (
                <p className="hint">{rowResult[`${r.kind}-${r.id}`]}</p>
              )}

              {r.details && <p className="hint">{r.details}</p>}
            </article>
          ))}
        </div>
      )}
    </>
  );

  const renderCopyright = () => (
    <>
      {/* ── Copyright matches ──────────────────────────────────────────────
          Ordered by how much each row wants a human, not by time: a queue sorted
          newest-first makes an operator read everything to find the one thing that
          matters. A match is NOT a verdict — fingerprinting has real false positives on
          covers, live takes and sampled material — so nothing here is phrased as an
          accusation, and "Never answered" ranks top simply because nobody has explained
          themselves. */}
      <header className="page__head">
        <div>
          <h2 className="page__title">Copyright matches</h2>
          <p className="page__sub">
            Uploads that sound like a known recording, and what the uploader said about
            them. A match is a reason to look, not proof of anything.
          </p>
        </div>
      </header>

      {scansError && <p className="error">{scansError}</p>}

      {scans !== null && scans.length === 0 && !scansError && (
        <div className="empty panel">
          <p className="empty__title">No matches yet</p>
          <p className="hint">
            Uploads are checked as they finish. Nothing has matched a known recording.
          </p>
        </div>
      )}

      {scans !== null && scans.length > 0 && (
        <div className="tablewrap panel">
          <table className="table">
            <thead>
              <tr>
                <th>Upload</th>
                <th>Sounds like</th>
                <th>They said</th>
                <th>Concern</th>
              </tr>
            </thead>
            <tbody>
              {scans.map(s => (
                <tr key={s.id} data-concern={s.concern}>
                  <td>
                    <span className="table__title">{s.trackTitle}</span>
                    <div className="hint">
                      {s.uploaderUsername ? `@${s.uploaderUsername}` : 'unknown'}
                      {' · '}
                      {s.mediaKind ?? 'audio'}
                      {' · '}
                      {formatDate(s.createdAt)}
                    </div>
                    {/* The two facts that would have prevented the first misclick: what
                        is actually serving, and a handle that distinguishes two uploads
                        sharing a title. */}
                    <div className="hint" data-empty={s.liveUploads + s.liveReposts === 0}>
                      {liveLabel(s)}
                    </div>
                    <div className="hint">{shortId(s.trackId)}</div>
                  </td>

                  <td>
                    <span className="table__title">{s.matchedTitle ?? '—'}</span>
                    {s.matchedArtist && <div className="hint">{s.matchedArtist}</div>}
                    {s.matchedIsrc && <div className="hint">ISRC {s.matchedIsrc}</div>}
                  </td>

                  <td>
                    <span className="table__title">{claimLabel(s.claim)}</span>
                    {s.claimBasis && <div className="hint">{s.claimBasis}</div>}
                    {s.claimGrantor && <div className="hint">from {s.claimGrantor}</div>}
                    {s.claimScope && s.claimScope.length > 0 && (
                      <div className="hint">covers {s.claimScope.map(scopeLabel).join(', ')}</div>
                    )}
                    {(s.claimTerritory || s.claimTerm) && (
                      <div className="hint">
                        {[s.claimTerritory, s.claimTerm].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {s.claimReference && (
                      <div className="hint">
                        ref {s.claimReference}
                        {/* The one automatic check worth making: is the claimant even
                            talking about the recording we matched? Null means one side is
                            absent, which most legitimate creators are — no badge shown. */}
                        {s.referenceMatchesIsrc === true && ' — matches'}
                        {s.referenceMatchesIsrc === false && ' — different recording'}
                      </div>
                    )}
                    {s.claimNote && <div className="hint">&ldquo;{s.claimNote}&rdquo;</div>}
                    {s.answeredAt && <div className="hint">{formatDate(s.answeredAt)}</div>}
                  </td>

                  <td>
                    <span className="badge" data-kind={s.concern}>
                      {s.takenDownAt ? 'Taken down' : concernLabel(s.concern)}
                    </span>

                    {/* The repeat-infringer signal, on the row where the decision is made
                        rather than a screen away. */}
                    {s.uploaderTakedowns > 0 && (
                      <div className="hint">
                        {s.uploaderTakedowns} takedown
                        {s.uploaderTakedowns === 1 ? '' : 's'} for this artist
                      </div>
                    )}

                    {/* Absence is shown rather than rendered as a tick: rows answered
                        before the boxes existed carry neither, and that should be
                        visible. */}
                    {s.claim && s.claim !== 'cancelled' && (
                      <div className="hint">
                        {s.acceptedResponsibility === true && s.grantedStreamingLicence === true
                          ? 'Accepted responsibility · granted streaming'
                          : 'Predates the consent boxes'}
                      </div>
                    )}

                    <div className="rights__actions" style={{ marginTop: 'var(--space-2)' }}>
                      {s.takenDownAt ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          busy={actingId === s.id}
                          onClick={() => void onRestore(s)}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          busy={actingId === s.id}
                          onClick={() => void onTakeDown(s)}
                        >
                          Take down
                        </Button>
                      )}
                    </div>

                    {/* The outcome, on the row that produced it. */}
                    {rowResult[s.id] && <div className="hint">{rowResult[s.id]}</div>}

                    {/* Stated plainly. An operator who believes the audio is gone when it
                        is still fetchable would give a rights holder a wrong answer. */}
                    <div className="hint">Files stay online until a purge exists</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const renderUsers = () => (
    <>
      <header className="page__head">
        <div>
          <p className="kicker">Everyone on Livil</p>
          <h1 className="display page__title">Users</h1>
        </div>
        {users !== null && users.length > 0 && (
          <p className="hint">
            {users.length} account{users.length === 1 ? '' : 's'}
            {OPS_BADGES.map(({ badge, label }) => {
              const st = statuses[badge];
              if (!st) { return null; }
              return (
                <span key={badge}>
                  {' · '}
                  {st.live} {label} live
                  {/* Only a capped badge has slots to run out of. Verified reports NULL
                      here, and "0 slots left" would be a lie about an unlimited badge. */}
                  {st.remaining != null
                    && `, ${st.remaining} slot${st.remaining === 1 ? '' : 's'} left`}
                </span>
              );
            })}
          </p>
        )}
      </header>

      {badgeError && (
        <div className="empty panel">
          <p className="empty__title">First 100</p>
          <p className="hint">{badgeError}</p>
        </div>
      )}

      {usersError && (
        <div className="empty panel">
          <p className="empty__title">Could not load users</p>
          <p className="hint">{usersError}</p>
        </div>
      )}

      {users === null && !usersError && <div className="skeleton skeleton--rows" />}

      {users !== null && users.length > 0 && (
        <div className="tablewrap panel">
          <table className="table">
            <thead>
              <tr>
                <th>Artist</th>
                <th>Email</th>
                <th>Joined</th>
                <th className="num">Tracks</th>
                {/* One column, not "fans" and "stars" — follows_kind_check permits only
                    kind='star', so they are the same relationship under a different word. */}
                <th className="num">Stars</th>
                <th className="num">Friends</th>
                {OPS_BADGES.map(({ badge, label }) => <th key={badge}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <span className="table__title">{u.displayName ?? 'No name'}</span>
                    {u.username && <div className="hint">@{u.username}</div>}
                  </td>
                  <td>
                    {u.email ? (
                      <a className="hint" href={`mailto:${u.email}`}>
                        {u.email}
                      </a>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  {/* The count is the way in to reviewing the work behind it. Zero stays
                      plain text — a link to an empty page is a dead end, not an affordance. */}
                  <td className="num">
                    {u.tracksCount > 0 ? (
                      <Link className="linkish" to={`/ops/user/${u.id}`}>
                        {u.tracksCount}
                      </Link>
                    ) : (
                      u.tracksCount
                    )}
                  </td>
                  <td className="num">{u.starsCount}</td>
                  <td className="num">{u.friendsCount}</td>
                  {OPS_BADGES.map(({ badge, label }) => {
                    const held = holders?.[badge]?.has(u.id) ?? false;
                    const st = statuses[badge];
                    return (
                      <td key={badge}>
                        {holders === null ? (
                          <span className="hint">unavailable</span>
                        ) : (
                          <Button
                            variant={held ? 'secondary' : 'ghost'}
                            size="sm"
                            busy={badgeBusyKey === `${u.id}:${badge}`}
                            // Out of slots, nobody new can be granted — but an existing
                            // holder must still be revocable, or a mistaken grant is
                            // permanent. Hence the holder check, not a flat disable.
                            // `remaining` is null for an uncapped badge, which is not
                            // the same as none left.
                            disabled={!held && st?.remaining != null && st.remaining <= 0}
                            onClick={() => handleToggleBadge(u, badge, label)}
                          >
                            {/* Named, not just "Grant". With two badge columns a bare
                                verb makes you count across the header to know which
                                one you are about to hand out. */}
                            {held ? `Revoke ${label}` : `Grant ${label}`}
                          </Button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const renderWaitlist = () => (
    <>
      <header className="page__head">
        <div>
          <p className="kicker">Backstage</p>
          <h1 className="display page__title">Waitlist</h1>
        </div>
        <div className="filters">
          <span className="chip" data-active>
            {stats.total} total
          </span>
          <span className="chip">{stats.sent} emailed</span>
          {stats.auto > 0 && <span className="chip">{stats.auto} auto</span>}
          {stats.failed > 0 && <span className="chip">{stats.failed} failed</span>}
        </div>
      </header>

      {loadError && (
        <div className="empty panel">
          <p className="empty__title">Could not load the waitlist</p>
          <p className="hint">{loadError}</p>
          <Button onClick={load}>Try again</Button>
        </div>
      )}

      {entries === null && !loadError && <div className="skeleton skeleton--rows" />}

      {entries !== null && entries.length === 0 && !loadError && (
        <div className="empty panel">
          <p className="empty__title">No signups yet</p>
          <p className="hint">
            If you expected rows here, check that your account is in <code>ops_users</code> —
            RLS returns an empty list rather than an error when it is not.
          </p>
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="tablewrap panel">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Requested</th>
                <th>Invite</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td>
                    <span className="table__title">{e.email}</span>
                  </td>
                  <td>{formatDate(e.createdAt)}</td>
                  <td>
                    {e.emailSentAt ? (
                      <span
                        className="badge"
                        data-kind="audio"
                        title={
                          e.emailSource === 'auto'
                            ? 'Sent automatically when they signed up'
                            : e.emailSource === 'ops'
                              ? 'Sent by hand from this dashboard'
                              : 'Sent before send-source was recorded'
                        }
                      >
                        {e.emailSource === 'auto' ? 'auto' : 'sent'} {formatDate(e.emailSentAt)}
                      </span>
                    ) : e.emailError ? (
                      <span className="badge" data-kind="video" title={e.emailError}>
                        failed
                      </span>
                    ) : (
                      <span className="badge">pending</span>
                    )}
                    {e.emailError && !e.emailSentAt && (
                      <p className="hint">{e.emailError}</p>
                    )}
                  </td>
                  <td className="num">
                    <div className="filters">
                      <button
                        type="button"
                        className="chip"
                        onClick={() => onCopy(e)}
                        title="Copy the address, for pasting into the Play Console tester list"
                      >
                        {copiedId === e.id ? 'copied' : 'copy'}
                      </button>
                      <Button
                        size="sm"
                        busy={busyId === e.id}
                        disabled={busyId !== null}
                        onClick={() => onSend(e)}
                      >
                        {e.emailSentAt ? 'Resend' : 'Send invite'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const renderMessages = () => (
    <>
      <header className="page__head">
        <div>
          <p className="kicker">The backstage door</p>
          <h1 className="display page__title">Messages</h1>
        </div>
      </header>

      {messagesError && (
        <div className="empty panel">
          <p className="empty__title">Could not load messages</p>
          <p className="hint">{messagesError}</p>
        </div>
      )}

      {messages === null && !messagesError && <div className="skeleton skeleton--rows" />}

      {messages !== null && messages.length === 0 && !messagesError && (
        <div className="empty panel">
          <p className="empty__title">Nothing yet</p>
          <p className="hint">
            Artists can write in from the studio — the avatar menu, &ldquo;Message the
            team&rdquo;.
          </p>
        </div>
      )}

      {messages !== null && messages.length > 0 && (
        <div className="panel msglist">
          {messages.map(m => (
            <article className="msg" key={m.id}>
              <div className="msg__head">
                <span className="table__title">
                  {m.senderName ?? m.senderUsername ?? 'Deleted account'}
                </span>
                {m.senderUsername && <span className="hint">@{m.senderUsername}</span>}
                {m.senderEmail && (
                  /* mailto, because replying IS the workflow — there is no reply path in the
                     product by design, so the address has to be one click from the message. */
                  <a className="hint" href={`mailto:${m.senderEmail}?subject=Re: your message to Livil`}>
                    {m.senderEmail}
                  </a>
                )}
                <span className="hint msg__when">{formatDate(m.createdAt)}</span>
              </div>
              {/* Whitespace preserved: people write in paragraphs, and collapsing them turns
                  a considered message into a wall. */}
              <p className="msg__body">{m.body}</p>
            </article>
          ))}
        </div>
      )}
    </>
  );

  const renderSearched = () => (
    <>
      <header className="page__head">
        <div>
          <p className="kicker">What people open from search</p>
          <h1 className="display page__title">Most searched</h1>
        </div>
        <div className="filerow">
          {(['track', 'album', 'profile'] as OpsSearchKind[]).map(k => (
            <Button
              key={k}
              variant={searchKind === k ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSearchKind(k)}
            >
              {k === 'track' ? 'Songs' : k === 'album' ? 'Albums' : 'People'}
            </Button>
          ))}
          {[7, 30, 365].map(d => (
            <Button
              key={d}
              variant={searchDays === d ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSearchDays(d)}
            >
              {d === 365 ? 'All time' : `${d}d`}
            </Button>
          ))}
        </div>
      </header>

      {searchError && (
        <div className="empty panel">
          <p className="empty__title">Could not load search analytics</p>
          <p className="hint">{searchError}</p>
        </div>
      )}

      {topSearched === null && !searchError && <div className="skeleton skeleton--rows" />}

      {topSearched !== null && topSearched.length === 0 && !searchError && (
        <div className="empty panel">
          <p className="empty__title">Nothing opened from search yet</p>
          {/* Says which of the two possible reasons it is, because "no data" on a brand new
              metric usually means nobody has shipped the client that records it. */}
          <p className="hint">
            Taps are recorded from the app&apos;s search screen. Nothing in this window yet.
          </p>
        </div>
      )}

      {topSearched !== null && topSearched.length > 0 && (
        <div className="tablewrap panel">
          <table className="table">
            <thead>
              <tr>
                <th>{searchKind === 'profile' ? 'Person' : searchKind === 'album' ? 'Album' : 'Song'}</th>
                {/* People first: it is the number this ranks by. Fifty people opening a song
                    once beats one person opening it fifty times, and showing taps as the
                    headline is how a chart gets read wrong. */}
                <th className="num">People</th>
                <th className="num">Opens</th>
              </tr>
            </thead>
            <tbody>
              {topSearched.map(r => (
                <tr key={r.entityId}>
                  <td>
                    <span className="table__title">{r.title ?? 'Deleted'}</span>
                    {r.subtitle && <div className="hint">{r.subtitle}</div>}
                  </td>
                  <td className="num">{r.people}</td>
                  <td className="num">{r.taps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
  return (
    <div className="page fade-up">
      <nav className="opstabs" aria-label="Ops sections">
        {OPS_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            className="opstab"
            // data-active rather than a class list because the whole backstage already
            // styles its selected state that way (see .chip[data-active]).
            data-active={t.key === tab || undefined}
            aria-current={t.key === tab ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {waiting[t.key] > 0 && <span className="opstab__count">{waiting[t.key]}</span>}
          </button>
        ))}
      </nav>

      {/* One group per tab. The group, not each header, owns the gap between stacked
          sections — `.opsgroup > * + .page__head` — so whichever section happens to be
          first sits tight under the tabs without anyone remembering to say so. */}
      {tab === 'moderation' && (
        <div className="opsgroup">
          {renderReports()}
          {renderCopyright()}
        </div>
      )}

      {tab === 'people' && (
        <div className="opsgroup">
          {renderUsers()}
          {renderWaitlist()}
        </div>
      )}

      {tab === 'inbox' && <div className="opsgroup">{renderMessages()}</div>}

      {tab === 'insights' && <div className="opsgroup">{renderSearched()}</div>}

      {/* One dialog, both queues. It replaces a `window.confirm` stacked in front of a
          `window.prompt` — two questions for one decision, in browser chrome, producing
          whatever was typed in a hurry as the sentence the creator would be shown. */}
      {pending && (
        <TakedownDialog
          mode={pending.mode}
          trackTitle={pending.title}
          trackIdShort={pending.idShort}
          warning={pending.warning}
          impact={pending.impact}
          busy={actingId === pending.resultKey}
          onConfirm={runPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
