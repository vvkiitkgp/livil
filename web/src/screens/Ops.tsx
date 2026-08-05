import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { fetchWaitlist, recordSendResult, type WaitlistEntry } from '../data/waitlist';
import { sendInvite } from '../data/invite';
import { formatDate } from '../format';

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
    </div>
  );
}
