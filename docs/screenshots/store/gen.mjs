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


// ---------- brand wordmark (docs/favicon.svg / src/components/Logo.tsx) ----------
const LOGO_D = `M2424 3932 c-49 -20 -104 -65 -104 -85 0 -8 -8 -25 -18 -38 -11 -13 -22 -47 -25 -76 -3 -29 -12 -62 -20 -75 -8 -13 -18 -54 -21 -92 -4 -38 -13 -80 -20 -95 -7 -14 -17 -57 -21 -94 -4 -38 -13 -83 -20 -100 -7 -18 -16 -59 -20 -92 -3 -33 -12 -78 -20 -100 -7 -22 -16 -60 -19 -85 -3 -25 -12 -74 -20 -110 -8 -36 -24 -112 -35 -170 -11 -58 -29 -152 -40 -210 -34 -173 -41 -212 -52 -280 -6 -36 -20 -101 -30 -145 -10 -45 -19 -103 -19 -131 0 -27 -9 -75 -20 -107 -11 -31 -20 -74 -20 -96 0 -53 -15 -60 -54 -22 -18 17 -36 31 -40 31 -4 0 -19 9 -33 20 -20 15 -41 20 -90 20 -103 0 -164 -42 -304 -209 -80 -94 -91 -97 -410 -105 -308 -9 -394 -24 -466 -82 -79 -64 -88 -179 -20 -254 62 -68 77 -73 261 -81 247 -11 714 -10 765 2 24 5 55 19 69 29 37 30 47 25 88 -38 21 -31 44 -64 51 -72 7 -8 33 -40 58 -71 64 -82 109 -113 193 -134 69 -18 75 -18 120 -2 26 9 54 17 62 17 26 0 150 140 150 169 0 14 9 41 20 59 14 22 20 50 20 88 0 30 7 71 16 92 10 22 20 81 24 147 4 71 12 121 23 142 12 23 17 58 17 125 0 93 10 132 28 113 16 -17 52 -208 52 -276 0 -35 8 -96 19 -134 10 -39 21 -106 25 -150 3 -44 12 -98 20 -120 9 -22 15 -56 15 -75 1 -43 37 -198 62 -262 11 -26 19 -53 19 -61 0 -29 61 -137 98 -173 117 -115 275 -109 416 17 54 48 191 221 208 261 4 9 23 39 42 67 20 28 36 55 36 61 0 5 8 17 19 27 10 10 22 29 26 43 4 14 11 27 16 30 4 3 21 30 37 60 36 68 56 71 60 11 2 -25 12 -56 23 -69 10 -14 19 -30 19 -36 0 -19 94 -109 141 -135 41 -23 53 -25 196 -24 139 1 154 2 179 22 15 11 33 21 40 21 29 0 165 104 244 188 94 99 149 169 186 240 14 26 31 50 39 55 8 4 15 21 15 37 0 16 5 32 11 36 14 8 68 -55 69 -82 0 -11 9 -29 20 -39 11 -10 20 -26 20 -35 0 -9 9 -25 20 -35 11 -10 20 -26 20 -36 0 -10 4 -20 9 -24 6 -3 29 -40 53 -81 146 -257 269 -414 335 -430 16 -4 38 -14 50 -21 51 -34 200 2 262 63 19 18 38 34 42 34 4 0 47 46 95 102 49 56 108 122 130 147 23 26 59 69 79 96 21 28 51 64 67 80 16 17 59 69 96 117 87 113 95 112 103 -17 12 -207 81 -340 212 -410 42 -22 60 -25 150 -25 70 0 109 4 122 14 11 7 31 17 44 21 59 18 196 130 306 251 50 54 97 105 105 114 9 8 28 37 43 63 41 70 57 63 57 -25 1 -51 7 -85 20 -113 11 -22 19 -52 20 -66 0 -15 9 -38 20 -52 11 -14 20 -30 20 -36 0 -21 120 -129 149 -136 16 -3 35 -13 42 -21 9 -11 47 -14 193 -14 164 0 184 2 211 20 17 11 40 20 52 20 22 0 143 60 211 106 21 13 46 30 56 37 11 6 48 36 83 65 61 51 83 58 83 27 0 -8 9 -29 20 -47 11 -18 20 -46 20 -63 0 -16 9 -43 20 -60 11 -16 20 -40 20 -53 0 -12 9 -39 20 -59 11 -21 20 -43 20 -49 0 -12 87 -186 115 -229 53 -82 150 -145 225 -145 94 0 198 82 236 187 34 94 134 561 134 629 0 31 20 94 30 94 5 0 14 -17 19 -37 12 -44 69 -108 126 -141 64 -38 158 -42 736 -33 534 8 534 8 589 33 88 41 114 75 118 159 7 114 -26 160 -138 199 -62 21 -87 22 -495 29 -316 5 -436 10 -453 20 -30 16 -42 50 -42 117 0 30 -6 87 -14 127 -8 40 -19 137 -26 216 -6 79 -13 148 -17 154 -3 5 -12 111 -19 234 -8 124 -18 241 -23 261 -6 20 -13 118 -16 217 -4 99 -13 221 -21 270 -8 50 -18 178 -21 285 -3 140 -10 218 -24 276 -10 45 -19 95 -19 111 0 59 -78 136 -155 153 -76 17 -142 -1 -192 -53 -48 -49 -93 -141 -93 -189 0 -19 -9 -59 -20 -91 -11 -31 -20 -79 -20 -107 0 -28 -9 -76 -20 -107 -13 -36 -20 -83 -20 -128 0 -48 -7 -84 -20 -114 -14 -30 -20 -65 -20 -117 0 -50 -6 -90 -20 -124 -14 -36 -20 -74 -20 -130 0 -56 -6 -94 -20 -130 -14 -35 -20 -75 -20 -128 -1 -43 -7 -94 -16 -117 -8 -22 -19 -90 -24 -151 -4 -62 -14 -122 -20 -134 -7 -13 -16 -73 -21 -134 -10 -117 -32 -196 -54 -196 -8 0 -23 14 -35 30 -12 17 -28 30 -37 30 -8 0 -26 9 -40 20 -36 28 -125 28 -160 0 -14 -11 -34 -20 -45 -20 -12 0 -105 -86 -246 -229 -125 -126 -243 -237 -262 -246 -18 -10 -40 -24 -48 -31 -17 -17 -46 -18 -60 -1 -7 7 -12 126 -14 317 -4 303 -15 400 -49 460 -5 8 -16 29 -25 45 -9 17 -33 44 -55 60 -21 17 -38 34 -39 39 0 5 20 26 45 48 27 24 45 48 45 61 0 12 9 36 20 52 27 41 27 129 0 170 -11 17 -20 39 -20 50 0 31 -102 120 -155 135 -146 41 -262 -14 -329 -155 -43 -91 -49 -170 -16 -220 11 -16 20 -37 20 -46 0 -8 18 -31 40 -50 22 -19 40 -39 40 -46 0 -6 -22 -27 -48 -46 -68 -48 -159 -157 -240 -285 -15 -24 -47 -70 -72 -102 -25 -32 -80 -106 -123 -164 -43 -58 -84 -106 -92 -106 -10 0 -14 37 -19 158 -12 292 -32 420 -74 483 -41 60 -76 83 -149 98 -58 13 -78 12 -162 -5 -67 -13 -149 -81 -278 -228 -58 -67 -113 -126 -121 -133 -8 -6 -37 -43 -66 -81 -28 -39 -78 -101 -111 -139 -33 -38 -91 -107 -130 -153 -38 -45 -85 -99 -104 -119 -18 -20 -40 -46 -48 -59 -9 -12 -23 -22 -33 -22 -18 0 -50 30 -50 46 0 5 -15 32 -32 59 -18 28 -39 61 -46 75 -7 14 -24 43 -37 65 -14 22 -34 58 -45 80 -11 22 -31 58 -45 80 -13 22 -29 49 -35 60 -6 11 -22 38 -35 60 -14 22 -32 54 -41 70 -8 17 -26 48 -39 70 -13 22 -33 56 -44 75 -121 220 -366 272 -512 109 -31 -34 -89 -151 -89 -177 0 -10 -9 -43 -20 -75 -11 -31 -20 -67 -20 -79 -1 -13 -9 -41 -20 -63 -11 -22 -19 -49 -20 -60 0 -11 -9 -35 -20 -53 -11 -18 -20 -41 -20 -51 0 -10 -9 -30 -20 -44 -11 -14 -20 -32 -20 -40 0 -7 -9 -22 -20 -32 -11 -10 -20 -26 -20 -35 0 -22 -28 -46 -39 -34 -10 11 -29 235 -37 454 -6 139 -10 169 -26 189 -10 13 -18 29 -18 35 0 6 -26 34 -57 62 -49 45 -55 54 -44 68 8 9 19 16 26 16 21 0 66 68 82 123 26 90 26 105 2 179 -59 183 -253 256 -406 152 -40 -27 -83 -77 -83 -97 0 -8 -9 -26 -20 -40 -29 -37 -29 -177 0 -214 11 -14 20 -31 20 -38 0 -7 18 -29 40 -49 49 -44 50 -59 7 -87 -18 -12 -44 -37 -57 -56 -14 -19 -35 -47 -47 -63 -13 -15 -23 -35 -23 -43 0 -8 -9 -26 -20 -40 -11 -14 -20 -32 -20 -40 0 -8 -9 -26 -20 -40 -11 -14 -20 -30 -20 -35 0 -6 -11 -32 -24 -59 -82 -166 -192 -379 -221 -428 -13 -22 -29 -49 -34 -60 -6 -11 -22 -33 -36 -50 -32 -38 -45 -23 -45 51 0 28 -9 80 -20 114 -12 36 -20 90 -20 129 0 38 -9 93 -20 129 -13 42 -20 92 -20 147 0 61 -5 94 -20 126 -15 34 -20 66 -20 140 0 69 -6 112 -20 154 -14 41 -20 84 -20 147 0 58 -7 113 -20 160 -13 48 -20 103 -20 164 0 58 -7 120 -20 170 -12 47 -20 113 -20 164 0 47 -7 110 -15 140 -9 30 -20 116 -25 190 -5 74 -14 150 -19 168 -6 18 -13 65 -16 105 -17 189 -155 299 -301 239z`;
const wordmark = (w, color = C.white) => `<svg width="${w}" height="${Math.round(w * 436 / 1116)}" viewBox="0 0 1116 436"><g transform="translate(0,436) scale(0.1,-0.1)"><path d="${LOGO_D}" fill="${color}"/></g></svg>`;

