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
 * ── WHY THERE IS NO CLIENT BUNDLE AT ALL ───────────────────────────────────
 * The design originally called for a second small Vite entry to hydrate this page.
 * It does not need one. Everything the page does — play/pause, a progress bar, the
 * open-in-app handoff, the sign-in prompts — is a few dozen lines against a native
 * `<audio>`/`<video>` element, and inlining them makes the whole page ONE request
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
  track_title: string;
  track_media_kind: 'audio' | 'video';
  track_audio_url: string | null;
  track_video_url: string | null;
  track_cover_art_url: string | null;
  track_thumbnail_url: string | null;
  track_duration_seconds: number | null;
};

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
.brand{display:flex;align-items:center;gap:8px;align-self:flex-start;margin-bottom:24px;
  font-weight:800;letter-spacing:.5px;font-size:15px}
.dot{width:10px;height:10px;border-radius:50%;background:#8B3DFF}
.art{width:100%;aspect-ratio:1;border-radius:16px;object-fit:cover;background:#12121C;
  display:block}
video.art{aspect-ratio:9/16;max-height:60dvh;width:auto;border-radius:16px}
.title{font-size:22px;font-weight:800;margin:20px 0 4px;text-align:center;line-height:1.25}
.artist{font-size:15px;color:#C9B6FF;font-weight:600;margin:0;text-align:center}
.caption{font-size:14px;color:#9a9aa8;margin:12px 0 0;text-align:center;line-height:1.5}
.player{width:100%;margin-top:22px;display:flex;align-items:center;gap:14px}
.play{width:52px;height:52px;flex:0 0 52px;border-radius:50%;border:1.5px solid #8B3DFF;
  background:rgba(139,61,255,.12);color:#A855F7;font-size:18px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;padding:0}
.play:disabled{opacity:.5;cursor:default}
.bar{flex:1;height:5px;border-radius:3px;background:#22222e;overflow:hidden}
.fill{height:100%;width:0;background:linear-gradient(90deg,#6D28D9,#A855F7)}
.time{font-variant-numeric:tabular-nums;font-size:12px;color:#888;min-width:38px;
  text-align:right}
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
${opts.meta}
<style>${BASE_CSS}</style>
</head>
<body>
<div class="bg"></div>
<div class="wrap">
<div class="brand"><span class="dot"></span>LIVIL</div>
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
<a class="cta" href="${PLAY_STORE}">Get Livil</a>
<p class="foot">Upload your music, listen together in real time, and see what your friends are playing.</p>`,
  });
}

function renderPost(post: SharedPost): string {
  const artist = (post.author_display_name || '').trim() || post.author_username;
  const isVideo = post.track_media_kind === 'video';
  const mediaUrl = safeUrl(isVideo ? post.track_video_url : post.track_audio_url);
  const poster = safeUrl(post.track_thumbnail_url) ?? safeUrl(post.track_cover_art_url);
  const cover = safeUrl(post.track_cover_art_url) ?? poster;
  const ogImage = cover ?? FALLBACK_OG_IMAGE;

  const heading = `${post.track_title} — ${artist}`;
  const description = (post.caption || '').trim() || `Listen to ${post.track_title} on Livil`;
  const deepLink = `livil://post/${post.post_id}`;

  const meta = [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(heading)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}">`,
    `<meta property="og:url" content="${ORIGIN}/p/${post.post_id}">`,
    `<meta property="og:site_name" content="Livil">`,
    // music.song rather than website: it is what tells a chat client this is playable
    // media rather than an article, and several of them render a bigger card for it.
    `<meta property="og:type" content="${isVideo ? 'video.other' : 'music.song'}">`,
    mediaUrl
      ? `<meta property="${isVideo ? 'og:video' : 'og:audio'}" content="${escapeHtml(mediaUrl)}">`
      : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(heading)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}">`,
    `<link rel="canonical" href="${ORIGIN}/p/${post.post_id}">`,
  ].filter(Boolean).join('\n');

  // preload="none" IS THE EGRESS BUDGET, not a micro-optimisation. There is no adaptive
  // streaming (kb/architecture/media-pipeline.md) — every listen is a progressive
  // download of the whole file, ~4 MB for a song and ~60 MB for a video. `preload="auto"`
  // would start paying for every person who merely opens the link, whether or not they
  // ever intended to listen.
  const mediaEl = !mediaUrl
    ? `<div class="art"></div>`
    : isVideo
      ? `<video id="m" class="art" playsinline preload="none" ${poster ? `poster="${escapeHtml(poster)}"` : ''} src="${escapeHtml(mediaUrl)}"></video>`
      : `${cover ? `<img class="art" src="${escapeHtml(cover)}" alt="">` : '<div class="art"></div>'}
<audio id="m" preload="none" src="${escapeHtml(mediaUrl)}"></audio>`;

  const body = `${mediaEl}
<h1 class="title">${escapeHtml(post.track_title)}</h1>
<p class="artist">@${escapeHtml(post.author_username)}</p>
${post.caption ? `<p class="caption">${escapeHtml(post.caption)}</p>` : ''}

<div class="player">
  <button class="play" id="p" aria-label="Play" ${mediaUrl ? '' : 'disabled'}>&#9654;</button>
  <div class="bar"><div class="fill" id="f"></div></div>
  <span class="time" id="t">0:00</span>
</div>

<div class="stats">
  <button class="stat" data-gate>&#9825; ${post.likes_count}</button>
  <button class="stat" data-gate>&#128172; ${post.comments_count}</button>
</div>

<a class="cta" id="open" href="${escapeHtml(deepLink)}">Open in Livil</a>
<p class="foot">
  Don't have the app? <a href="${PLAY_STORE}">Get Livil on Google Play</a><br>
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

  // Clip window: an upload is normally the whole track, but the column exists on every
  // post and a clipped upload must play its clip, not the file from zero.
  const clipStart = post.clip_start_sec != null ? Number(post.clip_start_sec) : null;
  const clipEnd = post.clip_end_sec != null ? Number(post.clip_end_sec) : null;

  const script = `
(function(){
  var m=document.getElementById('m'),p=document.getElementById('p'),
      f=document.getElementById('f'),t=document.getElementById('t'),
      gate=document.getElementById('gate');
  var CS=${clipStart === null ? 'null' : clipStart}, CE=${clipEnd === null ? 'null' : clipEnd};

  function fmt(s){s=Math.max(0,Math.floor(s||0));
    return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

  if(m&&p){
    p.addEventListener('click',function(){
      if(m.paused){
        // Seek to the clip start on the FIRST play only. Doing it on every play would
        // make a mid-track pause un-resumable.
        if(CS!=null&&!m.dataset.seeded){m.dataset.seeded='1';try{m.currentTime=CS;}catch(e){}}
        m.play().catch(function(){});
      } else { m.pause(); }
    });
    m.addEventListener('play',function(){p.innerHTML='&#10073;&#10073;';p.setAttribute('aria-label','Pause');});
    m.addEventListener('pause',function(){p.innerHTML='&#9654;';p.setAttribute('aria-label','Play');});
    m.addEventListener('timeupdate',function(){
      var start=CS!=null?CS:0, end=CE!=null?CE:(m.duration||0);
      var span=end-start;
      if(CE!=null&&m.currentTime>=CE){m.pause();}
      if(span>0){f.style.width=Math.min(100,Math.max(0,((m.currentTime-start)/span)*100))+'%';}
      t.textContent=fmt(m.currentTime-start);
    });
    m.addEventListener('ended',function(){f.style.width='0%';t.textContent='0:00';m.dataset.seeded='';});
  }

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
  // successfully opens the app ALSO gets the Play Store on their way back.
  function handoff(e){
    e.preventDefault();
    var t0=Date.now();
    var timer=setTimeout(function(){
      if(document.visibilityState==='visible'&&Date.now()-t0<2500){
        window.location.href=${JSON.stringify(PLAY_STORE)};
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
