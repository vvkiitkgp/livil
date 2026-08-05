// ============================================================================
// waitlist-join — logic module
// ============================================================================
//
// The PUBLIC half of the waitlist. Called with no JWT, straight from the marketing
// form, and it does two things: record the signup, and send the invite immediately.
//
// ── WHY THIS IS PUBLIC, AND WHAT THAT COSTS ─────────────────────────────────
//
// `verify_jwt` is FALSE here, unlike every other function in this project. It has to
// be: the caller is an anonymous visitor who has no account and by definition cannot
// have one yet. That makes this the only unauthenticated endpoint we operate, and the
// only one that sends mail. Both facts deserve to stay uncomfortable.
//
// THE ABUSE MODEL. Anyone can POST an arbitrary address here and cause real mail to
// leave `mail.livil-music.com` — the SAME verified domain that carries password
// resets and email confirmations. Spam complaints against it do not merely spoil
// marketing; they can cost us auth email, which locks existing users out of their
// own accounts. That is the actual stake, and it is why the mitigations below are
// not optional decoration:
//
//   1. FIXED CONTENT. Subject and body are composed here from constants. The caller
//      supplies only a destination address, so this cannot be turned into a relay for
//      arbitrary text — the worst it can emit is a genuine Livil invite.
//   2. ONE INVITE PER ADDRESS, EVER. `waitlist_request` is INSERT ... ON CONFLICT DO
//      NOTHING and returns NULL for an address already on the list. A NULL means we
//      send nothing. So an attacker cannot repeatedly mail the same victim, which is
//      what turns unsolicited mail into harassment.
//   3. PER-IP RATE LIMIT. Caps how fast one source can enumerate fresh addresses.
//
// What none of that prevents: someone submitting a stranger's address once. That is
// inherent to any public signup form and was already true before this function
// existed — the difference is that it now produces an email rather than a silent row.
// If abuse ever shows up, the next step is double opt-in (a confirm link before the
// invite), NOT a captcha.
//
// ── NO service_role ─────────────────────────────────────────────────────────
// ADR-0008 §4. This function holds the Resend key and talks to Postgres with the same
// anon key the browser uses. The two things anon cannot do — insert-and-report-newness,
// and record a send — are the SECURITY DEFINER RPCs from migration 20260806000000,
// each doing exactly one thing and neither able to read the list.
//
// SECRETS (custom): RESEND_API_KEY.
// Platform-injected: SUPABASE_URL, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FROM = 'Livil <noreply@mail.livil-music.com>';
const STUDIO_URL = 'https://livil-music.com/studio';
const WELCOME_URL = 'https://livil-music.com/welcome.html';

/**
 * Kept deliberately thin, and deliberately a near-copy of the one in `waitlist-invite`.
 *
 * The two senders are separate deployments and cannot share a module without changing
 * how both are built, so this IS duplicated copy — normally a smell. It is tolerable
 * only because the email carries no instructions: every actual step lives on
 * WELCOME_URL, which is a single static file. If this email ever grows real content,
 * extract a shared module rather than letting the two drift.
 */
