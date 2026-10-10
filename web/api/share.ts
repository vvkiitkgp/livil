/**
 * The public share page — `https://livil-music.com/p/<postId>`.
 *
 * Design: kb/architecture/post-sharing.md.
 *
 * ── WHY THIS IS A SERVER FUNCTION AND NOT A ROUTE IN THE SPA ────────────────
 * WhatsApp, Instagram, iMessage, Slack and Twitter fetch a shared URL with a crawler
 * that DOES NOT RUN JAVASCRIPT. A React route can render the world's best player and
 * the crawler will still see the empty `<div id="root">` in index.html — so every
 * shared link, for every song, would preview identically. The Open Graph tags have to
 * be in the first byte of the response, which means they have to be rendered here.
 *
 * ── WHY THERE IS NO PLAYER ─────────────────────────────────────────────────
 * Listening needs a Livil account (owner's rule, 2026-10-09). This page is the
 * post's metadata — art, title, artist, caption, length, counts — and a way into the
 * app, and nothing else. It used to carry a full `<audio>`/`<video>` player, which let
 * anyone holding a link listen without ever signing in.
 *
 * Hiding a button would not have been enough: the media URL was in the markup twice
 * (the element's `src` and `og:audio`/`og:video`), and a URL in the page is a player
 * for anyone who opens view-source. So NO media URL is emitted anywhere — this file
 * never reads `track_audio_url` / `track_video_url` — and `shared_post_public` stops
 * returning them (20261022000000). Do not reintroduce either without reversing the
 * rule in kb/architecture/post-sharing.md first.
 *
 * ── WHY THERE IS NO CLIENT BUNDLE AT ALL ───────────────────────────────────
 * The design originally called for a second small Vite entry to hydrate this page.
 * It does not need one. Everything the page does — the open-in-app handoff and the
 * sign-in prompts — is a few lines inlined, and that makes the whole page ONE request
 * with nothing to hydrate. That also deletes a second Vite config, a second set of
 * asset paths and a cache-busting scheme, none of which were buying anything.
 * (The design doc records this change and the reasoning; do not "restore" the bundle
 * without a reason the doc does not already answer.)
 *
 * ── UNTRUSTED OUTPUT ───────────────────────────────────────────────────────
 * Track titles, captions, display names and usernames are user-authored. Every one of
 * them is escaped on the way into the HTML, and the embedded JSON has its `<` escaped
 * so a caption containing `</script>` cannot break out of the tag it sits in. There is
 * no route through this file that interpolates a raw value.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Read at call time, not at module load. Vercel injects environment variables before the
 * handler runs, but a module-level const also freezes the value into the bundle's first
 * evaluation — which makes the configuration untestable and makes a redeployed
 * environment variable depend on a cold start to take effect.
 */
function supabaseConfig(): { url: string; key: string } {
  return {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
    key: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
  };
}

const ORIGIN = 'https://livil-music.com';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.livil';
/** Mirrors APP_STORE_URL in web/src/auth/signIn.ts. iPhone only — there is no iPad build. */
const APP_STORE = 'https://apps.apple.com/app/id6809119164';
/**
 * These pages are edge-cached for every visitor, so the store choice cannot be made
 * server-side from the User-Agent (one iPhone visitor would fix the cached page for
 * everyone). The markup defaults to Play; this client-side check swaps to the App Store.
 */
const IS_APPLE_JS = "/iPhone|iPad|iPod/.test(navigator.userAgent||'')";
const FALLBACK_OG_IMAGE = `${ORIGIN}/og.png`;

/** Mirrors src/utils/shareLinks.ts. A malformed id must never reach PostgREST. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SharedPost = {
  post_id: string;
  caption: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
  clip_start_sec: number | null;
  clip_end_sec: number | null;
  author_username: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  /** Badge kinds the author currently holds. Empty array when they hold none. */
  author_badges: string[] | null;
  track_title: string;
  track_media_kind: 'audio' | 'video';
  // track_audio_url / track_video_url are deliberately NOT declared: the function still
  // has those columns (an unchanged shape is the safe change) but returns them NULL, and
  // this page must never emit a media URL. See "WHY THERE IS NO PLAYER" above.
  track_cover_art_url: string | null;
  track_thumbnail_url: string | null;
  track_duration_seconds: number | null;
};

