// ============================================================================
// waitlist-invite — logic module
// ============================================================================
//
// Sends one early-access invite to one waitlist address, on an operator's explicit
// click in the /ops dashboard. `index.ts` imports `handler` from here and calls
// Deno.serve on it, matching send-push: the deployed function always serves, and a
// test can import the pure helpers without binding a port.
//
// ── WHY THIS IS AN EDGE FUNCTION AND NOT A CLIENT CALL ──────────────────────
// The Resend API key. A key shipped in a browser bundle is a public key, and anyone
// holding it can send mail as mail.livil-music.com — a verified domain whose
// reputation also carries your auth emails (confirmations, password resets). Losing
// that domain to a spam complaint would lock users out of their accounts, not just
// spoil a marketing send. The key lives here and nowhere else.
//
// ── THE SECURITY MODEL ──────────────────────────────────────────────────────
//   1. AUTHENTICATION — a real user JWT, no anon. The caller is derived from the
//      token, never from the body.
//   2. AUTHORIZATION — the caller must be in `ops_users`, checked by calling
//      `is_ops()` AS THE CALLER. This is NOT redundant with the RLS policy on
//      `waitlist`: sending an email is not a row operation, so no policy governs it.
//      Without this check any signed-in user could invoke the function and use the
//      sending domain as an open relay.
//   3. CONTENT — the operator supplies only an address. Subject and body are composed
//      here from constants; nothing caller-supplied is interpolated into the mail.
//      That is deliberate — it means this endpoint cannot be used to send arbitrary
//      text to an arbitrary recipient even by a compromised ops account.
//
// ── NO service_role, ANYWHERE ───────────────────────────────────────────────
// ADR-0008 §4: nothing may hold a service_role key. Unlike send-push, this function
// needs no privileged read — `is_ops()` is granted to `authenticated` and runs as the
// caller, so the user's own JWT is the only credential in play. Do not "simplify" this
// by reaching for SUPABASE_SERVICE_ROLE_KEY; there is nothing here that needs it.
//
// SECRETS (custom): RESEND_API_KEY. (WAITLIST_GROUP_URL / WAITLIST_OPTIN_URL are no
// longer read — those links moved into docs/welcome.html.)
// Platform-injected: SUPABASE_URL, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Verified Resend sending domain. Auth emails already send from this subdomain. */
const FROM = 'Livil <noreply@mail.livil-music.com>';
const STUDIO_URL = 'https://livil-music.com/studio';

/**
 * The onboarding page (`docs/welcome.html`), which holds the group-join link, the Play
 * opt-in link, the install link, and the warnings about what each of those pages looks
 * like. The email links HERE rather than carrying those URLs itself, for two reasons:
 *
 *   1. Copy can change without redeploying this function — the page is a static file.
 *   2. An already-sent email cannot be corrected. Anything embedded in it is frozen at
 *      send time; anything behind this URL stays editable for the life of the invite.
 *
 * `.html` is explicit rather than relying on extensionless routing, which differs
 * between GitHub Pages (serving the apex today) and Vercel (the migration target).
 */
const WELCOME_URL = 'https://livil-music.com/welcome.html';

/**
 * CORS. Required because this function is called from a BROWSER (the /ops dashboard),
 * unlike send-push which is only ever called from React Native. A browser sends an
 * OPTIONS preflight first, and a handler that 405s every non-POST rejects it — the
 * fetch then fails as a CORS error before the real request is ever made.
 *
 * Origin is an allowlist rather than `*`: the studio in production, and Vite's dev
 * server. Echoing only known origins keeps the endpoint from being callable by an
 * arbitrary page, which matters because a successful call sends real mail.
 */
const PROD_ORIGIN = 'https://livil-music.com';
// Any localhost port, because Vite silently moves to 5174 when 5173 is taken and a
// hard-coded port would break the dashboard in dev with the same opaque CORS error.
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

