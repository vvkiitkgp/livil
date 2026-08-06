// ============================================================================
// welcome-email — logic module
// ============================================================================
//
// Sends one welcome email per account, ever. Both clients invoke it on their first
// authenticated session; the database decides whether that call is the one that sends.
//
// The entrypoint `index.ts` imports `handler` from here and calls Deno.serve on it, so
// the deployed function ALWAYS serves while `index.test.ts` imports the pure helpers
// without binding a port. Same shape as send-push and the two waitlist functions.
//
// ── THE CONTRACT: THIS FUNCTION TAKES NO INPUT ──────────────────────────────
//
// No body. No query string. Not the address, not the name, not the copy. Everything it
// needs comes from the caller's JWT and the database, and the message itself is
// composed from constants below.
//
// That is the entire security model, and it is deliberately stronger than validating a
// body would be. The worst thing any authenticated caller can achieve — including a
// caller running a patched client — is causing their OWN welcome email to be sent, at
// most once, to the address they already proved they control. There is no recipient
// parameter to forge (ADR-0008 decision 1) and no text parameter to turn this into a
// relay for arbitrary content (mitigation 1 of the waitlist abuse model).
//
// ── WHY THE ADDRESS MUST BE CONFIRMED ───────────────────────────────────────
//
// `email_confirmed_at` is checked before anything else. Supabase issues a session
// before confirmation in some configurations, and mailing an unconfirmed address is how
// `mail.livil-music.com` — the domain that also carries password resets and
// confirmations — collects spam complaints. Losing that domain's reputation locks
// existing users out of their own accounts. Not worth one greeting.
//
// ── WHY NO service_role ─────────────────────────────────────────────────────
//
// ADR-0008 §4. This function holds the Resend key and nothing else. It talks to
// Postgres with the anon key plus the caller's own Authorization header, so RLS applies
// exactly as it does in the browser. The two things the caller cannot do for themselves
// — claim the send atomically, and record the outcome — are the SECURITY DEFINER RPCs
// from migration 20260807000000, each acting on `auth.uid()` and neither taking a user
// id.
//
// SECRETS (custom): RESEND_API_KEY.
// Platform-injected: SUPABASE_URL, SUPABASE_ANON_KEY.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FROM = 'Livil <noreply@mail.livil-music.com>';

/**
 * The `user_xxxxxxxx` handle an OAuth account holds before it claims a real username.
 * Addressing someone by it is worse than not addressing them by name at all.
 */
const PLACEHOLDER_HANDLE = /^user_[0-9a-f]{8}$/i;

/**
 * The two personal details this email uses: who they are, and what they are called here.
 *
 * Both are user-supplied and arrive unescaped, so this is the ONE place that decides what
 * may appear inside an HTML email. Nothing else in the message varies, which means
 * everything an attacker could influence passes through this function.
 *
 * REJECT, DO NOT SANITISE. A display name containing `<` or `&` is far more likely to be
 * junk than someone's actual name, and dropping it costs a greeting rather than
 * correctness. Escaping would work too, but it puts the burden on every future edit to
 * the template to remember which values were escaped; refusing keeps the invariant local.
 *
 * The handle is checked against `^[a-z0-9_]{3,30}$` — the exact rule `claim_username`
 * enforces (20260628000000). Anything else is a legacy row or a placeholder, and is
 * dropped rather than printed.
 */