/**
 * The badge marks, inlined.
 *
 * COPIES of `src/components/badgeShapes.ts`, `FirstHundredBadge` and `VerifiedBadge`,
 * not imports. This file is a cold-start-sensitive serverless function that deliberately
 * has no dependency on the React Native tree (or on anything else — see the header), and
 * the mobile components are `react-native-svg` elements, which do not render to a string.
 *
 * THE COPY IS GUARDED, NOT TRUSTED. `src/components/__tests__/shareBadgeParity.test.ts`
 * reads both files and fails if any path or colour here drifts from the mobile source.
 * Change the mark in one place and that test tells you about the other.
 */
const SEAL_PATH =
  'M50.00,2.50 L54.11,4.38 L57.50,8.68 L60.36,12.46 L63.68,13.54 L68.22,12.16 L73.49,10.68 ' +
  'L77.92,11.57 L80.14,15.51 L80.36,20.98 L80.45,25.72 L82.50,28.54 L86.98,30.10 L92.12,32.00 ' +
  'L95.18,35.32 L94.66,39.81 L91.62,44.36 L88.91,48.25 L88.50,50.00 L90.03,53.60 L93.29,57.86 ' +
  'L95.36,62.52 L94.05,66.53 L89.64,69.09 L84.50,70.62 L81.15,72.63 L80.27,76.45 L80.41,81.80 ' +
  'L79.34,86.79 L75.92,89.27 L70.85,88.75 L65.80,86.96 L61.90,86.62 L58.94,89.19 L55.91,93.60 ' +
  'L52.11,97.01 L50.00,97.50 L45.89,95.62 L42.50,91.32 L39.64,87.54 L36.32,86.46 L31.78,87.84 ' +
  'L26.51,89.32 L22.08,88.43 L19.86,84.49 L19.64,79.02 L19.55,74.28 L17.50,71.46 L13.02,69.90 ' +
  'L7.88,68.00 L4.82,64.68 L5.34,60.19 L8.38,55.64 L11.09,51.75 L11.50,50.00 L9.97,46.40 ' +
  'L6.71,42.14 L4.64,37.48 L5.95,33.47 L10.36,30.91 L15.50,29.38 L18.85,27.37 L19.73,23.55 ' +
  'L19.59,18.20 L20.66,13.21 L24.08,10.73 L29.15,11.25 L34.20,13.04 L38.10,13.38 L41.06,10.81 ' +
  'L44.09,6.40 L47.89,2.99 Z';

const STAR_PATH =
  'M50.00,19.00 L42.40,39.54 L20.52,40.42 L37.71,53.99 L31.78,75.08 L50.00,62.93 ' +
  'L68.22,75.08 L62.29,53.99 L79.48,40.42 L57.60,39.54 Z';

const CHECK_PATH =
  'M31.5,51.5 L44,64 L69,36 L76,42.5 L44,78 L24.5,58 Z';

/**
 * Keyed by the `badge` value the database stores, and ORDERED: First 100 outranks
 * Verified, the hierarchy the app renders by. Anything the database returns that is not
 * listed here is dropped rather than guessed at — a new badge kind reaches the share page
 * when somebody draws its mark, not before.
 */
const BADGE_MARKS: { badge: string; glyph: string; light: string; mid: string; deep: string }[] = [
  { badge: 'first_100', glyph: STAR_PATH,  light: '#FFEDB0', mid: '#E8B84B', deep: '#8A5E12' },
  { badge: 'verified',  glyph: CHECK_PATH, light: '#A5F3FC', mid: '#22D3EE', deep: '#0E7490' },
];