function composeInvite() {
  const text = [
    "You're in.",
    '',
    'Livil is a social music platform — a place to listen with people, not beside them.',
    'You asked for early access, and it is ready.',
    '',
    'Everything you need is on one page — four short steps, about two minutes:',
    '',
    `  ${WELCOME_URL}`,
    '',
    'It walks you through joining the testers group, accepting the Play invite, and',
    'installing the app — including what the confusing bits look like, so you know',
    'nothing has gone wrong.',
    '',
    `If you make music, the creator studio works in a browser right now: ${STUDIO_URL}`,
    '',
    'Thanks for waiting.',
    'Vamsi — Livil',
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;color:#0A0A0F;line-height:1.6">
  <h1 style="font-size:24px;margin:0 0 16px">You're in.</h1>
  <p style="margin:0 0 16px">Livil is a social music platform — a place to listen with people, not beside them. You asked for early access, and it's ready.</p>
  <p style="margin:0 0 20px">Everything you need is on one page — four short steps, about two minutes.</p>
  <p style="margin:0 0 24px">
    <a href="${WELCOME_URL}" style="display:inline-block;padding:12px 24px;border-radius:100px;background:#7C3AED;color:#fff;text-decoration:none;font-weight:600">Get started</a>
  </p>
  <p style="margin:0 0 16px;font-size:14px;color:#555">It walks you through joining the testers group, accepting the Play invite and installing the app — including what the confusing bits look like, so you know nothing has gone wrong.</p>
  <p style="margin:0 0 16px">If you make music, the <a href="${STUDIO_URL}" style="color:#8B3DFF">creator studio</a> works in a browser right now.</p>
  <p style="margin:0">Thanks for waiting.<br/>Vamsi — Livil</p>
</div>`.trim();

  return { subject: "You're in — Livil early access", text, html };
}

const PROD_ORIGIN = 'https://livil-music.com';
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = origin === PROD_ORIGIN || LOCALHOST_RE.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : PROD_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const json = (status: number, body: unknown, req: Request) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(req) },
  });

export function isSendableEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length < 3 || email.length > 254) return false;
  if (/[\s<>",;\r\n]/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/**
 * Per-IP rate limit, in memory.
 *
 * Honest about what this is: edge functions are horizontally scaled and recycled, so
 * this map is per-instance and evaporates on cold start. It is a speed bump against
 * casual scripted abuse, NOT a security control — a determined attacker with a spread
 * of source addresses walks past it. It is here because it costs nothing and buys time
 * to notice, and mitigation (2) — one invite per address, ever — is the guarantee that
 * actually bounds the damage.
 */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Bound the map so a long-lived instance cannot grow it without limit.
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, req);

  let payload: { email?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_json' }, req);
  }
  if (!isSendableEmail(payload.email)) return json(400, { error: 'bad_email' }, req);
  const email = payload.email.trim().toLowerCase();

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    'unknown';
  if (rateLimited(ip, Date.now())) return json(429, { error: 'rate_limited' }, req);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json(500, { error: 'missing_platform_env' }, req);

  const db = createClient(url, anonKey, { auth: { persistSession: false } });

  // 1. Record. `id` is NULL when the address was already on the list.
  const { data: id, error: reqErr } = await db.rpc('waitlist_request', { p_email: email });
  if (reqErr) return json(500, { error: 'could_not_record' }, req);

  // 2. Already on the list — succeed WITHOUT sending, and without saying so.
  //    "You're on the list" and "you were already on the list" are the same outcome to
  //    the visitor, and distinguishing them would leak membership. This preserves the
  //    anti-enumeration property the original joinWaitlist was written to have.
  if (!id) return json(200, { ok: true }, req);

  // 3. Send.
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    await db.rpc('waitlist_mark_emailed', { p_id: id, p_error: 'RESEND_API_KEY is not set' });
    // The signup itself succeeded, so the visitor is told the truth about THEIR action.
    // The failure is recorded for the dashboard, where it is actionable.
    return json(200, { ok: true }, req);
  }

  const { subject, text, html } = composeInvite();

  let sendError: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject, text, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      sendError = `resend_${res.status}: ${detail.slice(0, 300)}`;
    }
  } catch (e) {
    sendError = `resend_unreachable: ${e instanceof Error ? e.message : e}`;
  }

  // 4. Record the outcome. A failure here leaves the row visibly unsent in /ops with the
  //    reason attached, so an operator can retry it by hand — which is exactly why the
  //    manual Send button stays.
  await db.rpc('waitlist_mark_emailed', { p_id: id, p_error: sendError });

  // The visitor always sees success: they DID join the waitlist. Whether our mail
  // provider co-operated is our problem to fix, not a failure to report to them.
  return json(200, { ok: true }, req);
}
