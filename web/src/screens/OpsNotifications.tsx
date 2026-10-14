/**
 * /studio/ops → Notifications: Livil's own scheduled pushes (migration 20261025000000).
 *
 *   • The four time slots, each with its own switch. Off by default; nothing is sent until
 *     a slot is turned on here.
 *   • Every line in each rotation: edit it, add one, switch it off, or send it to your own
 *     phone to see it for real. Saved lines go out from the next send — no deploy, no
 *     release.
 *   • What went out: per line (last 14 days) and per send (latest 20).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TextArea, TextField } from '../components/TextField';
import { formatDate } from '../format';
import {
  addMessage,
  BODY_MAX,
  FILL_INS,
  fetchMessages,
  fetchRecentSends,
  fetchSlots,
  fillInProblem,
  POOLS,
  previewText,
  sendTestToMe,
  setMessageActive,
  setSlotEnabled,
  TITLE_MAX,
  updateMessage,
  type PushMessage,
  type PushPool,
  type PushSend,
  type PushSlot,
} from '../data/opsNotifications';

const STATS_DAYS = 14;

const SLOT_LABELS: Record<PushSlot['slot'] | 'test', string> = {
  mood_morning: 'Morning mood',
  digest_morning: 'Repost digest',
  digest_evening: 'Repost digest',
  mood_evening: 'Evening mood',
  new_drop: 'New song from a friend',
  originals_weekly: 'Fresh on Livil',
  test: 'Preview (only you)',
};

/** The slots that need the app release with the "New music" switch before they start. */
const NEW_MUSIC_SLOTS = new Set<PushSlot['slot']>(['new_drop', 'originals_weekly']);

/** "08:00:00" → "8:00 AM". The column is a time of day in India; there is no date. */
function istTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** When a slot goes out, as the table shows it. */
function slotWhen(s: PushSlot): string {
  if (s.slot === 'new_drop') return 'When someone uploads';
  if (s.slot === 'originals_weekly') return `Sundays ${istTime(s.sendAtIst)}`;
  return istTime(s.sendAtIst);
}