export function greetingParts(
  displayName: unknown,
  username: unknown,
): { name: string | null; handle: string | null } {
  let name: string | null = null;
  if (typeof displayName === 'string') {
    const trimmed = displayName.trim();
    // Length-capped because a 200-character "name" makes the subject line unreadable.
    const usable =
      trimmed.length > 0 &&
      trimmed.length <= 40 &&
      !/[<>&"'\r\n]/.test(trimmed) &&
      !PLACEHOLDER_HANDLE.test(trimmed);
    if (usable) name = trimmed;
  }

  let handle: string | null = null;
  if (typeof username === 'string') {
    const trimmed = username.trim().replace(/^@/, '');
    if (/^[a-z0-9_]{3,30}$/.test(trimmed) && !PLACEHOLDER_HANDLE.test(trimmed)) {
      handle = trimmed;
    }
  }

  return { name, handle };
}

/**
 * Fixed copy. The only variables are the name and the handle, which `greetingParts` has
 * already constrained to characters that cannot open a tag, an entity, or a mail header.
 *
 * NO LINKS, ANYWHERE — deliberate, and asserted by a test. This email explains what
 * Livil is to someone who has just finished signing up, so every link it could carry is
 * one they do not need: they are already in the app. It also means the message asks
 * nothing of the reader, which is the only kind of unsolicited mail worth sending. Adding
 * a URL later is a product decision, not a tidy-up — the test will stop you, on purpose.
 *
 * Deliberately a near-copy of the composers in the two waitlist functions rather than a
 * shared module: edge functions are separate deployments and cannot share code without
 * changing how all of them are built. Tolerable while each email is a handful of fixed
 * lines. If this grows real content, extract — do not let three copies drift.
 */
export function composeWelcome(
  name: string | null,
  handle: string | null,
): { subject: string; text: string; html: string } {
  const hey = name ? `Hey ${name},` : 'Hey there,';

  const text = [
    hey,
    '',
    'Thank you for signing up — welcome to Livil.',
    '',
    ...(handle
      ? [
          `You're @${handle} on Livil. That handle is yours for good — it is how`,
          'people find you, and it cannot be taken or changed later.',
          '',
        ]
      : []),
    'Livil is a social music platform. The short version: music is better with',
    'people, and most apps make you listen alone.',
    '',
    'What that means in practice:',
    '',
    '  Listening together, actually together. Start a Jam and everyone in the',
    '  room hears the same second of the same song. You can talk over it while',
    '  it plays.',
    '',
    '  A feed of people, not an algorithm. You see what the people you follow',
    '  are playing, posting and reposting.',
    '',
    '  Your own music, if you make it. Upload a track or a video, credit the',
    '  people who worked on it, and it lands on your profile.',
    '',
    '  Playlists you build with other people, and chat that sits right next to',
    '  whatever you are both hearing.',
    '',
    'That is where the name comes from. Live, Vibe, Link.',
    '',
    'Reply to this email if something is broken or confusing. It reaches a person.',
    '',
    'Vamsi — Livil',
  ].join('\n');

  const handleHtml = handle
    ? `  <p style="margin:0 0 16px">You're <strong>@${handle}</strong> on Livil. That handle is yours for good — it's how people find you, and it can't be taken or changed later.</p>\n`
    : '';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;color:#0A0A0F;line-height:1.6">
  <h1 style="font-size:24px;margin:0 0 16px">Thanks for signing up.</h1>
  <p style="margin:0 0 16px">${hey} welcome to Livil — your account is ready.</p>
${handleHtml}  <p style="margin:0 0 20px">Livil is a social music platform. The short version: music is better with people, and most apps make you listen alone.</p>
  <p style="margin:0 0 10px;font-weight:600">What that means in practice</p>
  <ul style="margin:0 0 20px;padding-left:20px">
    <li style="margin:0 0 10px"><strong>Listening together, actually together.</strong> Start a Jam and everyone in the room hears the same second of the same song. You can talk over it while it plays.</li>
    <li style="margin:0 0 10px"><strong>A feed of people, not an algorithm.</strong> You see what the people you follow are playing, posting and reposting.</li>
    <li style="margin:0 0 10px"><strong>Your own music, if you make it.</strong> Upload a track or a video, credit the people who worked on it, and it lands on your profile.</li>
    <li style="margin:0 0 10px"><strong>Playlists you build with other people</strong>, and chat that sits right next to whatever you're both hearing.</li>
  </ul>
  <p style="margin:0 0 20px;color:#4C1D95;font-weight:600">That's where the name comes from. Live, Vibe, Link.</p>
  <p style="margin:0 0 16px;font-size:14px;color:#555">Reply to this email if something is broken or confusing. It reaches a person.</p>
  <p style="margin:0">Vamsi — Livil</p>
</div>`.trim();

  const subject = name
    ? `Welcome to Livil, ${name}`
    : handle
      ? `Welcome to Livil, @${handle}`
      : 'Welcome to Livil';

  return { subject, text, html };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // 1. AUTHENTICATION. The caller is the recipient; there is no other way to name one.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'missing_bearer' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json(500, { error: 'missing_platform_env' });

  // Anon key + the caller's header: every read below is subject to the same RLS the
  // browser gets, and the two RPCs act on auth.uid().
  const db = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: authErr } = await db.auth.getUser();
  const user = userData?.user;
  if (authErr || !user) return json(401, { error: 'invalid_token' });

  // 2. Never mail an address the account has not proven it controls. See the header.
  if (!user.email || !user.email_confirmed_at) {
    return json(200, { ok: true, sent: false, reason: 'email_not_confirmed' });
  }

  // 3. CLAIM. One caller wins; everyone else is told the truth and sends nothing.
  const { data: won, error: claimErr } = await db.rpc('welcome_email_claim');
  if (claimErr) return json(500, { error: 'claim_failed' });
  if (won !== true) return json(200, { ok: true, sent: false, reason: 'already_handled' });

  // 4. Name and handle. Read as the caller — `profiles_select_authenticated` covers it —
  //    and never taken from the request. A failed read costs the personalisation, not
  //    the email.
  const { data: profile } = await db
    .from('profiles')
    .select('display_name, username')
    .eq('id', user.id)
    .maybeSingle();
  const { name, handle } = greetingParts(profile?.display_name, profile?.username);

  // 5. SEND.
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    // Release the claim by recording the failure, so this is retried once the secret is
    // set rather than silently costing this account its only welcome.
    await db.rpc('welcome_email_mark', { p_error: 'RESEND_API_KEY is not set' });
    return json(500, { error: 'missing_resend_key' });
  }

  const { subject, text, html } = composeWelcome(name, handle);

  let sendError: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [user.email], subject, text, html }),
    });
    if (!res.ok) {
      sendError = `resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
    }
  } catch (e) {
    sendError = `fetch failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 6. Record the outcome either way. A failure leaves `sent_at` null, which is what
  //    makes the next launch (after the cooldown) retry it.
  await db.rpc('welcome_email_mark', { p_error: sendError });

  if (sendError) return json(502, { error: 'send_failed' });
  return json(200, { ok: true, sent: true });
}
