import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { fetchWaitlist, recordSendResult, type WaitlistEntry } from '../data/waitlist';
import { sendInvite } from '../data/invite';
import { formatDate } from '../format';
import { fetchTeamMessages, type TeamMessage } from '../data/teamMessages';
import { fetchOpsUsers, type OpsUser } from '../data/opsUsers';
import { fetchTopSearchResults, type OpsSearchResult, type OpsSearchKind } from '../data/opsSearch';

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
export function Ops() {
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

  return (
    <div className="page fade-up">
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

      <header className="page__head" style={{ marginTop: 'var(--space-12)' }}>
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

      <header className="page__head" style={{ marginTop: 'var(--space-12)' }}>
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

      <header className="page__head" style={{ marginTop: 'var(--space-12)' }}>
        <div>
          <p className="kicker">Everyone on Livil</p>
          <h1 className="display page__title">Users</h1>
        </div>
        {users !== null && users.length > 0 && (
          <p className="hint">
            {users.length} account{users.length === 1 ? '' : 's'}
          </p>
        )}
      </header>

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
                  <td className="num">{u.tracksCount}</td>
                  <td className="num">{u.starsCount}</td>
                  <td className="num">{u.friendsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
