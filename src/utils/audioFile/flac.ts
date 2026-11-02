/**
 * A small FLAC encoder in TypeScript, for posting an Editor mix lossless (ADR-0036: the owner
 * chose FLAC, "best quality"). The phone has no FLAC writer we can reach from JS, and the
 * format is simple enough to write directly:
 *
 * - 16-bit PCM, 1–2 channels, fixed block size 4096, channels coded independently;
 * - each subframe is CONSTANT (silence), FIXED (orders 0–4, the smallest wins) or VERBATIM;
 * - residuals: one Rice partition per subframe, parameter from the mean magnitude;
 * - STREAMINFO carries the total length; the MD5 is left zero, which the spec allows
 *   ("unknown") and every decoder accepts.
 *
 * Lossless by construction — decoding gives back exactly the 16-bit samples. Verified against
 * the reference `flac` decoder in src/utils/__tests__/flac.test.ts.
 */

const BLOCK = 4096; // frame header code 0b1100

/** Frame-header codes for the common rates (0 = "see STREAMINFO"). */
const RATE_CODE: Record<number, number> = {
  88200: 0b0001, 176400: 0b0010, 192000: 0b0011, 8000: 0b0100, 16000: 0b0101,
  22050: 0b0110, 24000: 0b0111, 32000: 0b1000, 44100: 0b1001, 48000: 0b1010, 96000: 0b1011,
};

class BitWriter {
  buf = new Uint8Array(1 << 16);
  len = 0; // bytes written
  private acc = 0; // pending bits, right-aligned
  private n = 0; // how many pending bits

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** Writes the low `bits` bits of `value` (bits ≤ 24). */
  write(value: number, bits: number) {
    if (bits === 0) return;
    this.acc = (this.acc << bits) | (value & ((1 << bits) - 1));
    this.n += bits;
    this.ensure(4);
    while (this.n >= 8) {
      this.n -= 8;
      this.buf[this.len++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }

  /** Writes up to 32 bits by splitting. */
  writeLong(value: number, bits: number) {
    if (bits > 24) { this.write(Math.floor(value / 2 ** 24), bits - 24); this.write(value % 2 ** 24, 24); }
    else this.write(value, bits);
  }

  /** `q` zero bits then a one (Rice quotient). */
  unary(q: number) {
    while (q >= 24) { this.write(0, 24); q -= 24; }
    this.write(1, q + 1);
  }

  /** Pads with zeros to the next byte. */
  align() { if (this.n > 0) this.write(0, 8 - this.n); }

  bytes(): Uint8Array { return this.buf.subarray(0, this.len); }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8;
  for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}
const crc8 = (b: Uint8Array, from: number, to: number) => { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b: Uint8Array, from: number, to: number) => { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

/** FLAC's "UTF-8" coded frame number. */
function writeUtf8(w: BitWriter, v: number) {
  if (v < 0x80) { w.write(v, 8); return; }
  const bytes: number[] = [];
  let lead = 0xc0, max = 0x7ff, count = 1;
  while (v > max) { count++; max = 2 ** (5 * count + 6) - 1; lead = (lead >> 1) | 0x80; }
  for (let i = 0; i < count; i++) { bytes.unshift(0x80 | (v & 0x3f)); v = Math.floor(v / 64); }
  w.write(lead | v, 8);
  for (const b of bytes) w.write(b, 8);
}

const zigzag = (r: number) => (r >= 0 ? r * 2 : -r * 2 - 1);

/** Residual of fixed predictor `order` over block x[0..n) (first `order` samples are warm-up). */
function residual(x: Int32Array, n: number, order: number, out: Int32Array) {
  for (let i = order; i < n; i++) {
    let p = 0;
    switch (order) {
      case 1: p = x[i - 1]; break;
      case 2: p = 2 * x[i - 1] - x[i - 2]; break;
      case 3: p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3]; break;
      case 4: p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4]; break;
    }
    out[i - order] = x[i] - p;
  }
}

/** Best Rice parameter for these residuals, and the bits it costs. */
function rice(res: Int32Array, count: number): { k: number; bits: number } {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += zigzag(res[i]);
  let best = { k: 0, bits: Infinity };
  const mean = count ? sum / count : 0;
  const guess = mean > 1 ? Math.floor(Math.log2(mean)) : 0;
  for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 1); k++) {
    // Each value: quotient + 1 stop bit + k bits; sum of quotients ≈ sum >> k.
    const bits = count * (k + 1) + Math.floor(sum / 2 ** k);
    if (bits < best.bits) best = { k, bits };
  }
  return best;
}