/**
 * The author's badges as inline SVG, in precedence order, or '' when they hold none.
 *
 * `aria-label` rather than decorative: to a screen reader "First 100" is information about
 * the artist, not ornament. The gradient ids are fixed because this page renders at most
 * one of each mark — the per-instance counter the mobile components need exists because a
 * feed can mount fifty.
 */
function renderBadges(badges: string[] | null): string {
  if (!badges || badges.length === 0) { return ''; }
  const held = new Set(badges);
  return BADGE_MARKS
    .filter(m => held.has(m.badge))
    .map(m => `<svg class="badge" viewBox="0 0 100 100" width="16" height="16" role="img" aria-label="${m.badge === 'first_100' ? 'First 100' : 'Verified Artist'}">`
      + `<linearGradient id="g-${m.badge}" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="${m.light}"/><stop offset="0.45" stop-color="${m.mid}"/>`
      + `<stop offset="1" stop-color="${m.deep}"/></linearGradient>`
      + `<path d="${SEAL_PATH}" fill="url(#g-${m.badge})" stroke="${m.deep}" stroke-width="2"/>`
      + `<path d="${m.glyph}" fill="#fff"/></svg>`)
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safe to sit inside `<script type="application/json">`. Escaping `<` is the whole
 * job: an HTML parser ends the script at the literal string `</script>` wherever it
 * appears, including inside a JSON string, so a caption of `</script><img onerror=…>`
 * is script injection through a field a user types into their own post.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Only ever emit a media/image URL we recognise. A stored URL is data, and data that
 *  becomes an attribute is a redirect target — `javascript:` in an href is the classic
 *  version of this bug. */
function safeUrl(value: string | null): string | null {
  if (!value) { return null; }
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function fetchSharedPost(postId: string): Promise<SharedPost | null> {
  const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = supabaseConfig();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Every share link on the internet renders "not available" when this is wrong, and
    // the page itself must not say why — it does not leak configuration to visitors. So
    // it is said HERE, in the Vercel function log, where the person who can fix it
    // looks. Neither value is a secret; the anon key is public by design.
    console.error(
      '[share] Supabase is not configured for this deployment. Set SUPABASE_URL and ' +
        'SUPABASE_ANON_KEY (or the VITE_ equivalents) in the Vercel project settings. ' +
        `Currently url=${SUPABASE_URL ? 'set' : 'MISSING'} key=${SUPABASE_ANON_KEY ? 'set' : 'MISSING'}`,
    );
    return null;
  }

  // Plain fetch rather than supabase-js: the function does one unauthenticated RPC
  // call, and a rarely-hit serverless function is ALWAYS cold, so every kilobyte of
  // dependency is paid on the first visitor of every link.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/shared_post_public`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_post_id: postId }),
  });

  if (!res.ok) {
    // The other systematic cause of a page that renders but says nothing is there:
    // most likely the migration not applied, or EXECUTE not granted to `anon`.
    console.error(`[share] shared_post_public failed: HTTP ${res.status} ${res.statusText}`);
    return null;
  }
  const rows = (await res.json()) as SharedPost[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0]! : null;
}

