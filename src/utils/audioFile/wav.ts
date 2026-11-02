/**
 * 16-bit PCM WAV writing + base64, for Editor drafts (ADR-0036 §9: takes are stored as WAV —
 * a file cut off by a crash mid-write stays readable, unlike M4A). Pure TypeScript.
 * Reading a draft back goes through react-native-audio-api's decodeAudioData on the file.
 */

/** A mono 16-bit PCM WAV of `samples` (clamped to ±1). */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}

/** The inverse, for tests and for any WAV we wrote ourselves. */
export function decodeWav16(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = v.getUint32(24, true);
  const n = v.getUint32(40, true) / 2;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = v.getInt16(44 + i * 2, true) / 32767;
  return { samples, sampleRate };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of `bytes[from, to)`. `from` must be a multiple of 3 except at the end. */
export function toBase64(bytes: Uint8Array, from = 0, to = bytes.length): string {
  const parts: string[] = [];
  let line = '';
  let i = from;
  for (; i + 2 < to; i += 3) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    line += B64[(x >> 18) & 63] + B64[(x >> 12) & 63] + B64[(x >> 6) & 63] + B64[x & 63];
    if (line.length >= 4096) { parts.push(line); line = ''; }
  }
  const left = to - i;
  if (left === 1) {
    const x = bytes[i] << 16;
    line += B64[(x >> 18) & 63] + B64[(x >> 12) & 63] + '==';
  } else if (left === 2) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8);
    line += B64[(x >> 18) & 63] + B64[(x >> 12) & 63] + B64[(x >> 6) & 63] + '=';
  }
  parts.push(line);
  return parts.join('');
}