/** What "on" means for a slot. */
function onLabel(s: PushSlot): string {
  if (s.slot === 'new_drop') return 'Sending';
  if (s.slot === 'originals_weekly') return 'Sending weekly';
  return 'Sending daily';
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

type Draft = { id: string | null; title: string; body: string };

export function OpsNotifications() {
  const [slots, setSlots] = useState<PushSlot[] | null>(null);
  const [messages, setMessages] = useState<PushMessage[] | null>(null);
  const [sends, setSends] = useState<PushSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<PushPool>('mood_morning');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmSlot, setConfirmSlot] = useState<PushSlot | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m, r] = await Promise.all([fetchSlots(), fetchMessages(STATS_DAYS), fetchRecentSends(20)]);
      setSlots(s);
      setMessages(m);
      setSends(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inPool = useMemo(
    () => (messages ?? []).filter(m => m.pool === pool).sort((a, b) => a.position - b.position),
    [messages, pool],
  );
  const poolInfo = POOLS.find(p => p.key === pool)!;

  const run = useCallback(
    async (key: string, work: () => Promise<void>, done?: string) => {
      setBusy(key);
      setNotice(null);
      try {
        await work();
        if (done) setNotice(done);
        await load();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const toggleSlot = (s: PushSlot) => {
    // Turning a slot ON reaches everyone at its next time, so it asks first; OFF does not.
    if (!s.enabled) {
      setConfirmSlot(s);
      return;
    }
    void run(`slot:${s.slot}`, () => setSlotEnabled(s.slot, false), `${SLOT_LABELS[s.slot]} (${slotWhen(s)}): stopped. Nobody gets it until you start it again.`);
  };

  const saveDraft = () => {
    if (!draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    const problem = !title || !body
      ? 'Both lines are needed.'
      : fillInProblem(pool, title) ?? fillInProblem(pool, body);
    if (problem) {
      setDraftError(problem);
      return;
    }
    setDraftError(null);
    const next = Math.max(0, ...inPool.map(m => m.position)) + 1;
    void run(
      'save',
      async () => {
        if (draft.id) await updateMessage(draft.id, title, body);
        else await addMessage(pool, next, title, body);
        setDraft(null);
      },
      draft.id ? 'Saved. The next send uses it.' : 'Added to the end of the rotation.',
    );
  };

  const testSend = (m: PushMessage) => {
    void run(`test:${m.id}`, async () => {
      const ok = await sendTestToMe(m.id);
      setNotice(ok
        ? 'Sent to your phone only — nobody else gets it. It should arrive in a few seconds.'
        : 'This account has no phone signed in to Livil with notifications on, so there is nowhere to send a preview.');
    });
  };

  return (
    <>
      <header className="page__head">
        <div>
          <p className="kicker">Mood nudges, repost digests and new music</p>
          <h1 className="display page__title">Notifications</h1>
        </div>
      </header>

      {error && (
        <div className="empty panel">
          <p className="empty__title">Could not load notifications</p>
          <p className="hint">{error}</p>
        </div>
      )}
      {notice && <p className="hint" role="status">{notice}</p>}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">When they go out</h2>
          <span className="hint">India time. Each one is skipped when there is nothing to say.</span>
        </div>
        {slots === null ? <div className="skeleton skeleton--rows" /> : (
          <table className="table">
            <tbody>
              {slots.map(s => (
                <tr key={s.slot}>
                  <td className="num">{slotWhen(s)}</td>
                  <td>
                    <span className="table__title">{SLOT_LABELS[s.slot]}</span>
                    {s.pool !== 'digest' && !s.enabled && (
                      <div className="hint">
                        Start only once the app release with the “{NEW_MUSIC_SLOTS.has(s.slot) ? 'New music' : 'Mood reminders'}” switch is out (App Store rule).
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="onoff" data-on={s.enabled || undefined}>
                      {s.enabled ? onLabel(s) : 'Not sending'}
                    </span>
                  </td>
                  <td className="num">
                    <Button
                      size="sm"
                      variant={s.enabled ? 'secondary' : 'primary'}
                      busy={busy === `slot:${s.slot}`}
                      onClick={() => toggleSlot(s)}
                    >
                      {s.enabled ? 'Stop sending' : 'Start sending'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">What they say</h2>
          <span className="hint">{poolInfo.hint} Takes turns through the lines that are In rotation, one per day. Preview on my phone sends one line to your phone only.</span>
        </div>
        <div className="chiprow">
          {POOLS.map(p => (
            <button
              key={p.key}
              type="button"
              className="chip"
              data-active={p.key === pool || undefined}
              onClick={() => {
                setPool(p.key);
                setDraft(null);
                setDraftError(null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {messages === null ? <div className="skeleton skeleton--rows" /> : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th className="num">Sent</th>
                  <th className="num">Opened</th>
                  <th className="num">Came back</th>
                </tr>
              </thead>
              <tbody>
                {inPool.map(m => (
                  <tr key={m.id} data-off={!m.active || undefined}>
                    <td className="num">{m.position}</td>
                    <td>
                      <span className="table__title">{m.title}</span>
                      <div className="hint">{m.body}</div>
                      <div className="rowactions">
                        <Button size="sm" variant="ghost" onClick={() => { setDraft({ id: m.id, title: m.title, body: m.body }); setDraftError(null); }}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" busy={busy === `test:${m.id}`} onClick={() => testSend(m)}>
                          Preview on my phone
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          busy={busy === `active:${m.id}`}
                          onClick={() => { void run(`active:${m.id}`, () => setMessageActive(m.id, !m.active)); }}
                        >
                          {m.active ? 'Skip this line' : 'Use this line'}
                        </Button>
                      </div>
                    </td>
                    <td>
                      <span className="onoff" data-on={m.active || undefined}>
                        {m.active ? 'In rotation' : 'Skipped'}
                      </span>
                    </td>
                    <td className="num">{m.delivered}</td>
                    <td className="num">{m.opened} <span className="hint">{percent(m.opened, m.delivered)}</span></td>
                    <td className="num">{m.cameBack} <span className="hint">{percent(m.cameBack, m.delivered)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!draft && (
          <Button size="sm" variant="secondary" onClick={() => { setDraft({ id: null, title: '', body: '' }); setDraftError(null); }}>
            + Add a line
          </Button>
        )}
        <p className="hint">
          Sent and percentages cover the last {STATS_DAYS} days. Opened = tapped the notification (counted from
          the app release that reports taps). Came back = had Livil open within an hour (every app version).
        </p>
      </section>

      {draft && (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{draft.id ? 'Edit line' : 'New line'}</h2>
            <span className="hint">{poolInfo.label}</span>
          </div>
          <TextField
            label={`Bold line · ${draft.title.length} / ${TITLE_MAX}`}
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
          />
          <TextArea
            label={`Text · ${draft.body.length} / ${BODY_MAX}`}
            value={draft.body}
            maxLength={BODY_MAX}
            rows={3}
            onChange={e => setDraft({ ...draft, body: e.target.value })}
          />
          {FILL_INS[pool].length > 0 && (
            <p className="hint">
              Fill-ins: {FILL_INS[pool].map(f => `${f.token} → “${f.example}”`).join(' · ')}
            </p>
          )}
          {draftError && <p className="hint" role="alert">{draftError}</p>}
          <div className="panel">
            <p className="hint">Preview</p>
            <span className="table__title">{previewText(pool, draft.title) || 'Bold line'}</span>
            <div className="hint">{previewText(pool, draft.body) || 'Text'}</div>
          </div>
          <div className="chiprow">
            <Button size="sm" busy={busy === 'save'} onClick={saveDraft}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setDraftError(null); }}>Cancel</Button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Recent sends</h2>
          <span className="hint">A digest reads differently for everyone; one example is shown, never who got it.</span>
        </div>
        {sends === null ? <div className="skeleton skeleton--rows" /> : sends.length === 0 ? (
          <p className="hint">Nothing sent yet.</p>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Slot</th>
                  <th>Message</th>
                  <th className="num">Sent to</th>
                  <th className="num">Delivered</th>
                  <th className="num">Opened</th>
                  <th className="num">Came back</th>
                </tr>
              </thead>
              <tbody>
                {sends.map(s => (
                  <tr key={s.id}>
                    <td>{formatDate(s.createdAt)} <span className="hint">{new Date(s.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></td>
                    <td>{SLOT_LABELS[s.slot]}</td>
                    <td>
                      <span className="table__title">{s.position ? `#${s.position} ` : ''}{s.exampleTitle ?? '—'}</span>
                      {s.exampleBody && <div className="hint">{s.exampleBody}</div>}
                    </td>
                    <td className="num">{s.recipients}</td>
                    <td className="num">{s.delivered}</td>
                    <td className="num">{s.opened}</td>
                    <td className="num">{s.cameBack}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmSlot && (
        <ConfirmDialog
          title={
            confirmSlot.slot === 'new_drop'
              ? 'Start sending new-song alerts?'
              : confirmSlot.slot === 'originals_weekly'
                ? `Start sending Fresh on Livil every Sunday at ${istTime(confirmSlot.sendAtIst)}?`
                : `Start sending the ${SLOT_LABELS[confirmSlot.slot].toLowerCase()} every day at ${istTime(confirmSlot.sendAtIst)}?`
          }
          body={
            confirmSlot.slot === 'new_drop'
              ? 'From now on, a few minutes after someone uploads, their friends and the people who star them get one — at most one a day each. Only do this once the app release with the “New music” switch is out.'
              : confirmSlot.slot === 'originals_weekly'
                ? 'Every Sunday, everyone with notifications on who has new Livil songs they have not seen gets this. Only do this once the app release with the “New music” switch is out.'
                : confirmSlot.pool === 'digest'
                  ? 'From its next time, everyone with notifications on who has new reposts to see gets this, every day.'
                  : 'From its next time, everyone with notifications on who has not posted that day gets this, every day. Only do this once the app release with the “Mood reminders” switch is out.'
          }
          confirmLabel="Start sending"
          busy={busy === `slot:${confirmSlot.slot}`}
          onConfirm={() => {
            const s = confirmSlot;
            void run(`slot:${s.slot}`, async () => {
              await setSlotEnabled(s.slot, true);
              setConfirmSlot(null);
            }, `${SLOT_LABELS[s.slot]} (${slotWhen(s)}): ${onLabel(s).toLowerCase()} from now on.`);
          }}
          onCancel={() => setConfirmSlot(null)}
        />
      )}
    </>
  );
}
