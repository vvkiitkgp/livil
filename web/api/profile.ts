/**
 * The public profile link — `https://livil-music.com/@<username>`.
 *
 * Design: kb/architecture/post-sharing.md §10 ("Profile links").
 *
 * ── THIS PAGE IS A SIGNPOST, NOT A PROFILE ─────────────────────────────────
 * The owner's call (2026-10-09): a profile is only ever SEEN in the app. This page shows
 * who the link belongs to — name, handle, photo — and one way forward: open Livil, or get
 * it. No bio, no uploads, no counts, no player. It exists for three readers:
 *
 *   * chat crawlers (WhatsApp, iMessage, Instagram DMs), which turn the link into a card
 *     saying whose it is — and which DO NOT RUN JAVASCRIPT, so everything they read is
 *     rendered here, server-side, exactly like the post page (`share.ts`);
 *   * search engines, so an ARTIST can be found by name. Only people who have published
 *     music are indexable; everyone else's page is `noindex`, so a listener's link still
 *     works for sharing without making them findable on Google;
 *   * a person who tapped the link somewhere the operating system did not hand it to the
 *     app — Instagram's in-app browser ignores App Links / Universal Links, so a bio link
 *     always lands here first. That is why the button exists at all.
 *
 * When Livil IS installed and the link is opened from a normal browser or chat app, the
 * OS opens the app directly (AndroidManifest.xml intent-filter + apple-app-site-association)
 * and this page is never seen.
 *
 * ── SEARCH ENGINES SEE EXACTLY WHAT PEOPLE SEE ─────────────────────────────
 * The visible page and the indexed page are the same HTML. Serving crawlers a richer page
 * than visitors is cloaking, which search engines penalise — so "only show the name" is
 * also what the index gets, and that is enough to rank for "<name> livil".
 *
 * ── SELF-CONTAINED ON PURPOSE ──────────────────────────────────────────────
 * No imports beyond types, the same as `share.ts`: `web/` is an ES-module package and
 * Vercel runs each file in `api/` as its own function, so a relative import is one more
 * thing that resolves locally and not in production. The handful of helpers duplicated
 * from `share.ts` (escapeHtml, safeUrl, the store constants) are small and tested here.
 *
 * ── UNTRUSTED OUTPUT ───────────────────────────────────────────────────────
 * Display names are user-authored. Every value is escaped on the way into the HTML, and
 * the JSON-LD block has its `<` escaped so a name containing `</script>` cannot break out.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

function supabaseConfig(): { url: string; key: string } {
  return {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
    key: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
  };
}

const ORIGIN = 'https://livil-music.com';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.livil';
const APP_STORE = 'https://apps.apple.com/app/id6809119164';
const IS_APPLE_JS = "/iPhone|iPad|iPod/.test(navigator.userAgent||'')";

/**
 * The preview image: the Livil mark and "Follow me on Livil". The same for everyone on
 * purpose — the owner asked for the Livil logo on the card, and the card's TITLE is what
 * names the person. Lives in `docs/`, copied to the apex by `scripts/copy-marketing.mjs`.
 */
const FOLLOW_OG_IMAGE = `${ORIGIN}/og-follow.png`;

/**
 * A handle as it can appear in a URL. Looser than the claim rule (`^[a-z0-9_]{3,30}$`)
 * because a few accounts predate it; the database does the exact, case-insensitive
 * match. Anything outside this never reaches PostgREST.
 */
const HANDLE_RE = /^[a-z0-9_-]{1,40}$/i;