function isAllowedOrigin(origin: string): boolean {
  return origin === PROD_ORIGIN || LOCALHOST_RE.test(origin);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : PROD_ORIGIN,
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

/**
 * Deliberately permissive. This address already sat in the database because a real
 * person typed it into the waitlist form; the job here is to reject obvious garbage
 * and header-injection attempts, not to adjudicate RFC 5322. Rejecting whitespace and
 * control characters is the part that matters — a newline in an address is how header
 * injection starts.
 */
export function isSendableEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length < 3 || email.length > 254) return false;
  if (/[\s<>",;\r\n]/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/**
 * The invite copy — deliberately short, with ONE call to action.
 *
 * The four setup steps live on the welcome page rather than in here. An email cannot be
 * edited once sent, and this flow crosses three products we do not control (Groups, Play,
 * the Store), each of which shows its own confusing interstitial. Putting the walkthrough
 * behind a URL means the wording can be fixed after the fact for people who have not
 * opened it yet — which, on a list this small, is most of them.
 */
export function composeInvite(welcomeUrl: string) {
  const text = [
    "You're in.",
    '',
    'Livil is a social music platform — a place to listen with people, not beside them.',
    'You asked for early access, and it is ready.',
    '',
    'Everything you need is on one page — four short steps, about two minutes:',
    '',
    `  ${welcomeUrl}`,
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
    <a href="${welcomeUrl}" style="display:inline-block;padding:12px 24px;border-radius:100px;background:#7C3AED;color:#fff;text-decoration:none;font-weight:600">Get started</a>
  </p>
  <p style="margin:0 0 16px;font-size:14px;color:#555">It walks you through joining the testers group, accepting the Play invite and installing the app — including what the confusing bits look like, so you know nothing has gone wrong.</p>
  <p style="margin:0 0 16px">If you make music, the <a href="${STUDIO_URL}" style="color:#8B3DFF">creator studio</a> works in a browser right now.</p>
  <p style="margin:0">Thanks for waiting.<br/>Vamsi — Livil</p>
</div>`.trim();

  return { subject: "You're in — Livil early access", text, html };
}

export async function handler(req: Request): Promise<Response> {
  // Preflight first — before the method check, which would otherwise 405 it.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, req);

  // 1. AUTHENTICATION — the caller is whoever the JWT says, not whoever the body says.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'missing_bearer' }, req);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json(500, { error: 'missing_platform_env' }, req);

  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: authErr } = await asUser.auth.getUser();
  if (authErr || !userData?.user?.id) return json(401, { error: 'invalid_token' }, req);

  // 2. AUTHORIZATION — ops only, evaluated by the database as the caller.
  const { data: isOps, error: opsErr } = await asUser.rpc('is_ops');
  if (opsErr) return json(500, { error: 'ops_check_failed' }, req);
  if (isOps !== true) return json(403, { error: 'not_ops' }, req);

  // 3. Input.
  let payload: { email?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_json' }, req);
  }
  if (!isSendableEmail(payload.email)) return json(400, { error: 'bad_email' }, req);
  const to = payload.email.trim();

  // 4. Config. Checked before sending, so a misconfiguration cannot produce a delivered
  // email containing dead links.
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json(500, { error: 'RESEND_API_KEY is not set' }, req);
  // Overridable for staging, but the constant is the normal case. The group and Play
  // opt-in URLs are NO LONGER secrets here — they live in docs/welcome.html, which is
  // version-controlled and editable without a redeploy. WAITLIST_GROUP_URL and
  // WAITLIST_OPTIN_URL are now unused and can be deleted from the project secrets.
  const welcomeUrl = Deno.env.get('WAITLIST_WELCOME_URL') || WELCOME_URL;

  // 5. Send.
  const { subject, text, html } = composeInvite(welcomeUrl);

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });
  } catch (e) {
    return json(502, { error: `resend_unreachable: ${e instanceof Error ? e.message : e}` }, req);
  }

  if (!res.ok) {
    // Resend's message is the actionable part (unverified domain, invalid key, blocked
    // recipient). Forwarded verbatim so it lands in `waitlist.email_error` and the
    // operator sees the real reason instead of a generic failure.
    const detail = await res.text().catch(() => '');
    return json(502, { error: `resend_${res.status}: ${detail.slice(0, 300)}` }, req);
  }

  const body = await res.json().catch(() => ({}));
  return json(200, { ok: true, id: (body as { id?: string })?.id ?? null }, req);
}