const BASE_CSS = `
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
.brand{display:flex;align-items:center;gap:9px;align-self:flex-start;margin-bottom:24px;
  font-weight:800;letter-spacing:.5px;font-size:15px;text-decoration:none}
.brand img{width:28px;height:28px;display:block;border-radius:7px}
.art{width:100%;aspect-ratio:1;border-radius:16px;object-fit:cover;background:#12121C;
  display:block}
/* A video post's poster keeps the vertical frame the video itself had on this page. */
.art--tall{aspect-ratio:9/16;width:auto;height:60dvh;max-width:100%}
.title{font-size:22px;font-weight:800;margin:20px 0 4px;text-align:center;line-height:1.25}
.artist{font-size:16px;color:#fff;font-weight:700;margin:0;text-align:center}
.handle{font-size:14px;color:#C9B6FF;font-weight:600;margin:3px 0 0;text-align:center}
.badge{vertical-align:-3px;margin-left:5px}
.caption{font-size:14px;color:#9a9aa8;margin:12px 0 0;text-align:center;line-height:1.5}
.meta{font-size:13px;color:#888;margin:10px 0 0;text-align:center;
  font-variant-numeric:tabular-nums}
.stats{display:flex;gap:8px;margin-top:22px;width:100%}
.stat{flex:1;border:1px solid #23232f;background:transparent;border-radius:12px;
  padding:11px 8px;color:#888;font-size:13px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:6px}
.cta{margin-top:26px;width:100%;padding:15px;border-radius:14px;border:1.5px solid #8B3DFF;
  background:rgba(139,61,255,.12);color:#A855F7;font-size:15px;font-weight:700;
  text-align:center;text-decoration:none;display:block;cursor:pointer}
.foot{margin-top:14px;font-size:12.5px;color:#6e6e7c;text-align:center;line-height:1.6}
.foot a{color:#C9B6FF}
.sheet{position:fixed;inset:0;z-index:5;background:rgba(0,0,0,.72);display:none;
  align-items:flex-end}
.sheet[data-open]{display:flex}
.sheet__inner{background:#12121C;width:100%;border-radius:18px 18px 0 0;padding:24px 20px 34px;
  text-align:center}
.sheet h2{font-size:17px;margin:0 0 6px}
.sheet p{font-size:14px;color:#9a9aa8;margin:0 0 18px;line-height:1.5}
.sheet__close{margin-top:12px;background:none;border:0;color:#888;font-size:14px;
  cursor:pointer}
.gone{text-align:center;padding:56px 0 20px}
.gone h1{font-size:20px;margin:0 0 8px}
.gone p{color:#9a9aa8;font-size:14.5px;margin:0;line-height:1.6}
`.trim();

/**
 * The page frame. `title` is escaped HERE rather than by callers — escaping at the sink
 * is what makes it impossible for a future caller to forget, and `<title>` is a real
 * injection point: its content is CDATA to the parser, so a track title containing
 * `</title><script>` closes the element and the rest executes.
 */
