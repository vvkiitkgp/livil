import { writeFileSync } from 'node:fs';

// ---------- tokens (src/theme/colors.ts) ----------
const C = {
  bg: '#0A0A0F', surface: '#12121C', card: '#1A1A2E', inputBg: '#1C1C30',
  purple: '#8B3DFF', neon: '#A855F7', royal: '#6D28D9', deep: '#4C1D95', deepest: '#3A1180',
  light: '#C9B6FF', white: '#FFFFFF', sec: '#8B90A7', muted: '#4B5268', border: '#252545',
  error: '#EF4444', info: '#22D3EE', success: '#00C853',
};
const W = 1320, H = 2868;           // Apple 6.9" master
const SAFE_TOP = 260;               // 1320x2347 safe zone for the Play crop

// ---------- icons (24-grid strokes) ----------
const ic = (d, s = 48, color = C.white, extra = '') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  back: (s, c) => ic('<path d="M15 5l-7 7 7 7"/>', s, c),
  x: (s, c) => ic('<path d="M6 6l12 12M18 6L6 18"/>', s, c),
  plus: (s, c) => ic('<path d="M12 5v14M5 12h14"/>', s, c),
  send: (s, c) => ic('<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>', s, c),
  home: (s, c) => ic('<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>', s, c),
  search: (s, c) => ic('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', s, c),
  library: (s, c) => ic('<path d="M4 6h10M4 12h10M4 18h6"/><path d="M18 5v10.5"/><circle cx="16" cy="16.5" r="2.5"/>', s, c),
  user: (s, c) => ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>', s, c),
  heart: (s, c) => ic('<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z"/>', s, c),
  chat: (s, c) => ic('<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-5A8 8 0 1121 12z"/>', s, c),
  repost: (s, c) => ic('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>', s, c),
  play: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><path d="M8 5.5v13l11-6.5z"/></svg>`,
  pause: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  prev: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><rect x="5" y="5" width="2.4" height="14" rx="1"/><path d="M19 5.5v13L8.5 12z"/></svg>`,
  next: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><rect x="16.6" y="5" width="2.4" height="14" rx="1"/><path d="M5 5.5v13L15.5 12z"/></svg>`,
  shuffle: (s, c) => ic('<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>', s, c),
  repeat: (s, c) => ic('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>', s, c),
  crown: (s, c) => ic('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>', s, c),
  note: (s, c) => ic('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', s, c),
  users: (s, c) => ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17" cy="9" r="3"/><path d="M17 14.5c2.8 0 4.5 1.8 4.5 4.5"/>', s, c),
  chev: (s, c) => ic('<path d="M9 5l7 7-7 7"/>', s, c),
  chevDown: (s, c) => ic('<path d="M5 9l7 7 7-7"/>', s, c),
  more: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
  lock: (s, c) => ic('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', s, c),
  image: (s, c) => ic('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>', s, c),
  upload: (s, c) => ic('<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>', s, c),
  check: (s, c) => ic('<path d="M5 12.5l4.5 4.5L19 7"/>', s, c),
};

// ---------- pulse glyph path (docs/favicon.svg reading of the mark) ----------
const PULSE = 'M0 17 H24 L31 6 L40 30 L47 12 L52 17 H70 L77 9 L84 25 L90 17 H120';

// ---------- primitives (app UI at 2x dp) ----------
const outlineBtn = (label, { w = 'auto', h = 96, fs = 30, color = C.neon, pad = 44, icon = '' } = {}) =>
  `<div style="display:flex;align-items:center;justify-content:center;gap:16px;height:${h}px;width:${w};padding:0 ${pad}px;border-radius:999px;border:3px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:inset 0 0 22px rgba(139,61,255,0.28);color:${color};font-weight:700;font-size:${fs}px;letter-spacing:-0.01em;">${icon}<span>${label}</span></div>`;
const ghostBtn = (label, { h = 96, fs = 30, pad = 44 } = {}) =>
  `<div style="display:flex;align-items:center;justify-content:center;height:${h}px;padding:0 ${pad}px;border-radius:999px;border:3px solid ${C.border};color:${C.white};font-weight:700;font-size:${fs}px;">${label}</div>`;
const pill = (label, { color = C.neon, bg = 'rgba(139,61,255,0.15)', fs = 22 } = {}) =>
  `<div style="display:inline-flex;align-items:center;height:44px;padding:0 20px;border-radius:999px;background:${bg};color:${color};font-size:${fs}px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">${label}</div>`;
const avatar = (initials, size, hue, { ring = false, dot = false } = {}) => {
  const base = `<div style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,hsl(${hue} 60% 38%),hsl(${hue + 40} 70% 22%));color:${C.white};font-weight:800;font-size:${Math.round(size * 0.36)}px;letter-spacing:0.02em;">${initials}</div>`;
  const ringed = ring ? `<div style="padding:5px;border-radius:50%;background:linear-gradient(135deg,${C.deep},${C.neon});"><div style="padding:5px;border-radius:50%;background:${C.bg};">${base}</div></div>` : base;
  return dot ? `<div style="position:relative;display:inline-flex;">${ringed}<div style="position:absolute;right:2px;bottom:2px;width:${Math.round(size * 0.22)}px;height:${Math.round(size * 0.22)}px;border-radius:50%;background:${C.success};border:4px solid ${C.bg};"></div></div>` : ringed;
};
// cover art: abstract, no photos
const ART = {
  midnight: `background:radial-gradient(120% 80% at 80% 10%,#5B2AC2 0%,rgba(91,42,194,0) 55%),radial-gradient(90% 60% at 20% 90%,#1E1B5A 0%,rgba(30,27,90,0) 60%),linear-gradient(180deg,#141433 0%,#07070F 100%);`,
  lowtide: `background:radial-gradient(100% 70% at 30% 20%,#0FB5C7 0%,rgba(15,181,199,0) 55%),radial-gradient(80% 60% at 85% 85%,#1E3A8A 0%,rgba(30,58,138,0) 60%),linear-gradient(180deg,#0B1D2B 0%,#050A12 100%);`,
  night: `background:radial-gradient(100% 70% at 70% 80%,#7C3AED 0%,rgba(124,58,237,0) 55%),linear-gradient(180deg,#1A1030 0%,#08060F 100%);`,
  late: `background:radial-gradient(90% 60% at 20% 20%,#F59E0B 0%,rgba(245,158,11,0) 50%),radial-gradient(90% 60% at 80% 80%,#4C1D95 0%,rgba(76,29,149,0) 60%),linear-gradient(180deg,#1C1224 0%,#0A0A0F 100%);`,
};
const cover = (kind, size, radius = 28, inner = '') =>
  `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;position:relative;overflow:hidden;${ART[kind]}">
    <svg width="${size}" height="${size}" viewBox="0 0 120 120" fill="none" style="position:absolute;inset:0;opacity:0.55;"><path d="${PULSE.replace(/(\d+(\.\d+)?)/g, (m) => m)}" transform="translate(0,43)" stroke="rgba(255,255,255,0.9)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${inner}</div>`;