type ProfileCard = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_artist: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe inside `<script type="application/ld+json">` — see `embedJson` in share.ts. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Only an https URL becomes an attribute. A stored URL is data. */
function safeUrl(value: string | null): string | null {
  if (!value) { return null; }
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Where a profile link opens inside the app. Mirrors `profileDeepLink` in src/constants/links.ts. */
function deepLinkFor(username: string): string {
  return `livil://profile/${encodeURIComponent(username)}`;
}

async function fetchProfileCard(username: string): Promise<ProfileCard | null> {
  const { url, key } = supabaseConfig();
  if (!url || !key) {
    // Said in the function log, never on the page. See the same branch in share.ts.
    console.error(
      '[profile] Supabase is not configured for this deployment. Set SUPABASE_URL and ' +
        'SUPABASE_ANON_KEY (or the VITE_ equivalents) in the Vercel project settings.',
    );
    throw new Error('not configured');
  }

  const res = await fetch(`${url}/rest/v1/rpc/public_profile_card`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_username: username }),
  });

  if (!res.ok) {
    // Most likely the migration is not applied, or EXECUTE is not granted to `anon`.
    // Thrown, not "not found": a 404 would tell a search engine the artist is gone.
    console.error(`[profile] public_profile_card failed: HTTP ${res.status} ${res.statusText}`);
    throw new Error(`rpc ${res.status}`);
  }
  const rows = (await res.json()) as ProfileCard[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0]! : null;
}

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0A0A0F;color:#fff;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  min-height:100dvh;display:flex;flex-direction:column;align-items:center}
a{color:inherit}
.bg{position:fixed;inset:0;z-index:0;
  background:radial-gradient(120% 80% at 50% -10%,#4C1D95 0%,#0A0A0F 60%)}
.wrap{position:relative;z-index:1;width:100%;max-width:480px;padding:24px 20px 40px;
  display:flex;flex-direction:column;align-items:center;flex:1}
.brand{display:flex;align-items:center;gap:9px;align-self:flex-start;margin-bottom:48px;
  font-weight:800;letter-spacing:.5px;font-size:15px;text-decoration:none}
.brand img{width:28px;height:28px;display:block;border-radius:7px}
.avatar{width:112px;height:112px;border-radius:50%;object-fit:cover;display:block;
  background:#12121C;box-shadow:0 0 0 3px rgba(168,85,247,.55),0 0 36px rgba(139,61,255,.35)}
.avatar--initial{display:flex;align-items:center;justify-content:center;font-size:44px;
  font-weight:800;color:#fff;background:linear-gradient(160deg,#6D28D9,#A855F7)}
.name{font-size:24px;font-weight:800;margin:22px 0 0;text-align:center;line-height:1.25;
  overflow-wrap:anywhere}
.handle{font-size:15px;color:#C9B6FF;font-weight:600;margin:4px 0 0;text-align:center;
  overflow-wrap:anywhere}
.lede{font-size:14.5px;color:#9a9aa8;margin:18px 0 0;text-align:center;line-height:1.55;
  max-width:320px}
.cta{margin-top:30px;width:100%;padding:15px;border-radius:14px;border:1.5px solid #8B3DFF;
  background:rgba(139,61,255,.12);color:#A855F7;font-size:15px;font-weight:700;
  text-align:center;text-decoration:none;display:block;cursor:pointer}
.foot{margin-top:14px;font-size:12.5px;color:#6e6e7c;text-align:center;line-height:1.6}
.foot a{color:#C9B6FF}
.gone{text-align:center;padding:40px 0 4px}
.gone h1{font-size:20px;margin:0 0 8px}
.gone p{color:#9a9aa8;font-size:14.5px;margin:0;line-height:1.6}
`.trim();

/**
 * The open-in-app handoff: try the app's own scheme, and if we are still on this page a
 * moment later (nothing took the link) go to the store for this device. The visibility
 * check is what tells "no app" apart from "the app opened and backgrounded us" — without
 * it everyone who DOES have the app would also be sent to the store on the way back.
 * Same logic as the post page; it is the established behaviour for links on this site.
 *
 * Never fired on load: an automatic jump to an unknown scheme shows Safari's "address is
 * invalid" dialog to everyone without the app, and Chrome blocks it without a tap anyway.
 */
function handoffScript(deepLink: string | null): string {
  const swap = `var store=${IS_APPLE_JS}?${JSON.stringify(APP_STORE)}:${JSON.stringify(PLAY_STORE)};
  Array.prototype.forEach.call(document.querySelectorAll('[data-store]'),function(a){a.href=store;});`;
  if (!deepLink) { return `(function(){\n  ${swap}\n})();`; }
  return `
(function(){
  ${swap}
  function handoff(e){
    e.preventDefault();
    var t0=Date.now();
    var timer=setTimeout(function(){
      if(document.visibilityState==='visible'&&Date.now()-t0<2500){window.location.href=store;}
    },1200);
    document.addEventListener('visibilitychange',function once(){
      clearTimeout(timer);document.removeEventListener('visibilitychange',once);
    });
    window.location.href=${JSON.stringify(deepLink)};
  }
  var o=document.getElementById('open'); if(o){o.addEventListener('click',handoff);}
})();`.trim();
}

function page(opts: { title: string; head: string; body: string; script: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(opts.title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${opts.head}
<style>${CSS}</style>
</head>
<body>
<div class="bg"></div>
<div class="wrap">
<a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28">LIVIL</a>
${opts.body}
</div>
<script>${opts.script}</script>
</body>
</html>`;
}

const STORE_FOOT = `<p class="foot">
  Don't have the app? Get Livil free on <a href="${APP_STORE}">the App Store</a> or <a href="${PLAY_STORE}">Google Play</a>.
</p>`;

/**
 * An unknown handle, an unconfirmed account, or a username not chosen yet. A real 404 —
 * unlike the post page's 200 — because a search engine must drop a profile that no longer
 * exists rather than keep listing it. People still get a page with a way forward.
 */
function renderNotFound(): string {
  return page({
    title: 'Livil',
    head: [
      '<meta name="robots" content="noindex">',
      '<meta property="og:title" content="Livil">',
      '<meta property="og:description" content="Upload your music, listen together, and see what your friends are playing.">',
      `<meta property="og:image" content="${ORIGIN}/og.png">`,
      '<meta property="og:type" content="website">',
      '<meta name="apple-itunes-app" content="app-id=6809119164">',
    ].join('\n'),
    body: `<div class="gone">
<h1>This profile isn't available</h1>
<p>The link may be incomplete, or the account may no longer exist.</p>
</div>
<a class="cta" data-store href="${PLAY_STORE}">Get Livil</a>
<p class="foot">Free on <a href="${APP_STORE}">the App Store</a> and <a href="${PLAY_STORE}">Google Play</a>.</p>`,
    script: handoffScript(null),
  });
}

/** Supabase unreachable. Still a page; a 503 tells a search engine to come back later
 *  rather than drop the profile. */
function renderUnavailable(): string {
  return page({
    title: 'Livil',
    head: [
      '<meta name="robots" content="noindex">',
      '<meta property="og:title" content="Livil">',
      `<meta property="og:image" content="${ORIGIN}/og.png">`,
    ].join('\n'),
    body: `<div class="gone">
<h1>Livil is taking a breather</h1>
<p>Try this link again in a moment.</p>
</div>
<a class="cta" data-store href="${PLAY_STORE}">Get Livil</a>`,
    script: handoffScript(null),
  });
}

function renderProfile(card: ProfileCard): string {
  const handle = card.username;
  const displayName = (card.display_name || '').trim();
  const name = displayName || handle;
  const canonical = `${ORIGIN}/@${encodeURIComponent(handle)}`;
  const avatar = safeUrl(card.avatar_url);
  const deepLink = deepLinkFor(handle);

  // "Riya (@riya) on Livil" — the name a person would search for, then the handle that
  // makes it unambiguous. When there is no display name the handle is the name.
  const heading = displayName ? `${displayName} (@${handle}) on Livil` : `@${handle} on Livil`;
  // What a search result shows under the title. Third person: the reader is a stranger.
  const description = card.is_artist
    ? `Listen to ${name} on Livil — the social music app. Follow @${handle} to hear their music and listen together in real time.`
    : `Follow ${name} (@${handle}) on Livil — the social music app for listening together in real time.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: canonical,
    mainEntity: {
      '@type': 'Person',
      name,
      alternateName: `@${handle}`,
      identifier: handle,
      url: canonical,
      ...(avatar ? { image: avatar } : {}),
    },
  };

  const head = [
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    // Listeners did not sign up to be findable by name. Their link works; Google skips it.
    card.is_artist ? '' : '<meta name="robots" content="noindex">',
    // Safari's "OPEN in the App Store" banner. `app-argument` is the URL the app receives
    // when it is installed and the banner's OPEN is tapped.
    `<meta name="apple-itunes-app" content="app-id=6809119164, app-argument=${escapeHtml(canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(heading)}">`,
    // First person, as the owner asked: the link is overwhelmingly shared by its owner,
    // in their bio or to their friends.
    '<meta property="og:description" content="Follow me on Livil">',
    `<meta property="og:image" content="${FOLLOW_OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Livil — Follow me on Livil">',
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    '<meta property="og:site_name" content="Livil">',
    '<meta property="og:type" content="profile">',
    `<meta property="profile:username" content="${escapeHtml(handle)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(heading)}">`,
    '<meta name="twitter:description" content="Follow me on Livil">',
    `<meta name="twitter:image" content="${FOLLOW_OG_IMAGE}">`,
    `<script type="application/ld+json">${embedJson(jsonLd)}</script>`,
  ].filter(Boolean).join('\n');

  const avatarEl = avatar
    ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" width="112" height="112">`
    : `<div class="avatar avatar--initial" aria-hidden="true">${escapeHtml((name[0] ?? 'L').toUpperCase())}</div>`;

  const body = `${avatarEl}
<h1 class="name">${escapeHtml(name)}</h1>
${displayName ? `<p class="handle">@${escapeHtml(handle)}</p>` : ''}
<p class="lede">${escapeHtml(name)} is on Livil. Open the app to see their profile${card.is_artist ? ' and listen to their music' : ''}.</p>
<a class="cta" id="open" href="${escapeHtml(deepLink)}">Follow on Livil</a>
${STORE_FOOT}`;

  return page({ title: heading, head, body, script: handoffScript(deepLink) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // `u` comes from the vercel.json rewrite (/@:username). Falling back to the path keeps
  // the function working if it is ever hit directly.
  const fromQuery = typeof req.query.u === 'string' ? req.query.u : null;
  const fromPath = (req.url ?? '').split('?')[0]!.split('/').filter(Boolean).pop() ?? '';
  let raw = fromQuery ?? fromPath;
  try { raw = decodeURIComponent(raw); } catch { /* keep as-is; HANDLE_RE rejects junk */ }
  raw = raw.replace(/^@/, '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!HANDLE_RE.test(raw)) {
    // Cannot be a handle — no database round trip, which also keeps a scanner hammering
    // /@<junk> off Postgres entirely.
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(404).send(renderNotFound());
    return;
  }

  // Handles are stored lowercase. One URL per person, so a search engine does not split
  // an artist across /@Riya and /@riya, and a bio link typed with capitals still works.
  if (raw !== raw.toLowerCase()) {
    res.setHeader('Location', `/@${encodeURIComponent(raw.toLowerCase())}`);
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.status(301).send('');
    return;
  }

  try {
    const card = await fetchProfileCard(raw);
    if (!card) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      res.status(404).send(renderNotFound());
      return;
    }

    // Five minutes at the edge, a day of stale-while-revalidate — the same budget as the
    // post page. A changed photo or name shows up within minutes.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.status(200).send(renderProfile(card));
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '120');
    res.status(503).send(renderUnavailable());
  }
}