function writeSubframe(w: BitWriter, x: Int32Array, n: number, scratch: Int32Array) {
  let constant = true;
  for (let i = 1; i < n && constant; i++) constant = x[i] === x[0];
  if (constant) { w.write(0, 1); w.write(0, 6); w.write(0, 1); w.write(x[0] & 0xffff, 16); return; }
  let bestOrder = -1, bestBits = n * 16, bestK = 0;
  for (let order = 0; order <= Math.min(4, n - 1); order++) {
    residual(x, n, order, scratch);
    const r = rice(scratch, n - order);
    const bits = order * 16 + 6 + r.bits;
    if (bits < bestBits) { bestBits = bits; bestOrder = order; bestK = r.k; }
  }
  if (bestOrder < 0) { // VERBATIM
    w.write(0, 1); w.write(1, 6); w.write(0, 1);
    for (let i = 0; i < n; i++) w.write(x[i] & 0xffff, 16);
    return;
  }
  w.write(0, 1); w.write(8 | bestOrder, 6); w.write(0, 1);
  for (let i = 0; i < bestOrder; i++) w.write(x[i] & 0xffff, 16);
  residual(x, n, bestOrder, scratch);
  w.write(0, 2); // Rice, 4-bit parameter
  w.write(0, 4); // partition order 0
  w.write(bestK, 4);
  const mask = (1 << bestK) - 1;
  for (let i = 0; i < n - bestOrder; i++) {
    const u = zigzag(scratch[i]);
    w.unary(Math.floor(u / 2 ** bestK));
    w.write(u & mask, bestK);
  }
}

const toInt16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));

/**
 * Encodes `channels` (equal length, −1..1) as a FLAC file. Async: yields every few frames so
 * a long song never freezes the screen; `onProgress` gets 0..1.
 *
 * `dither` (default on): TPDF dither of ±1 LSB before rounding to 16 bits, so the quiet ends of
 * a song (fades, reverb tails) decay smoothly instead of into gritty rounding noise. ONE
 * dither sequence is shared by both channels: a mono-in-stereo song stays identical in L and R.
 */
export async function encodeFlac(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (fraction: number) => void,
  opts: { dither?: boolean } = {},
): Promise<Uint8Array> {
  const dither = opts.dither ?? true;
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const tpdf = new Float64Array(BLOCK);
  const ch = channels.length;
  if (ch < 1 || ch > 2) throw new Error('FLAC: 1 or 2 channels');
  const total = channels[0].length;
  const w = new BitWriter();
  // "fLaC" + STREAMINFO (last metadata block, 34 bytes)
  for (const c of 'fLaC') w.write(c.charCodeAt(0), 8);
  w.write(1, 1); w.write(0, 7); w.write(34, 24);
  w.write(BLOCK, 16); w.write(BLOCK, 16);
  w.write(0, 24); w.write(0, 24);
  w.write(sampleRate, 20); w.write(ch - 1, 3); w.write(15, 5);
  w.writeLong(Math.floor(total / 2 ** 32), 4); w.writeLong(total % 2 ** 32, 32);
  for (let i = 0; i < 16; i++) w.write(0, 8);

  const x = new Int32Array(BLOCK);
  const scratch = new Int32Array(BLOCK);
  let minFrame = Infinity, maxFrame = 0;
  const frames = Math.ceil(total / BLOCK);
  for (let f = 0; f < frames; f++) {
    const start = f * BLOCK;
    const n = Math.min(BLOCK, total - start);
    const head = w.len;
    w.write(0x3ffe, 14); w.write(0, 1); w.write(0, 1);
    // Block size and sample rate as their standard codes where one exists. Apple's decoder
    // (AVPlayer, every iPhone) found no audio in a file whose frames said "see STREAMINFO" /
    // "size at the end of the header" for these, though the reference decoder accepted it.
    w.write(n === BLOCK ? 0b1100 : 0b0111, 4);
    w.write(RATE_CODE[sampleRate] ?? 0, 4);
    w.write(ch === 2 ? 0b0001 : 0b0000, 4); // independent channels
    w.write(0b100, 3); w.write(0, 1); // 16 bits per sample
    writeUtf8(w, f);
    if (n !== BLOCK) w.write(n - 1, 16);
    w.write(crc8(w.buf, head, w.len), 8);
    if (dither) for (let i = 0; i < n; i++) tpdf[i] = (rnd() - rnd()) / 32767;
    for (let c = 0; c < ch; c++) {
      const src = channels[c];
      if (dither) for (let i = 0; i < n; i++) x[i] = toInt16(src[start + i] + tpdf[i]);
      else for (let i = 0; i < n; i++) x[i] = toInt16(src[start + i]);
      writeSubframe(w, x, n, scratch);
    }
    w.align();
    const crc = crc16(w.buf, head, w.len);
    w.write(crc >> 8, 8); w.write(crc & 0xff, 8);
    minFrame = Math.min(minFrame, w.len - head);
    maxFrame = Math.max(maxFrame, w.len - head);
    if (f % 24 === 23) {
      onProgress?.(f / frames);
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  const out = w.bytes().slice();
  // STREAMINFO's min/max frame size (bytes 12–17), now that they are known.
  if (frames > 0) {
    for (const [at, v] of [[12, minFrame], [15, maxFrame]] as const) {
      out[at] = (v >> 16) & 0xff; out[at + 1] = (v >> 8) & 0xff; out[at + 2] = v & 0xff;
    }
  }
  return out;
}