// waveform bars (deterministic)
const bars = (n, seed, h, color, { from = 0, to = 1, dim = 'rgba(255,255,255,0.22)', gap = 6, w = 6 } = {}) => {
  let s = seed; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = i / n; const env = 0.35 + 0.65 * Math.abs(Math.sin(t * 9 + seed)) * (0.5 + r() * 0.5);
    const bh = Math.max(8, Math.round(env * h));
    const lit = t >= from && t < to;
    out += `<div style="width:${w}px;height:${bh}px;border-radius:${w}px;background:${lit ? color : dim};"></div>`;
  }
  return `<div style="display:flex;align-items:center;gap:${gap}px;height:${h}px;">${out}</div>`;
};
const gradFill = `linear-gradient(90deg,${C.deep},${C.purple} 60%,${C.neon})`;

const progress = (pct, w, { thumb = true } = {}) =>
  `<div style="position:relative;width:${w}px;height:12px;border-radius:6px;background:rgba(255,255,255,0.14);overflow:visible;">
     <div style="position:absolute;left:0;top:0;height:12px;width:${Math.round(w * pct)}px;border-radius:6px;background:${gradFill};"></div>
     ${thumb ? `<div style="position:absolute;left:${Math.round(w * pct) - 18}px;top:-12px;width:36px;height:36px;border-radius:50%;background:${C.white};box-shadow:0 0 0 8px rgba(168,85,247,0.25);"></div>` : ''}
   </div>`;

const tabBar = (active) => {
  const t = [['home', 'Home'], ['search', 'Search'], ['library', 'Library'], ['user', 'Profile']];
  return `<div style="display:flex;justify-content:space-around;align-items:flex-start;padding:22px 24px 40px;background:rgba(10,10,15,0.92);border-top:2px solid ${C.border};">${t.map(([k, l]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:150px;color:${k === active ? C.neon : C.sec};font-size:24px;font-weight:600;">${I[k](52, k === active ? C.neon : C.sec)}<span>${l}</span></div>`).join('')}</div>`;
};
const floating = (title, kind) =>
  `<div style="position:absolute;left:24px;right:24px;bottom:196px;height:104px;border-radius:999px;border:3px solid transparent;background:linear-gradient(${C.surface},${C.surface}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;display:flex;align-items:center;padding:0 24px 0 16px;gap:20px;">
     ${cover(kind, 76, 38)}
     <div style="display:flex;align-items:center;gap:20px;flex-grow:1;">
       <div style="display:flex;flex-direction:column;gap:4px;min-width:0;"><div style="color:${C.white};font-size:26px;font-weight:700;">${title}</div></div>
       ${bars(26, 7, 44, C.neon, { from: 0, to: 1, gap: 5, w: 5 })}
     </div>
     <div style="width:66px;height:66px;border-radius:50%;border:3px solid ${C.neon};display:flex;align-items:center;justify-content:center;">${I.pause(34, C.white)}</div>
   </div>`;

// phone frame; screen 780x1690 (390x845dp @2x)
const phone = (screen, { tilt = 0, w = 780, h = 1690 } = {}) =>
  `<div style="width:${w + 28}px;height:${h + 28}px;border-radius:112px;padding:14px;background:linear-gradient(160deg,#2A2A3A,#0E0E16 55%,#22222E);box-shadow:0 60px 140px rgba(0,0,0,0.7),0 0 0 2px rgba(255,255,255,0.05) inset;transform:rotate(${tilt}deg);flex-shrink:0;">
     <div style="width:${w}px;height:${h}px;border-radius:98px;background:${C.bg};position:relative;overflow:hidden;font-family:'Manrope',system-ui,-apple-system,'Segoe UI',sans-serif;color:${C.white};">
       ${screen}
     </div>
   </div>`;

// ---------- headline ----------
const headline = (parts, sub, { align = 'left', size = 118, top = SAFE_TOP + 90, maxW = 1120 } = {}) =>
  `<div style="position:absolute;left:100px;right:100px;top:${top}px;display:flex;flex-direction:column;gap:34px;align-items:${align === 'center' ? 'center' : 'flex-start'};text-align:${align};">
     <div style="font-family:'Sora','Manrope',system-ui,sans-serif;font-weight:800;font-size:${size}px;line-height:1.02;letter-spacing:-0.035em;color:${C.white};max-width:${maxW}px;text-wrap:balance;">${parts.map(p => p.g ? `<span style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-style:italic;font-weight:400;font-size:${Math.round(size * 1.12)}px;letter-spacing:-0.02em;background:linear-gradient(92deg,${C.royal},${C.neon});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:${C.neon};padding-right:0.04em;">${p.t}</span>` : p.t).join('')}</div>
     ${sub ? `<div style="font-family:'Manrope',system-ui,sans-serif;font-weight:500;font-size:44px;line-height:1.3;color:${C.light};max-width:${maxW - 60}px;text-wrap:pretty;">${sub}</div>` : ''}
   </div>`;

// pulse line, continuous through the strip. y baseline 1690 absolute.
const pulseLine = (d) =>
  `<svg width="${W}" height="400" viewBox="0 0 ${W} 400" fill="none" style="position:absolute;left:0;top:1490px;pointer-events:none;"><path d="${d}" stroke="${C.neon}" stroke-opacity="0.34" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const glow = (x, y, rx = 900, ry = 700, a = 0.55) =>
  `<div style="position:absolute;left:${x - rx}px;top:${y - ry}px;width:${rx * 2}px;height:${ry * 2}px;border-radius:50%;background:radial-gradient(closest-side,rgba(139,61,255,${a}),rgba(76,29,149,${a * 0.5}) 40%,rgba(10,10,15,0) 72%);pointer-events:none;"></div>`;