// floating player: the centred orb with a progress ring and the wave running through it
const orb = (pct = 0.35, { size = 132, playing = true, wave = true, bottom = 330 } = {}) => {
  const ringEl = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:conic-gradient(from 0deg,${C.neon} 0 ${Math.round(pct * 100)}%,#4E5470 ${Math.round(pct * 100)}% 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);"><div style="width:${size - 14}px;height:${size - 14}px;border-radius:50%;background:${C.bg};display:flex;align-items:center;justify-content:center;">${playing ? I.pause(Math.round(size * 0.4), C.white) : I.play(Math.round(size * 0.44), C.white)}</div></div>`;
  const line = (flip) => `<svg width="120" height="50" viewBox="0 0 120 50" fill="none" style="${flip ? 'transform:scaleX(-1);' : ''}"><path d="${wave ? 'M0 25 C 20 25, 28 8, 50 8 S 78 42, 100 42 S 116 25, 120 25' : 'M0 25 H120'}" stroke="${C.white}" stroke-width="4" stroke-linecap="round"/></svg>`;
  return `<div style="position:absolute;left:0;right:0;bottom:${bottom}px;display:flex;align-items:center;justify-content:center;gap:0;">${line(false)}${ringEl}${line(true)}</div>`;
};
// the WaveformScrubber: rounded outlined track, bars inside, clip handles at the ends
const scrubber = (w, { pct = 0.4, seed = 5, clip = true, bars: n = 46, h = 44 } = {}) =>
  `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:${w}px;">
     ${clip ? `<div style="position:absolute;left:0;top:50%;transform:translateY(-50%);">${bars(8, seed + 1, Math.round(h * 0.5), 'rgba(255,255,255,0.18)', { from: 2, to: 3, dim: 'rgba(255,255,255,0.18)', gap: 6, w: 5 })}</div><div style="position:absolute;right:0;top:50%;transform:translateY(-50%);">${bars(6, seed + 2, Math.round(h * 0.5), 'rgba(255,255,255,0.18)', { from: 2, to: 3, dim: 'rgba(255,255,255,0.18)', gap: 6, w: 5 })}</div>` : ''}
     <div style="position:relative;display:flex;align-items:center;gap:0;padding:10px 24px;border-radius:999px;border:3px solid rgba(139,61,255,0.45);background:rgba(18,18,28,0.9);width:${clip ? w - 150 : w}px;box-sizing:border-box;">
       ${bars(n, seed, h, C.neon, { from: 0, to: pct, dim: 'rgba(255,255,255,0.5)', gap: 6, w: 6 })}
       ${clip ? `<div style="position:absolute;left:-16px;top:50%;transform:translateY(-50%);width:20px;height:56px;border-radius:10px;background:${C.white};display:flex;align-items:center;justify-content:center;"><div style="width:6px;height:30px;border-radius:3px;background:${C.bg};"></div></div><div style="position:absolute;right:-16px;top:50%;transform:translateY(-50%);width:20px;height:56px;border-radius:10px;background:${C.white};display:flex;align-items:center;justify-content:center;"><div style="width:6px;height:30px;border-radius:4px;background:${C.bg};"></div></div>` : ''}
     </div>
   </div>`;
const timesRow = (a, b, c, w) => `<div style="display:flex;justify-content:space-between;align-items:baseline;width:${w}px;color:${C.white};font-size:26px;font-weight:600;"><span>${a}</span><span style="color:${C.neon};font-weight:800;">${b}</span><span>${c}</span></div>`;
const ring = (inner, size, { width = 5, color = C.purple } = {}) => `<div style="width:${size}px;height:${size}px;border-radius:50%;border:${width}px solid ${color};display:flex;align-items:center;justify-content:center;background:${C.bg};">${inner}</div>`;
const initialsAv = (txt, size, hue) => `<div style="width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:hsl(${hue} 45% 20%);color:${C.light};font-weight:800;font-size:${Math.round(size * 0.34)}px;letter-spacing:0.04em;">${txt}</div>`;
// the app's "outlined + glow" primary as it renders today: dark fill, gradient border, inner bloom
const primaryBtn = (label, { w = 'auto', h = 96, fs = 30, pad = 44, icon = '' } = {}) =>
  `<div style="display:flex;align-items:center;justify-content:center;gap:16px;height:${h}px;width:${w};padding:0 ${pad}px;border-radius:32px;border:3px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:inset 0 0 28px rgba(139,61,255,0.45),0 0 26px rgba(139,61,255,0.25);color:${C.neon};font-weight:800;font-size:${fs}px;white-space:nowrap;flex-shrink:0;">${icon}<span style="white-space:nowrap;">${label}</span></div>`;
const secondaryBtn = (label, { w = 'auto', h = 96, fs = 30, pad = 44, icon = '' } = {}) =>
  `<div style="display:flex;align-items:center;justify-content:center;gap:16px;height:${h}px;width:${w};padding:0 ${pad}px;border-radius:32px;border:3px solid ${C.border};color:${C.white};font-weight:800;font-size:${fs}px;">${icon}<span>${label}</span></div>`;

// ================= SCREENS =================

const avatarStack = (sz = 64) => `<div style="display:flex;align-items:center;">${[['R', 285], ['SB', 195], ['K', 20]].map(([i, h], k) => `<div style="margin-left:${k ? -Math.round(sz * 0.3) : 0}px;border-radius:50%;border:4px solid ${C.bg};">${avatar(i, sz, h)}</div>`).join('')}</div>`;

const jamHeader = (host) =>
  `<div style="display:flex;align-items:center;justify-content:space-between;padding:96px 40px 26px 40px;border-bottom:2px solid ${C.border};">
     <div style="display:flex;align-items:center;gap:22px;">${I.back(56, C.neon)}<div style="display:flex;flex-direction:column;gap:6px;"><div style="font-size:32px;font-weight:800;">Jam Room</div><div style="display:flex;align-items:center;gap:10px;color:${C.sec};font-size:24px;">${host ? `${I.crown(28, C.warning)}<span>You are the host</span>` : `${I.crown(28, C.warning)}<span>Host: @riya.wav</span>`}</div></div></div>
     ${host ? `<div style="height:48px;padding:0 24px;border-radius:16px;border:3px solid ${C.error};color:${C.error};font-weight:800;font-size:26px;display:flex;align-items:center;">End</div>` : `<div style="height:48px;padding:0 24px;border-radius:16px;border:3px solid ${C.error};color:${C.error};font-weight:800;font-size:26px;display:flex;align-items:center;">Leave</div>`}
   </div>`;
const bubble = (text, { me = false, name = '' } = {}) =>
  `<div style="display:flex;justify-content:${me ? 'flex-end' : 'flex-start'};"><div style="max-width:560px;padding:${name ? '14px 26px 18px' : '18px 26px'};border-radius:28px;${me ? `border-bottom-right-radius:12px;background:${C.purple};` : `border-bottom-left-radius:12px;background:${C.card};`}display:flex;flex-direction:column;gap:4px;">${name ? `<div style="color:${C.neon};font-size:24px;font-weight:700;">${name}</div>` : ''}<div style="font-size:30px;line-height:1.3;">${text}</div></div></div>`;
const segmented = (which) =>
  `<div style="margin:0 40px;display:flex;padding:8px;border-radius:40px;background:${C.surface};gap:8px;">${['Chat', 'Queue'].map((l, i) => `<div style="flex:1;height:72px;border-radius:30px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;${i === which ? `border:3px solid transparent;background:linear-gradient(${C.surface},${C.surface}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:inset 0 0 22px rgba(139,61,255,0.4);color:${C.neon};` : `color:${C.sec};`}">${l}</div>`).join('')}</div>`;
const msgInput = () =>
  `<div style="position:absolute;left:0;right:0;bottom:0;padding:22px 40px 56px;display:flex;gap:18px;align-items:center;background:${C.bg};border-top:2px solid ${C.border};">
     <div style="flex:1;height:84px;border-radius:28px;border:3px solid ${C.border};background:${C.inputBg};display:flex;align-items:center;padding:0 30px;color:${C.muted};font-size:28px;">Message…</div>
     <div style="width:76px;height:76px;border-radius:50%;border:3px solid ${C.neon};display:flex;align-items:center;justify-content:center;">${I.send(36, C.neon)}</div>
   </div>`;
const queueRow = (kind, t, a, { now = false } = {}) =>
  `<div style="display:flex;align-items:center;gap:22px;padding:18px 40px;${now ? 'background:rgba(139,61,255,0.10);' : ''}">${cover(kind, 96, 18)}<div style="display:flex;flex-direction:column;gap:6px;flex:1;"><div style="font-size:30px;font-weight:800;color:${now ? C.light : C.white};">${t}</div><div style="color:${C.sec};font-size:24px;">${a}</div></div>${now ? bars(3, 2, 30, C.neon, { gap: 5, w: 6 }) : ''}</div>`;
const listeners = (n) =>
  `<div style="display:flex;justify-content:center;align-items:center;">${[['R', 285], ['SB', 195], ['N', 330], ['K', 20]].slice(0, n).map(([i, h], k) => `<div style="margin-left:${k ? -14 : 0}px;border-radius:50%;border:5px solid ${C.bg};">${avatar(i, 64, h, { dot: true })}</div>`).join('')}</div>`;

const jamScreen = ({ host }) => {
  const pct = 102 / 236;
  return `
  ${jamHeader(host)}
  <div style="display:flex;flex-direction:column;align-items:center;gap:22px;padding:34px 40px 0;">
    ${cover('midnight', 220, 24)}
    <div style="text-align:center;display:flex;flex-direction:column;gap:6px;"><div style="font-size:30px;font-weight:800;">Midnight Drive</div><div style="color:${C.sec};font-size:24px;">riya.wav</div></div>
    ${timesRow('0:00', '1:42', '3:56', 700)}
    ${bars(52, 9, 90, C.neon, { from: 0, to: pct, dim: 'rgba(255,255,255,0.45)', gap: 7, w: 7 })}
    <div style="width:104px;height:104px;border-radius:50%;border:4px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:0 0 50px rgba(139,61,255,0.35),inset 0 0 26px rgba(139,61,255,0.45);display:flex;align-items:center;justify-content:center;${host ? '' : 'display:none;'}">${I.pause(50, C.neon)}</div>
    ${listeners(4)}
  </div>
  <div style="height:2px;background:${C.border};margin:26px 0 22px;"></div>
  ${segmented(host ? 0 : 1)}
  ${host
    ? `<div style="display:flex;flex-direction:column;gap:16px;padding:26px 30px 0;">${bubble('this drop 🔥', { name: 'sam_beats' })}${bubble('wait for 2:10', { name: 'nadia' })}${bubble('looping it 🔁', { me: true })}</div>${msgInput()}`
    : `<div style="display:flex;flex-direction:column;padding-top:20px;">${queueRow('midnight', 'Midnight Drive', 'riya.wav', { now: true })}${queueRow('lowtide', 'Low Tide', 'sam_beats')}${queueRow('night', 'Night Shift (intro)', 'riya.wav')}${queueRow('late', 'Golden Hour', 'kabir')}</div>`}`;
};

const homeHeader = () =>
  `<div style="display:flex;align-items:center;justify-content:space-between;padding:84px 34px 22px 40px;border-bottom:2px solid ${C.border};">
     ${wordmark(192)}
     <div style="display:flex;gap:16px;align-items:center;">
       <div style="width:76px;height:76px;border-radius:50%;border:3px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:inset 0 0 20px rgba(139,61,255,0.5);display:flex;align-items:center;justify-content:center;">${I.plus(40, C.neon)}</div>
       <div style="position:relative;width:76px;height:76px;border-radius:50%;border:3px solid ${C.border};display:flex;align-items:center;justify-content:center;">${I.send(36, C.white)}<div style="position:absolute;top:-6px;right:-6px;min-width:32px;height:32px;border-radius:16px;background:${C.purple};color:${C.white};font-size:20px;font-weight:800;display:flex;align-items:center;justify-content:center;">2</div></div>
     </div>
   </div>`;

const feedCard = ({ reposter, from, initials, hue, title, caption, kind, cur, end, upload = false, credits = '', active = false }) =>
  `<div style="margin:0 30px;border-radius:38px;background:${C.surface};border:2px solid ${C.border};overflow:hidden;display:flex;flex-direction:column;">
     ${upload ? '' : `<div style="display:flex;align-items:center;justify-content:space-between;padding:22px 30px;background:#161628;">
       <div style="display:flex;align-items:center;gap:12px;font-size:26px;">${I.repost(30, C.neon)}<span><b>${reposter}</b> <span style="color:${C.sec};">reposted</span></span></div>
       <div style="display:flex;align-items:center;gap:12px;height:56px;padding:0 24px;border-radius:999px;border:2px solid rgba(34,211,238,0.55);color:${C.info};font-size:20px;font-weight:800;letter-spacing:0.14em;">CREATOR <span style="letter-spacing:0;">@${from}</span></div>
     </div>`}
     <div style="padding:26px 30px 30px;display:flex;flex-direction:column;gap:22px;">
       <div style="display:flex;align-items:center;justify-content:space-between;">
         <div style="display:flex;align-items:center;gap:18px;">${ring(initialsAv(initials, 74, hue), 84)}<div style="display:flex;flex-direction:column;gap:4px;"><div style="font-size:30px;font-weight:800;">${reposter}</div><div style="color:${C.sec};font-size:24px;">@${upload ? from : reposter.toLowerCase()} · 2h</div></div></div>
         <div style="display:flex;align-items:center;gap:14px;">${primaryBtn('Repost', { h: 62, fs: 25, pad: 24, icon: I.repost(24, C.neon) })}<div style="width:62px;height:62px;border-radius:50%;background:${C.card};display:flex;align-items:center;justify-content:center;">${I.more(32, C.sec)}</div></div>
       </div>
       <div style="font-size:34px;font-weight:800;">${title}</div>
       ${caption ? `<div style="color:${C.light};font-size:28px;line-height:1.35;">${caption}</div>` : ''}
       ${credits ? `<div style="display:flex;align-items:center;gap:14px;font-size:24px;color:${C.sec};">${avatarStack(44)}<span>with <b style="color:${C.white};">${credits}</b></span></div>` : ''}
       ${cover(kind, 680, 34, active ? '' : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"><div style="width:150px;height:150px;border-radius:50%;border:3px solid rgba(255,255,255,0.45);display:flex;align-items:center;justify-content:center;">${I.play(70, C.white)}</div></div>`)}
       ${upload ? `<div style="display:flex;justify-content:flex-end;color:${C.sec};font-size:22px;font-weight:600;">${end}</div>` : `<div style="display:flex;flex-direction:column;gap:14px;">
         <div style="display:flex;justify-content:space-between;color:${C.sec};font-size:22px;font-weight:600;"><span>0:48</span><span>1:03</span></div>
         ${scrubber(680, { pct: cur, clip: false, bars: 50, h: 40 })}
       </div>`}
       <div style="display:flex;align-items:center;gap:34px;color:${C.sec};font-size:26px;font-weight:600;"><div style="width:80px;height:80px;border-radius:50%;border:3px solid transparent;background:linear-gradient(${C.surface},${C.surface}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;display:flex;align-items:center;justify-content:center;">${I.play(38, C.neon)}</div><div style="display:flex;align-items:center;gap:10px;">${I.heart(34, C.neon)}<span>${upload ? '412' : '128'}</span></div><div style="display:flex;align-items:center;gap:10px;">${I.chat(34, C.sec)}<span>${upload ? '37' : '14'}</span></div>${upload ? `<div style="display:flex;align-items:center;gap:10px;">${I.repost(32, C.sec)}<span>64</span></div><div style="flex:1;"></div><div style="width:80px;height:80px;border-radius:50%;border:3px solid transparent;background:linear-gradient(${C.surface},${C.surface}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;display:flex;align-items:center;justify-content:center;">${I.send(36, C.neon)}</div>` : ''}</div>
     </div>
   </div>`;

const homeScreen = () => `
  ${homeHeader()}
  <div style="padding:26px 40px 0;display:flex;flex-direction:column;gap:20px;">
    <div style="font-size:34px;font-weight:800;">Friends</div>
    <div style="display:flex;gap:24px;">
      ${[['R', 285, 'riya.wav', true], ['SB', 195, 'sam_beats', true], ['N', 330, 'nadia', true], ['K', 20, 'kabir', false], ['AJ', 120, 'aj.mp3', false]].map(([i, h, n, u]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;width:132px;">${u ? avatar(i, 118, h, { ring: true }) : `<div style="padding:10px;border-radius:50%;border:4px solid ${C.border};">${avatar(i, 118, h)}</div>`}<div style="color:${C.sec};font-size:22px;white-space:nowrap;">@${n}</div></div>`).join('')}
    </div>
  </div>
  <div style="padding:44px 40px 22px;display:flex;flex-direction:column;gap:8px;"><div style="font-size:44px;font-weight:800;letter-spacing:-0.02em;">For you</div><div style="color:${C.sec};font-size:26px;line-height:1.35;">Mutual friends first, people you star next, then what's trending.</div></div>
  ${feedCard({ reposter: 'nadia', from: 'sam_beats', initials: 'N', hue: 330, title: 'Low Tide', caption: 'the bridge in this is insane', kind: 'lowtide', cur: 0.3, end: '4:12', active: true })}
  ${orb(0.3, { bottom: 210 })}
  <div style="position:absolute;left:0;right:0;bottom:0;">${tabBar('home')}</div>`;

const sectionLabel = (t, right = '') => `<div style="display:flex;justify-content:space-between;align-items:center;"><div style="color:${C.sec};font-size:22px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;">${t}</div>${right ? `<div style="color:${C.neon};font-size:24px;font-weight:700;">${right}</div>` : ''}</div>`;
const modeCard = (t, sub, on) => `<div style="flex:1;padding:20px 24px;border-radius:24px;display:flex;flex-direction:column;gap:6px;${on ? `border:3px solid transparent;background:linear-gradient(${C.bg},${C.bg}) padding-box,linear-gradient(135deg,${C.deep},${C.neon}) border-box;box-shadow:inset 0 0 24px rgba(139,61,255,0.4);` : `border:3px solid ${C.border};`}"><div style="font-size:28px;font-weight:800;color:${on ? C.neon : C.white};">${t}</div><div style="font-size:22px;color:${on ? C.neon : C.sec};">${sub}</div></div>`;
const repostScreen = () => `
  <div style="display:flex;align-items:center;justify-content:space-between;padding:96px 40px 30px;">
    <div style="color:${C.sec};font-size:28px;width:120px;">Cancel</div><div style="font-size:38px;font-weight:800;">Repost</div><div style="width:120px;"></div>
  </div>
  <div style="padding:0 40px;display:flex;flex-direction:column;gap:44px;">
    <div style="display:flex;flex-direction:column;gap:18px;">${sectionLabel('Share as')}<div style="display:flex;gap:16px;">${modeCard('Post', 'Stays on your profile', true)}${modeCard('Story (10s)', 'Disappears after 24h', false)}</div></div>
    <div style="display:flex;flex-direction:column;gap:18px;">${sectionLabel('Track')}
      <div style="display:flex;align-items:center;gap:22px;padding:22px;border-radius:36px;background:${C.surface};border:2px solid ${C.border};">${cover('lowtide', 120, 24, `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">${I.play(44, C.white)}</div>`)}<div style="display:flex;flex-direction:column;gap:6px;"><div style="font-size:32px;font-weight:800;">Low Tide</div><div style="color:${C.light};font-size:26px;font-weight:700;">@sam_beats</div></div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:22px;align-items:center;">
      <div style="width:100%;">${sectionLabel('Clip', 'Use full song')}</div>
      ${timesRow('0:48', '0:55', '1:03', 700)}
      ${scrubber(700, { pct: 0.45, seed: 11, clip: true, bars: 40, h: 64 })}
    </div>
    <div style="display:flex;flex-direction:column;gap:18px;">${sectionLabel('Description')}
      <div style="min-height:180px;border-radius:26px;border:3px solid ${C.neon};background:${C.inputBg};padding:26px 30px;font-size:30px;line-height:1.35;color:${C.white};box-shadow:0 0 0 6px rgba(139,61,255,0.18);">the bridge in this is insane<span style="display:inline-block;width:3px;height:34px;background:${C.neon};vertical-align:-6px;margin-left:2px;"></span></div>
    </div>
  </div>
  <div style="position:absolute;left:40px;right:40px;bottom:64px;">${primaryBtn('Repost', { h: 96, fs: 30 })}</div>`;

const profileScreen = () => `
  <div style="display:flex;align-items:center;justify-content:space-between;padding:88px 40px 10px;">
    <div style="font-size:44px;font-weight:800;letter-spacing:-0.03em;">livil</div>${ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>', 50, C.white)}
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 40px 0;">
    <div style="width:270px;height:270px;border-radius:50%;background:${C.deepest};display:flex;align-items:center;justify-content:center;">${avatar('R', 210, 285)}</div>
    <div style="font-size:44px;font-weight:800;margin-top:6px;">Riya</div>
    <div style="color:${C.light};font-size:30px;font-weight:700;">@riya.wav</div>
    <div style="color:${C.sec};font-size:28px;">bedroom producer · Mumbai</div>
    <div style="display:flex;align-items:center;gap:12px;height:48px;padding:0 20px;border-radius:16px;border:2px solid ${C.border};color:${C.light};font-size:22px;font-weight:700;">${ic('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"/>', 26, C.light)}riya.bandcamp.com</div>
  </div>
  <div style="margin:30px 40px 0;display:flex;border-radius:36px;background:${C.surface};border:2px solid ${C.border};padding:22px 0;">
    ${[['2.4K', 'FANS'], ['38', 'FRIENDS'], ['16', 'STARS']].map(([n, l], i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;${i ? `border-left:2px solid ${C.border};` : ''}"><div style="font-size:40px;font-weight:800;">${n}</div><div style="color:${C.sec};font-size:22px;font-weight:800;letter-spacing:0.16em;">${l}</div></div>`).join('')}
  </div>
  <div style="text-align:center;color:${C.sec};font-size:28px;padding:24px 0 0;"><b style="color:${C.white};">41</b> posts · <b style="color:${C.white};">38</b> uploads</div>
  <div style="padding:24px 40px 0;">${secondaryBtn('Invite friends', { w: '100%', h: 82, fs: 30 })}</div>
  <div style="display:flex;gap:14px;padding:30px 40px 0;overflow:hidden;">
    ${[['Uploads', 38, true], ['Reposts', 3, false], ['Albums', 3, false], ['Playlists', 5, false]].map(([l, n, on]) => on ? primaryBtn(`${l} <span style="opacity:.7;font-weight:600;margin-left:8px;">${n}</span>`, { h: 58, fs: 26, pad: 26 }) : `<div style="height:58px;padding:0 26px;border-radius:20px;border:3px solid ${C.border};color:${C.white};font-size:26px;font-weight:700;display:flex;align-items:center;gap:10px;white-space:nowrap;">${l} <span style="color:${C.sec};">${n}</span></div>`).join('')}
  </div>
  <div style="padding:30px 6px 0;">${feedCard({ reposter: 'Riya', from: 'riya.wav', initials: 'R', hue: 285, title: 'Midnight Drive', caption: '', kind: 'midnight', cur: 0, end: '3:56', upload: true, credits: 'sam_beats &amp; kabir' })}</div>
  <div style="position:absolute;left:0;right:0;bottom:0;">${tabBar('user')}</div>`;

const fileRow = (name, req, filled) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:2px solid ${C.border};"><div style="display:flex;flex-direction:column;gap:4px;"><div style="font-size:26px;font-weight:800;">${name} <span style="color:${C.neon};">*</span></div><div style="font-size:20px;color:${C.sec};">${req}</div></div>${filled ? secondaryBtn('Change', { h: 56, fs: 22, pad: 22 }) : primaryBtn('Choose', { h: 56, fs: 22, pad: 22 })}</div>`;
const uploadCard = () =>
  `<div style="width:640px;border-radius:44px;background:${C.bg};border:2px solid ${C.border};padding:34px 34px 30px;display:flex;flex-direction:column;gap:26px;font-family:'Manrope',system-ui,sans-serif;color:${C.white};box-shadow:0 50px 120px rgba(0,0,0,0.75);">
     <div style="display:flex;align-items:center;justify-content:space-between;"><div style="color:${C.sec};font-size:24px;">Cancel</div><div style="font-size:32px;font-weight:800;">New track</div><div style="width:80px;"></div></div>
     <div style="display:flex;flex-direction:column;">${sectionLabel('Files')}${fileRow('Audio', 'Required · mp3, wav, m4a, flac, ogg', true)}${fileRow('Cover image', 'Required · jpg, png, webp', true)}</div>
     <div style="display:flex;flex-direction:column;gap:14px;">${sectionLabel('Track details')}<div style="height:84px;border-radius:26px;border:3px solid ${C.border};background:${C.inputBg};display:flex;align-items:center;padding:0 24px;font-size:28px;">Midnight Drive</div></div>
     <div style="display:flex;flex-direction:column;gap:14px;">${sectionLabel('Collaborators', '+ Add')}
       <div style="display:flex;gap:12px;flex-wrap:wrap;">
         ${[['SB', 195, 'sam_beats', 'Producer'], ['K', 20, 'kabir', 'Guitar']].map(([i, h, n, r]) => `<div style="display:flex;align-items:center;gap:12px;height:64px;padding:0 20px 0 6px;border-radius:999px;border:3px solid ${C.border};font-size:24px;">${avatar(i, 48, h)}<b>${n}</b><span style="color:${C.sec};">· ${r}</span>${I.x(22, C.sec)}</div>`).join('')}
       </div>
     </div>
     ${primaryBtn('Post track', { h: 92, fs: 30 })}
   </div>`;

const playerScreen = () => `
  <div style="position:absolute;inset:0;background:radial-gradient(60% 40% at 50% 34%,rgba(76,29,149,0.85),rgba(10,10,15,0) 70%),${C.bg};"></div>
  <div style="position:absolute;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;padding:90px 40px 0;">
    ${I.chevDown(56, C.white)}<div style="display:flex;align-items:center;gap:22px;"><div style="display:flex;align-items:center;gap:10px;height:46px;padding:0 22px;border-radius:999px;background:rgba(139,61,255,0.15);border:2px solid rgba(139,61,255,0.3);color:${C.light};font-size:22px;font-weight:700;">${I.repost(22, C.light)}Repost</div>${I.plus(56, C.white)}</div>
  </div>
  <div style="position:absolute;left:154px;right:154px;top:200px;height:760px;border-radius:40px;${ART.midnight}box-shadow:0 0 90px rgba(139,61,255,0.35);"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;padding:0 40px 56px;display:flex;flex-direction:column;gap:30px;">
    <div style="display:flex;flex-direction:column;gap:14px;"><div style="font-size:44px;font-weight:800;letter-spacing:-0.02em;">Midnight Drive</div><div style="display:flex;align-items:center;gap:16px;font-size:26px;">${avatarStack(52)}<span><b>riya.wav</b> <span style="color:${C.sec};">· with</span> <b>sam_beats &amp; kabir</b></span></div></div>
    <div style="display:flex;align-items:center;justify-content:space-between;color:${C.white};font-size:26px;font-weight:700;">
      <div style="display:flex;gap:36px;align-items:center;"><div style="display:flex;align-items:center;gap:10px;">${I.heart(30, C.white)}<span>412</span></div><div style="display:flex;align-items:center;gap:10px;">${I.chat(30, C.white)}<span>37</span></div>${I.send(28, C.white)}</div>
      <div style="display:flex;align-items:center;gap:18px;height:48px;padding:0 22px;border-radius:999px;border:2px solid ${C.border};background:${C.surface};"><div style="display:flex;align-items:center;gap:8px;font-size:24px;">${I.play(22, C.white)}12.8K</div><div style="width:2px;height:24px;background:${C.border};"></div><div style="display:flex;align-items:center;gap:8px;font-size:24px;">${I.repost(22, C.white)}64</div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:18px;align-items:center;">
      ${timesRow('0:00', '1:42', '3:56', 700)}
      ${scrubber(700, { pct: 0.43, seed: 5, clip: true, bars: 40, h: 48 })}
    </div>
    <div style="position:relative;height:116px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;left:0;right:0;top:16px;height:84px;border-radius:999px;border:3px solid rgba(139,61,255,0.5);background:${C.surface};display:flex;align-items:center;justify-content:space-between;padding:0 50px;">${I.shuffle(40, C.white)}${I.repeat(40, C.white)}</div>
      <div style="position:relative;width:116px;height:116px;border-radius:50%;background:conic-gradient(from 0deg,${C.neon} 0 43%,#4E5470 43% 100%);display:flex;align-items:center;justify-content:center;"><div style="width:102px;height:102px;border-radius:50%;background:${C.bg};display:flex;align-items:center;justify-content:center;">${I.pause(48, C.white)}</div></div>
    </div>
    <div style="display:flex;gap:18px;">${['Queue', 'Info'].map((l) => `<div style="flex:1;">${secondaryBtn(l, { w: '100%', h: 76, fs: 26 })}</div>`).join('')}</div>
  </div>`;

const lockCard = () =>
  `<div style="width:640px;border-radius:48px;padding:34px;background:linear-gradient(160deg,#24243A,#101018);border:2px solid rgba(255,255,255,0.08);box-shadow:0 50px 120px rgba(0,0,0,0.7);display:flex;flex-direction:column;gap:26px;font-family:'Manrope',system-ui,sans-serif;color:${C.white};">
     <div style="display:flex;align-items:center;gap:22px;">${cover('midnight', 110, 22)}<div style="display:flex;flex-direction:column;gap:6px;flex:1;"><div style="font-size:30px;font-weight:800;">Midnight Drive</div><div style="color:${C.sec};font-size:24px;">riya.wav · Livil</div></div>${I.lock(34, C.sec)}</div>
     <div style="display:flex;flex-direction:column;gap:14px;">${progress(0.62, 572, { thumb: false })}<div style="display:flex;justify-content:space-between;color:${C.sec};font-size:22px;"><span>0:09</span><span>-0:06</span></div></div>
     <div style="display:flex;align-items:center;justify-content:center;gap:70px;">${I.prev(56, C.white)}<div style="width:104px;height:104px;border-radius:50%;background:${C.white};display:flex;align-items:center;justify-content:center;">${I.pause(56, '#0A0A0F')}</div>${I.next(56, C.white)}</div>
   </div>`;

const playlistCard = () =>
  `<div style="width:640px;border-radius:44px;padding:40px 30px;background:${C.surface};border:2px solid ${C.border};box-shadow:0 50px 120px rgba(0,0,0,0.7);display:flex;flex-direction:column;gap:22px;align-items:center;font-family:'Manrope',system-ui,sans-serif;color:${C.white};">
     ${cover('late', 360, 28)}
     <div style="display:flex;align-items:center;gap:10px;height:40px;padding:0 20px;border-radius:999px;border:2px solid rgba(34,211,238,0.55);color:${C.info};font-size:18px;font-weight:800;letter-spacing:0.16em;">${I.library(22, C.info)}PLAYLIST</div>
     <div style="font-size:48px;font-weight:800;">late nights</div>
     <div style="color:${C.sec};font-size:26px;">by <b style="color:${C.light};">@nadia</b> · Nadia</div>
     <div style="display:flex;align-items:center;gap:10px;height:50px;padding:0 22px;border-radius:999px;border:2px solid rgba(0,200,83,0.5);color:${C.light};font-size:22px;font-weight:800;">${I.users(26, C.light)}Friends only</div>
     <div style="display:flex;gap:16px;">${primaryBtn('Play', { h: 80, fs: 30, pad: 40, icon: I.play(30, C.neon) })}${secondaryBtn('Shuffle', { h: 80, fs: 30, pad: 40, icon: I.shuffle(30, C.white) })}</div>
     <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
       ${[['Low Tide', 'sam_beats', 'lowtide'], ['Midnight Drive', 'riya.wav', 'midnight']].map(([t, a, k], i) => `<div style="display:flex;align-items:center;gap:18px;padding:12px 6px;"><div style="color:${C.sec};font-size:24px;width:24px;">${i + 1}</div>${cover(k, 76, 16)}<div style="display:flex;flex-direction:column;gap:4px;flex:1;"><div style="font-size:26px;font-weight:700;">${t}</div><div style="color:${C.sec};font-size:22px;">${a}</div></div>${avatar(i ? 'R' : 'SB', 52, i ? 285 : 195)}</div>`).join('')}
     </div>
   </div>`;

// ================= PANELS =================
const P = {};
P.Panel1 = page('1', `
  ${glow(W, 1420, 1000, 820, 0.6)}
  ${pulseLine(`M-10 200 H520 L580 120 L640 260 L700 150 L740 200 H1060 L1160 40 L1320 200`)}
  ${headline([{ t: 'Press play ' }, { t: 'here', g: true }, { t: '…' }], '', { size: 140, top: SAFE_TOP + 110 })}
  <div style="position:absolute;left:100px;top:${SAFE_TOP + 470}px;color:${C.light};font-size:36px;font-weight:600;display:flex;align-items:center;gap:18px;">${I.crown(40, C.warning)}Your phone · hosting</div>
  <div style="position:absolute;left:280px;top:${SAFE_TOP + 600}px;">${phone(jamScreen({ host: true }), { tilt: -6 })}</div>
`);
P.Panel2 = page('2', `
  ${glow(0, 1420, 1000, 820, 0.6)}
  ${pulseLine(`M0 200 L120 320 L220 200 H700 L760 110 L820 270 L880 200 H1330`)}
  ${headline([{ t: '…and it plays ' }, { t: 'there', g: true }, { t: '.' }], 'Jam Rooms keep everyone on the same beat — in real time.', { size: 140, top: SAFE_TOP + 110 })}
  <div style="position:absolute;left:100px;top:${SAFE_TOP + 640}px;color:${C.light};font-size:36px;font-weight:600;display:flex;align-items:center;gap:18px;">${I.users(40, C.neon)}Your friend's phone · same second</div>
  <div style="position:absolute;left:260px;top:${SAFE_TOP + 760}px;">${phone(jamScreen({ host: false }), { tilt: 6, h: 1560 })}</div>
`);
P.Panel3 = page('3', `
  ${glow(660, 1900, 900, 760, 0.5)}
  ${pulseLine(`M-10 200 H430 L480 130 L540 280 L600 160 L650 200 H1330`)}
  ${headline([{ t: 'See what your friends are ' }, { t: 'playing', g: true }, { t: '.' }], 'Friends\' stories up top. A feed built from people you know — not an algorithm.', { size: 118, align: 'center', top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:256px;top:${SAFE_TOP + 680}px;">${phone(homeScreen())}</div>
`);
P.Panel4 = page('4', `
  ${glow(660, 1750, 820, 700, 0.62)}
  ${pulseLine(`M-10 200 H560 L610 60 L660 340 L710 90 L760 200 H1330`)}
  ${headline([{ t: 'Share the 15 seconds that gave you ' }, { t: 'chills', g: true }, { t: '.' }], 'Clip any moment. Repost it with your take, or post it as a Story.', { size: 112, align: 'center', top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:256px;top:${SAFE_TOP + 720}px;">${phone(repostScreen(), { h: 1560 })}</div>
`);
P.Panel5 = page('5', `
  ${glow(120, 2500, 1000, 800, 0.55)}
  ${pulseLine(`M-10 200 H300 L350 120 L410 270 L470 150 L520 200 H1330`)}
  ${headline([{ t: 'Built for the people who ' }, { t: 'make', g: true }, { t: ' the music.' }], 'Upload audio or video. Credit your collaborators. Be heard by people who actually listen.', { size: 112, top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:120px;top:${SAFE_TOP + 720}px;">${phone(profileScreen())}</div>
  <div style="position:absolute;right:-30px;top:${SAFE_TOP + 1540}px;transform:rotate(4deg);">${uploadCard()}</div>
`);
P.Panel6 = page('6', `
  ${glow(1200, 2500, 1000, 800, 0.55)}
  ${pulseLine(`M-10 200 H520 L580 110 L640 280 L700 160 L740 200 H1330`)}
  ${headline([{ t: 'Your music. ' }, { t: 'Everywhere', g: true }, { t: ' you are.' }], 'A full-screen player. Lock-screen controls. Playlists you build with friends.', { size: 112, align: 'center', top: SAFE_TOP + 80 })}
  <div style="position:absolute;left:-60px;top:${SAFE_TOP + 940}px;transform:rotate(-8deg);">${lockCard()}</div>
  <div style="position:absolute;right:-90px;top:${SAFE_TOP + 760}px;transform:rotate(7deg);">${playlistCard()}</div>
  <div style="position:absolute;left:270px;top:${SAFE_TOP + 600}px;">${phone(playerScreen(), { h: 1300 })}</div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:520px;background:linear-gradient(180deg,rgba(10,10,15,0) 0%,rgba(10,10,15,0.95) 45%,${C.bg} 100%);"></div>
  <div style="position:absolute;left:0;right:0;bottom:${SAFE_TOP + 10}px;display:flex;flex-direction:column;align-items:center;gap:18px;">
    ${wordmark(400)}
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
