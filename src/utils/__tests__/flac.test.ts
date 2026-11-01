import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { encodeFlac } from '../audioFile/flac';

const SR = 48000;
const song = (seconds: number, stereo: boolean) => {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n), r = new Float32Array(n);
  let seed = 3;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed / 2147483647 - 0.5) * 0.05;
    l[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / SR) + noise;
    r[i] = i < SR * 0.2 ? 0 : 0.4 * Math.sin(2 * Math.PI * 330 * i / SR) - noise; // starts with silence
  }
  return stereo ? [l, r] : [l];
};

/** The reference decoder, when this machine has it (a dev Mac does; CI may not). */
const flacCli = (() => { try { execFileSync('flac', ['--version']); return true; } catch { return false; } })();
/** Apple's own decoder (macOS) — the one AVPlayer uses on every iPhone. */
const afconvert = (() => { try { execFileSync('which', ['afconvert']); return true; } catch { return false; } })();

describe('FLAC writer', () => {
  it('writes a valid stream header', async () => {
    const f = await encodeFlac(song(0.5, true), SR);
    expect(String.fromCharCode(...f.slice(0, 4))).toBe('fLaC');
    expect(f[4] & 0x80).toBe(0x80); // STREAMINFO is the last metadata block
  });

  it('is smaller than the same audio as 16-bit WAV', async () => {
    const ch = song(2, true);
    const f = await encodeFlac(ch, SR);
    expect(f.length).toBeLessThan(ch[0].length * 2 * 2 * 0.9);
  });

  (flacCli ? it : it.skip)('decodes bit-exactly with the reference decoder', async () => {
    for (const stereo of [true, false]) {
      const ch = song(1.3, stereo); // not a whole number of blocks
      const dir = mkdtempSync(join(tmpdir(), 'livil-flac-'));
      writeFileSync(join(dir, 'a.flac'), await encodeFlac(ch, SR, undefined, { dither: false }));
      execFileSync('flac', ['-s', '-t', join(dir, 'a.flac')]); // CRCs + structure
      execFileSync('flac', ['-s', '-d', '--force-raw-format', '--endian=little', '--sign=signed', '-o', join(dir, 'a.raw'), join(dir, 'a.flac')]);
      const raw = readFileSync(join(dir, 'a.raw'));
      const n = ch[0].length;
      expect(raw.length).toBe(n * 2 * ch.length);
      for (let i = 0; i < n; i += 37) {
        for (let c = 0; c < ch.length; c++) {
          const want = Math.max(-32768, Math.min(32767, Math.round(ch[c][i] * 32767)));
          expect(raw.readInt16LE((i * ch.length + c) * 2)).toBe(want);
        }
      }
    }
  });

  (flacCli ? it : it.skip)('dithers by at most 1 step, the same in both channels', async () => {
    const [l] = song(0.7, false);
    const dir = mkdtempSync(join(tmpdir(), 'livil-flac-'));
    writeFileSync(join(dir, 'a.flac'), await encodeFlac([l, l], SR));
    execFileSync('flac', ['-s', '-d', '--force-raw-format', '--endian=little', '--sign=signed', '-o', join(dir, 'a.raw'), join(dir, 'a.flac')]);
    const raw = readFileSync(join(dir, 'a.raw'));
    let changed = 0;
    for (let i = 0; i < l.length; i++) {
      const L = raw.readInt16LE(i * 4), R = raw.readInt16LE(i * 4 + 2);
      expect(L).toBe(R);
      const exact = Math.round(l[i] * 32767);
      expect(Math.abs(L - exact)).toBeLessThanOrEqual(1);
      if (L !== exact) changed++;
    }
    expect(changed).toBeGreaterThan(l.length * 0.1); // it really dithers
  });

  // A file the reference decoder accepted still played SILENT on iPhone (2026-10-31): Apple's
  // parser found one packet. Standard block-size / sample-rate codes fixed it.
  (afconvert ? it : it.skip)("decodes in full with Apple's decoder (what iPhones play)", async () => {
    const ch = song(3.1, true);
    const dir = mkdtempSync(join(tmpdir(), 'livil-flac-'));
    writeFileSync(join(dir, 'a.flac'), await encodeFlac(ch, SR));
    execFileSync('afconvert', [join(dir, 'a.flac'), '-d', 'LEI16', '-f', 'WAVE', join(dir, 'a.wav')]);
    const wav = readFileSync(join(dir, 'a.wav'));
    const data = wav.indexOf('data');
    expect(wav.readUInt32LE(data + 4)).toBe(ch[0].length * 2 * 2);
  });
});