const page = (title, body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@800&family=Manrope:wght@500;600;700;800&family=Instrument+Serif:ital@1&display=swap">
  <style>
    body { margin: 0; background: ${C.bg}; }
    a { color: ${C.neon}; } a:hover { color: ${C.light}; }
    * { box-sizing: border-box; }
  </style>
</helmet>
<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${C.bg};font-family:'Manrope',system-ui,sans-serif;">
${body}
</div>
</x-dc>
</body>
</html>`;

// ================= SCREENS =================
const jamHeader = (sub, right) =>
  `<div style="display:flex;align-items:center;justify-content:space-between;padding:96px 40px 24px 28px;">
     <div style="display:flex;align-items:center;gap:18px;">${I.back(56, C.neon)}<div style="display:flex;flex-direction:column;gap:6px;"><div style="font-size:40px;font-weight:800;">Jam Room</div><div style="display:flex;align-items:center;gap:10px;color:${C.sec};font-size:26px;">${sub}</div></div></div>
     ${right}
   </div>`;
const bubble = (text, { me = false, name = '' } = {}) =>
  `<div style="display:flex;justify-content:${me ? 'flex-end' : 'flex-start'};"><div style="max-width:560px;padding:${name ? '18px 30px 22px' : '22px 30px'};border-radius:36px;${me ? `border-bottom-right-radius:12px;background:${C.purple};` : `border-bottom-left-radius:12px;background:${C.card};`}display:flex;flex-direction:column;gap:6px;">${name ? `<div style="color:${C.neon};font-size:24px;font-weight:700;">${name}</div>` : ''}<div style="font-size:30px;line-height:1.3;">${text}</div></div></div>`;
const segmented = (a, b, which = 0) =>
  `<div style="margin:0 40px;display:flex;padding:8px;border-radius:40px;background:${C.surface};gap:8px;">${[a, b].map((l, i) => `<div style="flex:1;height:76px;border-radius:32px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;${i === which ? `border:3px solid transparent;background:linear-gradient(${C.surface},${C.surface}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;color:${C.neon};` : `color:${C.sec};`}">${l}</div>`).join('')}</div>`;
const msgInput = () =>
  `<div style="position:absolute;left:0;right:0;bottom:0;padding:24px 40px 60px;display:flex;gap:20px;align-items:center;background:${C.bg};border-top:2px solid ${C.border};">
     <div style="flex:1;height:100px;border-radius:32px;border:3px solid ${C.border};background:${C.inputBg};display:flex;align-items:center;padding:0 34px;color:${C.muted};font-size:30px;">Message…</div>
     <div style="width:96px;height:96px;border-radius:50%;border:3px solid ${C.neon};display:flex;align-items:center;justify-content:center;">${I.send(44, C.neon)}</div>
   </div>`;

const listenersRow = (withYou) =>
  `<div style="display:flex;justify-content:center;gap:-10px;align-items:center;">
     <div style="display:flex;align-items:center;">${[['R', 285], ['S', 195], ['N', 330], ['K', 20]].map(([i, h], k) => `<div style="margin-left:${k ? -18 : 0}px;border:5px solid ${C.bg};border-radius:50%;">${avatar(i, 76, h, { dot: true })}</div>`).join('')}${withYou ? `<div style="margin-left:-18px;border:5px solid ${C.bg};border-radius:50%;">${avatar('YOU', 76, 260, { dot: true })}</div>` : ''}<div style="margin-left:14px;color:${C.sec};font-size:26px;font-weight:600;">5 listening</div></div>
   </div>`;

const jamScreen = ({ host }) => {
  const pct = 102 / 236; // 1:42 of 3:56
  return `
  ${jamHeader(host ? `${I.crown(28, C.warning)}<span>You are the host</span>` : `${I.users(28, C.neon)}<span>riya.wav is hosting</span>`,
    host ? `<div style="height:72px;padding:0 30px;border-radius:24px;border:3px solid rgba(239,68,68,0.5);color:${C.error};font-weight:800;font-size:28px;display:flex;align-items:center;background:rgba(239,68,68,0.08);">End</div>`
         : `<div style="height:72px;padding:0 30px;border-radius:24px;border:3px solid ${C.border};color:${C.white};font-weight:800;font-size:28px;display:flex;align-items:center;">Leave</div>`)}
  <div style="display:flex;flex-direction:column;align-items:center;gap:20px;padding:10px 40px 0;">
    ${cover('midnight', 270, 28)}
    <div style="text-align:center;display:flex;flex-direction:column;gap:6px;"><div style="font-size:40px;font-weight:800;">Midnight Drive</div><div style="color:${C.sec};font-size:28px;">riya.wav</div></div>
    <div style="display:flex;flex-direction:column;gap:22px;width:100%;">
      ${progress(pct, 700, { thumb: host })}
      <div style="display:flex;justify-content:space-between;color:${C.sec};font-size:24px;font-weight:600;"><span style="color:${C.neon};font-weight:800;">1:42</span><span>3:56</span></div>
    </div>
    ${host
      ? `<div style="width:130px;height:130px;border-radius:50%;border:4px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:0 0 60px rgba(139,61,255,0.35),inset 0 0 30px rgba(139,61,255,0.3);display:flex;align-items:center;justify-content:center;">${I.pause(66, C.white)}</div>`
      : `<div style="display:flex;align-items:center;gap:20px;">${pill('Listening', { color: C.info, bg: 'rgba(34,211,238,0.12)' })}${outlineBtn('Suggest a track', { h: 80, fs: 26, pad: 32, icon: I.note(30, C.neon) })}</div>`}
    ${listenersRow(!host)}
  </div>
  <div style="height:2px;background:${C.border};margin:24px 0 20px;"></div>
  ${segmented('Chat', 'Queue', 0)}
  <div style="display:flex;flex-direction:column;gap:18px;padding:30px 30px 0;">
    ${host
      ? bubble('this drop 🔥', { name: 'sam_beats' }) + bubble('wait for 2:10', { name: 'nadia' }) + bubble('looping it 🔁', { me: true })
      : bubble('looping it 🔁', { name: 'riya.wav' }) + bubble('ok THIS is the one', { me: true })}
  </div>
  ${msgInput()}`;
};

const appHeader = () =>
  `<div style="display:flex;align-items:center;justify-content:space-between;padding:88px 30px 20px 30px;">
     <div style="display:flex;align-items:center;gap:20px;"><div style="width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,${C.royal},${C.neon});display:flex;align-items:center;justify-content:center;"><svg width="52" height="52" viewBox="0 0 120 34" fill="none"><path d="${PULSE}" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,0)"/></svg></div><div style="font-size:44px;font-weight:800;letter-spacing:-0.03em;">livil</div></div>
     <div style="display:flex;gap:16px;"><div style="width:84px;height:84px;border-radius:50%;border:3px solid ${C.neon};display:flex;align-items:center;justify-content:center;">${I.plus(44, C.neon)}</div><div style="width:84px;height:84px;border-radius:50%;border:3px solid ${C.border};display:flex;align-items:center;justify-content:center;">${I.send(40, C.white)}</div></div>
   </div>`;

const feedCard = ({ reposter, from, initials, hue, title, creator, caption, kind, clip }) =>
  `<div style="margin:0 24px;border-radius:44px;background:${C.surface};border:2px solid ${C.border};padding:28px 30px 30px;display:flex;flex-direction:column;gap:22px;">
     ${reposter ? `<div style="display:flex;align-items:center;gap:12px;color:${C.sec};font-size:24px;">${I.repost(28, C.neon)}<span><b style="color:${C.white};">${reposter}</b> reposted from <b style="color:${C.white};">@${from}</b></span></div>` : ''}
     <div style="display:flex;align-items:center;justify-content:space-between;">
       <div style="display:flex;align-items:center;gap:18px;">${avatar(initials, 88, hue)}<div style="display:flex;flex-direction:column;gap:4px;"><div style="font-size:30px;font-weight:800;">${reposter || from} <span style="color:${C.sec};font-weight:500;font-size:24px;">· 2h</span></div><div style="color:${C.sec};font-size:24px;">@${reposter ? reposter.toLowerCase() : from}</div></div></div>
       <div style="display:flex;align-items:center;gap:14px;">${outlineBtn('Repost', { h: 76, fs: 26, pad: 28, icon: I.repost(28, C.neon) })}<div style="width:76px;height:76px;border-radius:50%;background:${C.card};display:flex;align-items:center;justify-content:center;">${I.more(36, C.sec)}</div></div>
     </div>
     <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;"><div style="font-size:34px;font-weight:800;">${title}</div><div style="display:flex;align-items:center;gap:10px;height:48px;padding:0 20px;border-radius:999px;border:2px solid rgba(34,211,238,0.5);color:${C.info};font-size:20px;font-weight:800;letter-spacing:0.08em;">CREATOR <span style="letter-spacing:0;">@${creator}</span></div></div>
     ${caption ? `<div style="color:${C.light};font-size:28px;line-height:1.35;">${caption}</div>` : ''}
     <div style="position:relative;">${cover(kind, 692, 34, `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"><div style="width:150px;height:150px;border-radius:50%;background:rgba(10,10,15,0.55);border:3px solid rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);">${I.play(70, C.white)}</div></div>${clip ? `<div style="position:absolute;left:24px;right:24px;bottom:24px;display:flex;align-items:center;gap:16px;padding:14px 20px;border-radius:24px;background:rgba(10,10,15,0.7);">${bars(34, 3, 36, C.neon, { from: 0.28, to: 0.42, gap: 5, w: 5 })}<div style="color:${C.white};font-size:22px;font-weight:700;white-space:nowrap;">${clip}</div></div>` : ''}`)}</div>
     <div style="display:flex;align-items:center;gap:40px;color:${C.sec};font-size:26px;font-weight:600;"><div style="display:flex;align-items:center;gap:10px;">${I.heart(34, C.neon)}<span>128</span></div><div style="display:flex;align-items:center;gap:10px;">${I.chat(34, C.sec)}<span>14</span></div><div style="display:flex;align-items:center;gap:10px;">${I.play(30, C.sec)}<span>2.1K</span></div></div>
   </div>`;

const homeScreen = () => `
  ${appHeader()}
  <div style="padding:10px 30px 0;display:flex;flex-direction:column;gap:20px;">
    <div style="font-size:34px;font-weight:800;">Friends</div>
    <div style="display:flex;gap:26px;">
      ${[['R', 285, 'riya.wav', true], ['SB', 195, 'sam_beats', true], ['N', 330, 'nadia', true], ['K', 20, 'kabir', false], ['AJ', 120, 'aj.mp3', false]].map(([i, h, n, u]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;width:128px;">${u ? avatar(i, 96, h, { ring: true }) : `<div style="padding:10px;border-radius:50%;border:4px solid ${C.border};">${avatar(i, 96, h)}</div>`}<div style="color:${C.sec};font-size:22px;white-space:nowrap;">@${n}</div></div>`).join('')}
    </div>
  </div>
  <div style="margin:30px 30px 0;padding:22px 26px;border-radius:32px;background:${C.surface};border:2px solid ${C.border};display:flex;flex-direction:column;gap:16px;">
    <div style="display:flex;align-items:center;gap:12px;color:${C.sec};font-size:22px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;"><div style="width:14px;height:14px;border-radius:50%;background:${C.success};box-shadow:0 0 14px ${C.success};"></div>Listening now</div>
    <div style="display:flex;align-items:center;gap:16px;">${avatar('SB', 56, 195)}<div style="font-size:26px;"><b>sam_beats</b> <span style="color:${C.sec};">is playing</span> <b style="color:${C.neon};">Low Tide</b></div></div>
    <div style="display:flex;align-items:center;gap:16px;">${avatar('N', 56, 330)}<div style="font-size:26px;"><b>nadia</b> <span style="color:${C.sec};">is in a</span> <b style="color:${C.neon};">Jam Room</b> <span style="color:${C.sec};">· friday. no plans.</span></div></div>
  </div>
  <div style="padding:40px 30px 22px;display:flex;flex-direction:column;gap:8px;"><div style="font-size:44px;font-weight:800;letter-spacing:-0.02em;">For you</div><div style="color:${C.sec};font-size:26px;line-height:1.35;">Mutual friends first, people you star next, then what's trending.</div></div>
  ${feedCard({ reposter: 'nadia', from: 'sam_beats', initials: 'N', hue: 330, title: 'Low Tide', creator: 'sam_beats', caption: 'the bridge in this is insane', kind: 'lowtide', clip: '0:48 – 1:03' })}
  ${floating('Low Tide · sam_beats', 'lowtide')}
  <div style="position:absolute;left:0;right:0;bottom:0;">${tabBar('home')}</div>`;

const repostScreen = () => `
  <div style="display:flex;align-items:center;justify-content:space-between;padding:96px 40px 30px;">
    ${I.x(56, C.white)}<div style="font-size:38px;font-weight:800;">Repost</div><div style="width:56px;"></div>
  </div>
  <div style="margin:0 40px;display:flex;align-items:center;gap:22px;padding:22px;border-radius:36px;background:${C.surface};border:2px solid ${C.border};">
    ${cover('lowtide', 120, 24)}<div style="display:flex;flex-direction:column;gap:6px;"><div style="font-size:32px;font-weight:800;">Low Tide</div><div style="color:${C.sec};font-size:26px;">sam_beats · 4:12</div></div>
  </div>
  <div style="padding:70px 40px 0;display:flex;flex-direction:column;gap:26px;">
    <div style="display:flex;align-items:center;justify-content:space-between;"><div style="font-size:30px;font-weight:800;">Choose your clip</div>${pill('15s', {})}</div>
    <div style="position:relative;padding:36px 0;">
      ${bars(58, 11, 240, C.neon, { from: 0.19, to: 0.36, gap: 6, w: 6.5 })}
      <div style="position:absolute;left:19%;right:64%;top:0;bottom:0;border-radius:20px;background:rgba(139,61,255,0.14);border:3px solid transparent;background-clip:padding-box;"></div>
      <div style="position:absolute;left:calc(19% - 16px);top:0;bottom:0;width:32px;border-radius:16px;background:${gradFill};box-shadow:0 0 30px rgba(168,85,247,0.6);"></div>
      <div style="position:absolute;left:calc(36% - 16px);top:0;bottom:0;width:32px;border-radius:16px;background:${gradFill};box-shadow:0 0 30px rgba(168,85,247,0.6);"></div>
      <div style="position:absolute;left:19%;right:64%;top:-6px;height:6px;background:${C.neon};"></div>
      <div style="position:absolute;left:19%;right:64%;bottom:-6px;height:6px;background:${C.neon};"></div>
    </div>
    <div style="display:flex;justify-content:space-between;color:${C.sec};font-size:24px;font-weight:600;"><span>0:00</span><span style="color:${C.neon};font-weight:800;">0:48 – 1:03</span><span>4:12</span></div>
    <div style="display:flex;justify-content:center;">${ghostBtn('Preview clip', { h: 80, fs: 26, pad: 36 })}</div>
  </div>
  <div style="padding:60px 40px 0;display:flex;flex-direction:column;gap:20px;">
    <div style="font-size:30px;font-weight:800;">Say something</div>
    <div style="min-height:150px;border-radius:32px;border:3px solid ${C.neon};background:${C.inputBg};padding:26px 30px;font-size:30px;line-height:1.35;color:${C.white};box-shadow:0 0 0 6px rgba(139,61,255,0.18);">the bridge in this is insane<span style="display:inline-block;width:3px;height:34px;background:${C.neon};vertical-align:-6px;margin-left:2px;"></span></div>
  </div>
  <div style="margin:44px 40px 0;padding:30px 30px;border-radius:32px;background:${C.surface};border:2px solid ${C.border};display:flex;align-items:center;justify-content:space-between;">
    <div style="display:flex;flex-direction:column;gap:6px;"><div style="font-size:30px;font-weight:800;">Post as a Story</div><div style="color:${C.sec};font-size:24px;">Friends only · disappears in 24h · 10s max</div></div>
    <div style="width:96px;height:56px;border-radius:999px;background:${C.card};border:3px solid ${C.border};position:relative;"><div style="position:absolute;left:4px;top:4px;width:42px;height:42px;border-radius:50%;background:${C.sec};"></div></div>
  </div>
  <div style="position:absolute;left:40px;right:40px;bottom:70px;display:flex;flex-direction:column;gap:18px;">
    ${outlineBtn('Repost to feed', { h: 108, fs: 32, icon: I.repost(34, C.neon) })}
  </div>`;

const profileScreen = () => `
  <div style="display:flex;align-items:center;justify-content:space-between;padding:88px 40px 10px;">
    <div style="font-size:44px;font-weight:800;letter-spacing:-0.03em;">livil</div>${ghostBtn('Share', { h: 68, fs: 26, pad: 30 })}
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 40px 0;">
    ${avatar('R', 200, 285, { ring: true })}
    <div style="font-size:44px;font-weight:800;margin-top:10px;">Riya</div>
    <div style="color:${C.neon};font-size:30px;font-weight:700;">@riya.wav</div>
    <div style="color:${C.sec};font-size:28px;">bedroom producer · Mumbai</div>
  </div>
  <div style="margin:34px 40px 0;display:flex;border-radius:40px;background:${C.surface};border:2px solid ${C.border};padding:30px 0;">
    ${[['2.4K', 'FANS'], ['38', 'FRIENDS'], ['16', 'STARS']].map(([n, l], i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;${i ? `border-left:2px solid ${C.border};` : ''}"><div style="font-size:44px;font-weight:800;">${n}</div><div style="color:${C.sec};font-size:22px;font-weight:800;letter-spacing:0.14em;">${l}</div></div>`).join('')}
  </div>
  <div style="text-align:center;color:${C.sec};font-size:28px;padding:24px 0 0;"><b style="color:${C.white};">41</b> posts · <b style="color:${C.white};">38</b> uploads · <b style="color:${C.white};">3</b> albums</div>
  <div style="display:flex;gap:18px;padding:26px 40px 0;">
    <div style="flex:1;">${outlineBtn('Edit profile', { w: '100%', h: 96, fs: 30 })}</div>
    <div style="flex:1;">${ghostBtn('Invite friends', { h: 96, fs: 30 })}</div>
  </div>
  <div style="display:flex;gap:14px;padding:34px 40px 0;overflow:hidden;">
    ${[['Reposts', 3, false], ['Uploads', 38, true], ['Albums', 3, false], ['Playlists', 5, false]].map(([l, n, on]) => on ? outlineBtn(`${l} <span style="opacity:.7;font-weight:600;">${n}</span>`, { h: 74, fs: 26, pad: 28 }) : `<div style="height:74px;padding:0 28px;border-radius:999px;border:3px solid ${C.border};color:${C.sec};font-size:26px;font-weight:700;display:flex;align-items:center;gap:10px;white-space:nowrap;">${l} <span style="opacity:.6;">${n}</span></div>`).join('')}
  </div>
  <div style="padding:30px 0 0;">
    ${feedCard({ from: 'riya.wav', initials: 'R', hue: 285, title: 'Midnight Drive', creator: 'riya.wav', caption: `<span style="display:inline-flex;align-items:center;gap:10px;height:48px;padding:0 18px;border-radius:999px;background:rgba(139,61,255,0.15);color:${C.light};font-size:22px;font-weight:700;">feat. sam_beats · producer</span>`, kind: 'midnight', clip: '' })}
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;">${tabBar('user')}</div>`;

// small floating upload card (panel 5)
const uploadCard = () =>
  `<div style="width:620px;border-radius:44px;background:${C.surface};border:2px solid ${C.border};padding:36px 34px;display:flex;flex-direction:column;gap:26px;font-family:'Manrope',system-ui,sans-serif;color:${C.white};box-shadow:0 50px 120px rgba(0,0,0,0.7);">
     <div style="display:flex;align-items:center;gap:14px;font-size:34px;font-weight:800;">${I.upload(38, C.neon)}Upload</div>
     <div style="display:flex;gap:22px;align-items:center;">
       <div style="width:150px;height:150px;border-radius:28px;border:3px dashed ${C.neon};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:${C.neon};font-size:20px;font-weight:700;">${I.image(40, C.neon)}Cover</div>
       <div style="flex:1;display:flex;flex-direction:column;gap:14px;">
         <div style="height:84px;border-radius:26px;border:3px solid ${C.border};background:${C.inputBg};display:flex;align-items:center;padding:0 24px;font-size:28px;">Midnight Drive</div>
         <div style="height:84px;border-radius:26px;border:3px solid ${C.border};background:${C.inputBg};display:flex;align-items:center;padding:0 24px;font-size:26px;color:${C.sec};">night-drive-final-v3.wav</div>
       </div>
     </div>
     <div style="display:flex;flex-direction:column;gap:14px;"><div style="color:${C.sec};font-size:22px;font-weight:800;letter-spacing:0.1em;">COLLABORATORS</div>
       <div style="display:flex;gap:12px;flex-wrap:wrap;">
         ${[['SB', 195, 'sam_beats', 'producer'], ['K', 20, 'kabir', 'guitar']].map(([i, h, n, r]) => `<div style="display:flex;align-items:center;gap:12px;height:64px;padding:0 20px 0 6px;border-radius:999px;border:3px solid transparent;background:linear-gradient(${C.surface},${C.surface}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;font-size:24px;">${avatar(i, 48, h)}<b>${n}</b><span style="color:${C.sec};">· ${r}</span></div>`).join('')}
         <div style="display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;border:3px solid ${C.border};">${I.plus(30, C.sec)}</div>
       </div>
     </div>
     ${outlineBtn('Publish', { h: 92, fs: 30 })}
   </div>`;

const playerScreen = () => `
  <div style="position:absolute;inset:0;${ART.midnight}"></div>
  <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,15,0.25) 0%,rgba(10,10,15,0) 30%,rgba(10,10,15,0.55) 60%,rgba(10,10,15,0.96) 100%);"></div>
  <div style="position:absolute;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;padding:96px 40px 0;">
    ${I.chevDown(56, C.white)}<div style="font-size:30px;font-weight:700;">Midnight Drive</div>${outlineBtn('Repost', { h: 70, fs: 24, pad: 24, icon: I.repost(26, C.neon) })}
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;padding:0 40px 60px;display:flex;flex-direction:column;gap:30px;">
    <div style="display:flex;flex-direction:column;gap:8px;"><div style="font-size:48px;font-weight:800;letter-spacing:-0.02em;">Midnight Drive</div><div style="color:${C.light};font-size:30px;">riya.wav · feat. sam_beats</div></div>
    <div style="display:flex;align-items:center;justify-content:space-between;color:${C.white};font-size:26px;font-weight:600;">
      <div style="display:flex;gap:36px;"><div style="display:flex;align-items:center;gap:10px;">${I.heart(36, C.neon)}<span>412</span></div><div style="display:flex;align-items:center;gap:10px;">${I.chat(36, C.white)}<span>37</span></div></div>
      <div style="display:flex;align-items:center;gap:20px;height:60px;padding:0 24px;border-radius:999px;border:2px solid rgba(255,255,255,0.25);background:rgba(10,10,15,0.5);"><div style="display:flex;align-items:center;gap:8px;">${I.play(26, C.white)}12.8K</div><div style="width:2px;height:28px;background:rgba(255,255,255,0.25);"></div><div style="display:flex;align-items:center;gap:8px;">${I.repost(26, C.white)}64</div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:18px;">
      <div style="display:flex;justify-content:space-between;color:${C.white};font-size:24px;font-weight:600;"><span>1:42</span><span>3:56</span></div>
      ${progress(102 / 236, 700)}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;height:120px;padding:0 60px;border-radius:999px;background:rgba(18,18,28,0.85);border:2px solid ${C.border};">
      ${I.shuffle(46, C.white)}
      <div style="width:150px;height:150px;border-radius:50%;border:4px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:0 0 60px rgba(139,61,255,0.45);display:flex;align-items:center;justify-content:center;">${I.pause(70, C.white)}</div>
      ${I.repeat(46, C.neon)}
    </div>
    <div style="display:flex;gap:16px;">${['Lyrics', 'Queue', 'Info'].map((l, i) => i === 2 ? `<div style="flex:1;">${outlineBtn(l, { w: '100%', h: 84, fs: 28 })}</div>` : `<div style="flex:1;height:84px;border-radius:999px;background:rgba(18,18,28,0.85);border:2px solid ${C.border};display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;">${l}</div>`).join('')}</div>
    <div style="border-radius:36px;background:rgba(18,18,28,0.92);border:2px solid ${C.border};padding:26px 30px;display:flex;flex-direction:column;gap:18px;">
      <div style="color:${C.sec};font-size:22px;font-weight:800;letter-spacing:0.12em;">CREDITS</div>
      ${[['R', 285, 'riya.wav', 'artist · producer'], ['SB', 195, 'sam_beats', 'producer']].map(([i, h, n, r]) => `<div style="display:flex;align-items:center;gap:16px;font-size:26px;">${avatar(i, 56, h)}<b>${n}</b><span style="color:${C.sec};">${r}</span></div>`).join('')}
      <div style="display:flex;align-items:center;gap:14px;color:${C.light};font-size:26px;">${I.library(32, C.light)}From the album <b>Night Shift</b>${I.chev(28, C.light)}</div>
    </div>
  </div>`;

const lockCard = () =>
  `<div style="width:640px;border-radius:48px;padding:34px;background:linear-gradient(160deg,#24243A,#101018);border:2px solid rgba(255,255,255,0.08);box-shadow:0 50px 120px rgba(0,0,0,0.7);display:flex;flex-direction:column;gap:26px;font-family:'Manrope',system-ui,sans-serif;color:${C.white};">
     <div style="display:flex;align-items:center;gap:22px;">${cover('midnight', 110, 22)}<div style="display:flex;flex-direction:column;gap:6px;flex:1;"><div style="font-size:30px;font-weight:800;">Midnight Drive</div><div style="color:${C.sec};font-size:24px;">riya.wav · Livil</div></div>${I.lock(34, C.sec)}</div>
     <div style="display:flex;flex-direction:column;gap:14px;">${progress(0.62, 572, { thumb: false })}<div style="display:flex;justify-content:space-between;color:${C.sec};font-size:22px;"><span>0:09</span><span>-0:06</span></div></div>
     <div style="display:flex;align-items:center;justify-content:center;gap:70px;">${I.prev(56, C.white)}<div style="width:104px;height:104px;border-radius:50%;background:${C.white};display:flex;align-items:center;justify-content:center;">${I.pause(56, '#0A0A0F')}</div>${I.next(56, C.white)}</div>
   </div>`;

const playlistCard = () =>
  `<div style="width:560px;border-radius:44px;padding:30px;background:${C.surface};border:2px solid ${C.border};box-shadow:0 50px 120px rgba(0,0,0,0.7);display:flex;flex-direction:column;gap:24px;font-family:'Manrope',system-ui,sans-serif;color:${C.white};">
     <div style="display:flex;gap:22px;align-items:center;">${cover('late', 150, 30)}<div style="display:flex;flex-direction:column;gap:10px;"><div style="font-size:34px;font-weight:800;">late nights</div><div style="display:flex;align-items:center;gap:10px;color:${C.sec};font-size:24px;"><div style="display:flex;">${avatar('YOU', 40, 260)}<div style="margin-left:-12px;border:3px solid ${C.surface};border-radius:50%;">${avatar('N', 40, 330)}</div></div>you + nadia</div>${pill('Friends', { color: C.light })}</div></div>
     ${[['Low Tide', 'sam_beats', 'lowtide'], ['Midnight Drive', 'riya.wav', 'midnight'], ['Night Shift (intro)', 'riya.wav', 'night']].map(([t, a, k], i) => `<div style="display:flex;align-items:center;gap:18px;padding:12px 14px;border-radius:24px;${i === 0 ? 'background:rgba(139,61,255,0.15);' : ''}">${cover(k, 72, 16)}<div style="display:flex;flex-direction:column;gap:4px;flex:1;"><div style="font-size:26px;font-weight:700;">${t}</div><div style="color:${C.sec};font-size:22px;">${a}</div></div>${i === 0 ? bars(10, 5, 30, C.neon, { gap: 4, w: 4 }) : I.more(28, C.muted)}</div>`).join('')}
   </div>`;

// ================= PANELS =================
const P = {};
// 1 — "Press play here…"  (left half of diptych)
P.Panel1 = page('1', `
  ${glow(W, 1420, 1000, 820, 0.6)}
  ${pulseLine(`M-10 200 H520 L580 120 L640 260 L700 150 L740 200 H1060 L1160 40 L1320 200`)}
  ${headline([{ t: 'Press play ' }, { t: 'here', g: true }, { t: '…' }], '', { size: 140, top: SAFE_TOP + 110 })}
  <div style="position:absolute;left:100px;top:${SAFE_TOP + 470}px;color:${C.light};font-size:36px;font-weight:600;display:flex;align-items:center;gap:18px;">${I.crown(40, C.warning)}Your phone · hosting</div>
  <div style="position:absolute;left:280px;top:${SAFE_TOP + 600}px;">${phone(jamScreen({ host: true }), { tilt: -6 })}</div>
`);
// 2 — "…and it plays there."  (right half)
P.Panel2 = page('2', `
  ${glow(0, 1420, 1000, 820, 0.6)}
  ${pulseLine(`M0 200 L120 320 L220 200 H700 L760 110 L820 270 L880 200 H1330`)}
  ${headline([{ t: '…and it plays ' }, { t: 'there', g: true }, { t: '.' }], 'Jam Rooms keep everyone on the same beat — in real time.', { size: 140, top: SAFE_TOP + 110, align: 'left' })}
  <div style="position:absolute;left:100px;top:${SAFE_TOP + 640}px;color:${C.light};font-size:36px;font-weight:600;display:flex;align-items:center;gap:18px;">${I.users(40, C.neon)}Your friend's phone · same second</div>
  <div style="position:absolute;left:260px;top:${SAFE_TOP + 760}px;">${phone(jamScreen({ host: false }), { tilt: 6, h: 1560 })}</div>
`);
// 3 — presence
P.Panel3 = page('3', `
  ${glow(660, 1900, 900, 760, 0.5)}
  ${pulseLine(`M-10 200 H430 L480 130 L540 280 L600 160 L650 200 H1330`)}
  ${headline([{ t: 'See what your friends are playing. ' }, { t: 'Right now.', g: true }], 'Presence, not posts. Star people with taste and follow their listening live.', { size: 112, align: 'center', top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:256px;top:${SAFE_TOP + 720}px;">${phone(homeScreen())}</div>
`);
// 4 — clip
P.Panel4 = page('4', `
  ${glow(660, 1750, 820, 700, 0.62)}
  ${pulseLine(`M-10 200 H560 L610 60 L660 340 L710 90 L760 200 H1330`)}
  ${headline([{ t: 'Share the 15 seconds that gave you ' }, { t: 'chills', g: true }, { t: '.' }], 'Clip any moment. Repost it with your take, or post it as a Story.', { size: 112, align: 'center', top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:256px;top:${SAFE_TOP + 720}px;">${phone(repostScreen())}</div>
`);
// 5 — creators
P.Panel5 = page('5', `
  ${glow(120, 2500, 1000, 800, 0.55)}
  ${pulseLine(`M-10 200 H300 L350 120 L410 270 L470 150 L520 200 H1330`)}
  ${headline([{ t: 'Built for the people who ' }, { t: 'make', g: true }, { t: ' the music.' }], 'Upload audio or video. Credit your collaborators. Be heard by people who actually listen.', { size: 112, top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:120px;top:${SAFE_TOP + 720}px;">${phone(profileScreen())}</div>
  <div style="position:absolute;right:40px;top:${SAFE_TOP + 1700}px;transform:rotate(4deg);">${uploadCard()}</div>
`);
// 6 — everywhere + closer
P.Panel6 = page('6', `
  ${glow(1200, 2500, 1000, 800, 0.55)}
  ${pulseLine(`M-10 200 H520 L580 110 L640 280 L700 160 L740 200 H1330`)}
  ${headline([{ t: 'Your music. ' }, { t: 'Everywhere', g: true }, { t: ' you are.' }], 'Full-screen player with lyrics and credits. Lock-screen controls. Playlists you build with friends.', { size: 112, align: 'center', top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:-60px;top:${SAFE_TOP + 1000}px;transform:rotate(-8deg);">${lockCard()}</div>
  <div style="position:absolute;right:-70px;top:${SAFE_TOP + 940}px;transform:rotate(7deg);">${playlistCard()}</div>
  <div style="position:absolute;left:270px;top:${SAFE_TOP + 660}px;">${phone(playerScreen(), { h: 1330 })}</div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:560px;background:linear-gradient(180deg,rgba(10,10,15,0) 0%,rgba(10,10,15,0.95) 45%,${C.bg} 100%);"></div>
  <div style="position:absolute;left:0;right:0;bottom:${SAFE_TOP + 40}px;display:flex;flex-direction:column;align-items:center;gap:22px;">
    <div style="display:flex;align-items:center;gap:26px;"><div style="width:120px;height:120px;border-radius:34px;background:linear-gradient(135deg,${C.royal},${C.neon});display:flex;align-items:center;justify-content:center;box-shadow:0 0 70px rgba(139,61,255,0.5);"><svg width="86" height="86" viewBox="0 0 120 34" fill="none"><path d="${PULSE}" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div style="font-family:'Sora','Manrope',system-ui,sans-serif;font-size:110px;font-weight:800;letter-spacing:-0.04em;color:${C.white};">livil</div></div>
    <div style="font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-size:64px;letter-spacing:0.06em;background:linear-gradient(92deg,${C.royal},${C.neon});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:${C.neon};">Live · Vibe · Link</div>
    <div style="color:${C.sec};font-size:34px;font-weight:600;">Free to download</div>
  </div>
`);

writeFileSync('Main.dc.html', P.Panel1);
writeFileSync('Panel2.dc.html', P.Panel2);
writeFileSync('Panel3.dc.html', P.Panel3);
writeFileSync('Panel4.dc.html', P.Panel4);
writeFileSync('Panel5.dc.html', P.Panel5);
writeFileSync('Panel6.dc.html', P.Panel6);

const gap = 80;
const artboards = ['Main', 'Panel2', 'Panel3', 'Panel4', 'Panel5', 'Panel6'].map((f, i) => ({
  file: `${f}.dc.html`, title: `${i + 1} · ${['Press play here…', '…and it plays there.', 'Right now.', 'Chills', 'Makers', 'Everywhere'][i]}`,
  x: i * (W + gap), y: 0, w: W, h: H,
}));
writeFileSync('canvas.json', JSON.stringify({
  artboards,
  annotations: [
    { id: 'export-note', x: 0, y: -420, w: 620, text: 'Store export\n\nApple App Store: export each artboard as-is → 1320 × 2868 (iPhone 6.9").\n\nGoogle Play: crop each to the centre 1320 × 2347 (drop 260 px top and bottom), then scale to 1080 × 1920. Nothing important lives in those margins.\n\nPanels 1 + 2 are one scene split in two — keep them adjacent and in order.' },
    { id: 'cast-note', x: 700, y: -420, w: 520, text: 'Cast (same in every panel)\n\nriya.wav — creator, Jam host, owns Midnight Drive\nsam_beats — creator, owns Low Tide, credited as producer\nnadia — listener, reposts Low Tide, co-owns "late nights"\nyou — holding the phone in 2, 3, 4, 6\n\nBoth Jam phones read 1:42 / 3:56 on purpose.' },
  ],
  launch: { view: 'canvas' },
}, null, 2));
console.log('ok');