function shell(opts: {
  title: string;
  meta: string;
  body: string;
  script?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(opts.title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-itunes-app" content="app-id=6809119164">
${opts.meta}
<style>${BASE_CSS}</style>
</head>
<body>
<div class="bg"></div>
<div class="wrap">
<a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28">LIVIL</a>
${opts.body}
</div>
${opts.script ? `<script>${opts.script}</script>` : ''}
</body>
</html>`;
}

/**
 * The page for a post that is not publicly viewable — deleted, a repost, or an id that
 * never existed. Deliberately a 200 with a real page, not a 404: this URL is already in
 * somebody's chat history where it cannot be corrected, and an error page is a worse
 * last impression than an honest one with a way forward.
 */
function renderUnavailable(): string {
  return shell({
    title: 'Livil',
    meta: [
      '<meta property="og:title" content="Livil">',
      '<meta property="og:description" content="Upload your music, listen together, and see what your friends are playing.">',
      `<meta property="og:image" content="${FALLBACK_OG_IMAGE}">`,
      '<meta property="og:type" content="website">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="robots" content="noindex">',
    ].join('\n'),
    body: `<div class="gone">
<h1>This post isn't available</h1>
<p>It may have been deleted, or the link may be incomplete.</p>
</div>
<a class="cta" id="get" href="${PLAY_STORE}">Get Livil</a>
<p class="foot">
  Free on <a href="${APP_STORE}">the App Store</a> and <a href="${PLAY_STORE}">Google Play</a><br>
  Upload your music, listen together in real time, and see what your friends are playing.
</p>`,
    script: `(function(){var g=document.getElementById('get');if(g&&${IS_APPLE_JS}){g.href=${JSON.stringify(APP_STORE)};}})();`,
  });
}

/** `214` → `3:34`. Whole seconds; the page shows a length, not a position. */
function formatLength(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * How long the post plays for, or null when the database does not know. A clipped
 * upload plays its clip, so the clip's length is the honest number, not the file's.
 */
function playLength(post: SharedPost): number | null {
  const start = post.clip_start_sec != null ? Number(post.clip_start_sec) : 0;
  const end = post.clip_end_sec != null
    ? Number(post.clip_end_sec)
    : post.track_duration_seconds != null ? Number(post.track_duration_seconds) : null;
  if (end == null || !Number.isFinite(end) || !Number.isFinite(start)) { return null; }
  const length = end - start;
  return length > 0 ? length : null;
}

function renderPost(post: SharedPost): string {
  const displayName = (post.author_display_name || '').trim();
  const handle = `@${post.author_username}`;
  const artist = displayName || post.author_username;
  const isVideo = post.track_media_kind === 'video';
  const poster = safeUrl(post.track_thumbnail_url) ?? safeUrl(post.track_cover_art_url);
  const cover = safeUrl(post.track_cover_art_url) ?? poster;
  const ogImage = cover ?? FALLBACK_OG_IMAGE;

  const heading = `${post.track_title} — ${artist}`;
  const description = (post.caption || '').trim() || `Listen to ${post.track_title} on Livil`;
  const deepLink = `livil://post/${post.post_id}`;

  // No og:audio / og:video. Those tags hand the file's URL to every crawler and to
  // anyone reading the source, which is exactly the anonymous listen this page no
  // longer offers. og:type still says what the post IS, so chat apps size the card.
  const meta = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(heading)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}">`,
    `<meta property="og:url" content="${ORIGIN}/p/${post.post_id}">`,
    `<meta property="og:site_name" content="Livil">`,
    `<meta property="og:type" content="${isVideo ? 'video.other' : 'music.song'}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(heading)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}">`,
    `<link rel="canonical" href="${ORIGIN}/p/${post.post_id}">`,
  ].join('\n');

  // A still image, never a media element: a video post shows its poster in the vertical
  // frame the video used to occupy, an audio post its cover art.
  const art = isVideo
    ? (poster ? `<img class="art art--tall" src="${escapeHtml(poster)}" alt="">` : '<div class="art"></div>')
    : (cover ? `<img class="art" src="${escapeHtml(cover)}" alt="">` : '<div class="art"></div>');

  const length = playLength(post);
  const metaLine = `${isVideo ? 'Video' : 'Audio'}${length != null ? ` · ${formatLength(length)}` : ''}`;

  /**
   * Both names, stacked — the display name, then the handle under it.
   *
   * The page showed only `@handle`, so someone arriving from WhatsApp saw "@test1" and
   * had no idea whose track they were looking at. Nothing else works that way: every
   * row in the app leads with the display name and puts the handle beneath it, and the
   * `og:title` this same function builds has always been "<track> — <display name>".
   * The visible page was the one place the name was missing.
   *
   * The badges go on the NAME line, which is where they sit everywhere else.
   *
   * WHEN THERE IS NO DISPLAY NAME the handle IS the name: one line, badges beside it.
   * Rendering an empty first line and a handle under it would open a gap under the title
   * for every artist who never set a name.
   */
  const byline = displayName
    ? `<p class="artist">${escapeHtml(displayName)}${renderBadges(post.author_badges)}</p>
<p class="handle">${escapeHtml(handle)}</p>`
    : `<p class="artist">${escapeHtml(handle)}${renderBadges(post.author_badges)}</p>`;

  const body = `${art}
<h1 class="title">${escapeHtml(post.track_title)}</h1>
${byline}
${post.caption ? `<p class="caption">${escapeHtml(post.caption)}</p>` : ''}
<p class="meta">${metaLine}</p>

<div class="stats">
  <button class="stat" data-gate>&#9825; ${post.likes_count}</button>
  <button class="stat" data-gate>&#128172; ${post.comments_count}</button>
</div>

<a class="cta" id="open" href="${escapeHtml(deepLink)}">Listen on Livil</a>
<p class="foot">
  Listening happens in the Livil app. Don't have it? Get Livil on <a href="${APP_STORE}">the App Store</a> or <a href="${PLAY_STORE}">Google Play</a><br>
  Upload your music, listen together in real time, and see what your friends are playing.
</p>

<div class="sheet" id="gate" role="dialog" aria-modal="true" aria-labelledby="gt">
  <div class="sheet__inner">
    <h2 id="gt">Get the app to join in</h2>
    <p>Liking, commenting and following happen in Livil.</p>
    <a class="cta" href="${escapeHtml(deepLink)}" id="gateOpen">Open in Livil</a>
    <button class="sheet__close" data-close>Not now</button>
  </div>
</div>

<script type="application/json" id="__LIVIL_POST__">${embedJson({
    postId: post.post_id,
    title: post.track_title,
    artist,
    mediaKind: post.track_media_kind,
    durationSeconds: post.track_duration_seconds,
    clipStartSec: post.clip_start_sec,
    clipEndSec: post.clip_end_sec,
  })}</script>`;

  const script = `
(function(){
  var gate=document.getElementById('gate');

  // Any action that needs an account: prompt, never pretend. There is no anonymous
  // write path and there is not meant to be one.
  Array.prototype.forEach.call(document.querySelectorAll('[data-gate]'),function(b){
    b.addEventListener('click',function(){gate.setAttribute('data-open','');});
  });
  gate.addEventListener('click',function(e){
    if(e.target===gate||e.target.hasAttribute('data-close')){gate.removeAttribute('data-open');}
  });

  // Open-in-app: try the custom scheme, and fall back to the store if we are still
  // here afterwards. The visibility check is what distinguishes "no app installed"
  // from "the app opened and we were backgrounded" — without it, everyone who
  // successfully opens the app ALSO gets the store on their way back. The store is the
  // one for this device: App Store on iPhone, Google Play otherwise.
  function handoff(e){
    e.preventDefault();
    var t0=Date.now();
    var timer=setTimeout(function(){
      if(document.visibilityState==='visible'&&Date.now()-t0<2500){
        window.location.href=${IS_APPLE_JS}?${JSON.stringify(APP_STORE)}:${JSON.stringify(PLAY_STORE)};
      }
    },1200);
    document.addEventListener('visibilitychange',function once(){
      clearTimeout(timer);document.removeEventListener('visibilitychange',once);
    });
    window.location.href=${JSON.stringify(deepLink)};
  }
  var o=document.getElementById('open'); if(o){o.addEventListener('click',handoff);}
  var go=document.getElementById('gateOpen'); if(go){go.addEventListener('click',handoff);}
})();`.trim();

  return shell({ title: heading, meta, body, script });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // `id` comes from the vercel.json rewrite (/p/:id). Falling back to the path keeps
  // the function working if it is ever hit directly.
  const raw = typeof req.query.id === 'string'
    ? req.query.id
    : (req.url ?? '').split('?')[0]!.split('/').filter(Boolean).pop() ?? '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!UUID_RE.test(raw)) {
    // No round trip for something that cannot be a post id — this is also what keeps a
    // scanner hammering /p/<junk> off the database entirely.
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(200).send(renderUnavailable());
    return;
  }

  try {
    const post = await fetchSharedPost(raw.toLowerCase());
    if (!post) {
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      res.status(200).send(renderUnavailable());
      return;
    }

    // Five minutes at the edge, a day of stale-while-revalidate. A link doing well
    // therefore reaches this function about twelve times an hour however many people
    // open it — which is what makes cold starts and function invocations a non-issue.
    // Short enough that an edited caption or a deleted post corrects itself quickly.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.status(200).send(renderPost(post));
  } catch {
    // Supabase unreachable. Still a page, still shareable, never a stack trace.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(renderUnavailable());
  }
}
