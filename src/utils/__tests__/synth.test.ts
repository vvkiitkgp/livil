import {
  chordLoopDegrees,
  chordName,
  chordSpans,
  degreeName,
  degreeToMidi,
  guitarChord,
  guitarStroke,
  renderSynth,
  sanitizeSynths,
  STRUMS,
  SYNTH_STEPS,
  synthHits,
  type SynthHit,
  type SynthPart,
} from '../synth';

const DSHARP_MINOR = { tonic: 3, mode: 'minor' as const };
const C_MAJOR = { tonic: 0, mode: 'major' as const };
const part = (p: Partial<SynthPart>): SynthPart => ({ id: 's1', sound: 'keys', key: C_MAJOR, volume: 0.8, chords: null, notes: [], ...p });

describe('synth theory', () => {
  it('names the chords of a key', () => {
    expect(chordLoopDegrees('pop', C_MAJOR).map(d => chordName(C_MAJOR, d))).toEqual(['C', 'G', 'Am', 'F']);
    expect(chordLoopDegrees('pop', DSHARP_MINOR).map(d => chordName(DSHARP_MINOR, d))).toEqual(['D#m', 'B', 'F#', 'C#']);
    expect(chordName(C_MAJOR, 6)).toBe('B°');
  });

  it('keeps every note in the key, an octave per 7 degrees', () => {
    expect(degreeName(DSHARP_MINOR, 2)).toBe('F#');
    expect(degreeToMidi(C_MAJOR, 'keys', 7) - degreeToMidi(C_MAJOR, 'keys', 0)).toBe(12);
    expect(degreeToMidi(C_MAJOR, 'bass', 0)).toBeLessThan(degreeToMidi(C_MAJOR, 'lead', 0));
    for (let d = 0; d < 8; d++) expect([0, 2, 4, 5, 7, 9, 11]).toContain(degreeToMidi(C_MAJOR, 'keys', d) % 12);
  });
});

describe('synth parts', () => {
  it('plays one chord per bar across the 4-bar loop', () => {
    const hits = synthHits(part({ sound: 'pad', chords: 'pop' }));
    expect(hits).toHaveLength(SYNTH_STEPS);
    const bars = [0, 16, 32, 48].map(s => hits[s]);
    expect(bars.every(b => b.length === 1 && b[0].len === 16)).toBe(true);
    expect(hits.filter(h => h.length).length).toBe(4);
  });

  it('adds played notes on top of the chords', () => {
    const hits = synthHits(part({ chords: 'pop', notes: [{ step: 2, degree: 4, len: 2 }] }));
    expect(hits[2]).toEqual([{ midis: [degreeToMidi(C_MAJOR, 'keys', 4)], len: 2 }]);
    expect(hits[0]).toHaveLength(1); // the chord on beat 1
  });

  it('renders audible, unclipped audio with a release tail', () => {
    for (const sound of ['keys', 'pad', 'bass', 'lead', 'strum', 'pick'] as const) {
      // One note for the sounds that only ever play one: the bass, a fingerpicked string.
      const out = renderSynth(sound, sound === 'bass' ? [36] : sound === 'pick' ? [60] : [60, 64, 67], 0.5, 8000);
      expect(out.length).toBeGreaterThan(0.5 * 8000);
      const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThan(1);
      expect(Math.abs(out[out.length - 1])).toBeLessThan(0.02);
    }
  });

  it('keeps a guitar part in a draft, with its strumming pattern', () => {
    const g = part({ sound: 'pick', chords: 'pop', notes: [{ step: 0, degree: 5, len: 4 }] });
    expect(sanitizeSynths([g])).toEqual([g]);
    // A chord can be held for the whole loop; a note, for a bar.
    const strummed = part({ sound: 'strum', strum: 'rock', notes: [{ step: 0, degree: 5, len: 64 }] });
    expect(sanitizeSynths([strummed])).toEqual([strummed]);
    expect(sanitizeSynths([{ ...strummed, sound: 'keys' }])[0].notes).toEqual([]);
    expect(sanitizeSynths([{ ...strummed, strum: 'flamenco' }])[0].strum).toBeUndefined();
    expect(sanitizeSynths([{ ...strummed, sound: 'keys', notes: [] }])[0].strum).toBeUndefined();
  });

  it('drops what a draft cannot play instead of failing', () => {
    const good = part({ chords: 'dreamy', notes: [{ step: 3, degree: 1, len: 2 }] });
    expect(sanitizeSynths([good])).toEqual([good]);
    expect(sanitizeSynths(undefined)).toEqual([]);
    expect(sanitizeSynths([{ ...good, sound: 'violin' }, { ...good, id: '../x' }])).toEqual([]);
    const messy = sanitizeSynths([{ ...good, chords: 'jazz', notes: [{ step: 999, degree: 1, len: 2 }, { step: 1, degree: 1, len: 2 }] }]);
    expect(messy[0].chords).toBeNull();
    expect(messy[0].notes).toEqual([{ step: 1, degree: 1, len: 2 }]);
  });
});

describe('guitar', () => {
  const pcs = (midis: number[]) => midis.map(m => m % 12);

  it('voices every chord of a key as a barre shape a guitar can play, in key', () => {
    for (const key of [C_MAJOR, DSHARP_MINOR, { tonic: 7, mode: 'major' as const }]) {
      for (let d = -7; d <= 14; d++) {
        const chord = guitarChord(key, d);
        expect([5, 6]).toContain(chord.length);
        expect(chord[0]).toBeGreaterThanOrEqual(40); // the low E string
        expect(chord[0]).toBeLessThan(52); // no higher than the 11th fret
        expect(chord[chord.length - 1]).toBeLessThanOrEqual(76); // the high E, 12th fret
        expect(chord).toEqual([...chord].sort((a, b) => a - b));
        for (const m of chord) expect([0, 1, 2, 3, 4, 5, 6].map(i => degreeToMidi(key, 'keys', i) % 12)).toContain(m % 12);
      }
    }
    // C major: G is the E shape on the 3rd fret, C the A shape on the 3rd fret.
    expect(guitarChord(C_MAJOR, 4)).toEqual([43, 50, 55, 59, 62, 67]);
    expect(guitarChord(C_MAJOR, 0)).toEqual([48, 55, 60, 64, 67]);
    expect(pcs(guitarChord(C_MAJOR, 5))).toEqual([9, 4, 9, 0, 4, 9]); // Am
  });

  const strokesIn = (hits: SynthHit[][], bar = 0) => hits.slice(bar * 16, bar * 16 + 16).map((h, i) => (h.length ? i : -1)).filter(i => i >= 0);
  const strummed = (p: Partial<SynthPart>) => synthHits(part({ sound: 'strum', ...p }));

  it('plays the chord loop in the chosen strumming pattern', () => {
    for (const s of STRUMS) {
      const hits = strummed({ strum: s.id, chords: 'pop' });
      const want = [...s.bar].map((c, i) => (c === '.' ? -1 : i)).filter(i => i >= 0);
      for (let bar = 0; bar < 4; bar++) expect(strokesIn(hits, bar)).toEqual(want);
      expect(hits.every(h => h.length <= 1)).toBe(true); // one guitar, one stroke at a time
    }
    // Island when none is chosen: down, down-up, up-down-up.
    expect(strokesIn(strummed({ chords: 'pop' }))).toEqual([0, 4, 6, 10, 12, 14]);
  });

  it('only asks the hand for strokes it can make: down on its swing, up on the way back', () => {
    for (const s of STRUMS) {
      const swing = [...s.bar].some((c, i) => i % 2 === 1 && c !== '.') ? 1 : 2; // in 16ths, or in 8ths
      [...s.bar].forEach((c, i) => {
        if (c === 'D' || c === 'X') expect(i % (2 * swing)).toBe(0);
        if (c === 'U') expect(i % (2 * swing)).toBe(swing);
      });
    }
  });

  it('catches the strings a guitarist would on each stroke', () => {
    const g = guitarChord(C_MAJOR, 4);
    const bar = strummed({ strum: 'island', chords: 'pop' }).slice(16, 32);
    expect(bar[0][0].midis).toEqual(g.slice(0, 4)); // beat 1 leans on the bass strings
    expect(bar[4][0].midis).toEqual(g); // beat 2, the accent: every string, low to high
    expect(bar[6][0].midis).toEqual(g.slice(-4).reverse()); // an up stroke: the top strings, high to low
    expect(bar[4][0].gap).toBeLessThan(bar[0][0].gap!); // and the accent is the faster sweep
    // Each stroke rings until the next one.
    expect(bar.flatMap((h, i) => h.map(x => i + x.len))).toEqual([4, 6, 10, 12, 14, 16]);
    // In 16ths: a down between beats brushes the middle strings, the up after it the top three.
    const indie = strummed({ strum: 'indie', chords: 'pop' }).slice(16, 32);
    expect(indie[2][0].midis).toEqual(g.slice(1, 5));
    expect(indie[7][0].midis).toEqual(g.slice(-3).reverse());
    // Every sweep is a strum, not a block chord and not a harp: 10–45 ms across the strings.
    for (const s of STRUMS) {
      for (const h of strummed({ strum: s.id, chords: 'pop' }).flat()) {
        const sweep = h.gap! * (h.midis.length - 1);
        expect(sweep).toBeGreaterThanOrEqual(0.01);
        expect(sweep).toBeLessThanOrEqual(0.045);
      }
    }
  });

  it('strikes the accent hard and the strokes between lighter, in three kinds only', () => {
    const kinds = new Set<number>();
    for (const s of STRUMS) {
      for (let step = 0; step < 16; step++) {
        const k = guitarStroke({ sound: 'strum', key: C_MAJOR, strum: s.id }, 0, step, false);
        if (!k) continue;
        kinds.add(k.hard);
        // Every string on 2 or 4 is the accent; an up stroke never is.
        if (k.midis.length === 6 && !k.mute && s.id !== 'single') expect(k.hard).toBe(1);
        if (k.midis[0] > k.midis[1]) expect(k.hard).toBeLessThan(1);
      }
    }
    // Few enough that the loop needs no more strokes synthesised than it did.
    expect([...kinds].sort()).toEqual([0.4, 0.7, 1]);
  });

  it('accents the backbeat and plays the strokes between lighter', () => {
    const hits = strummed({ strum: 'rock', chords: 'pop' });
    for (let bar = 0; bar < 4; bar++) {
      const gain = (i: number) => hits[bar * 16 + i][0].gain!;
      expect(gain(4)).toBeGreaterThan(gain(0));
      expect(gain(12)).toBeGreaterThan(gain(8));
      for (const up of [2, 6, 10, 14]) for (const down of [0, 4, 8, 12]) expect(gain(up)).toBeLessThan(gain(down));
    }
  });

  it('plays like a hand: no two strokes alike, the timing drifting a few ms, the same every pass', () => {
    const all = strummed({ strum: 'rock', chords: 'pop' }).flat();
    expect(all).toHaveLength(32);
    expect(new Set(all.map(h => `${h.gain}|${h.shift}`)).size).toBe(32);
    const shifts = all.map(h => h.shift!);
    for (const x of shifts) expect(Math.abs(x)).toBeLessThanOrEqual(0.008);
    expect(Math.max(...shifts) - Math.min(...shifts)).toBeGreaterThan(0.008);
    // Drifting, not jittering: from one stroke to the next it moves far less than it wanders overall.
    const moves = shifts.slice(1).map((x, i) => Math.abs(x - shifts[i]));
    expect(moves.reduce((a, b) => a + b, 0) / moves.length).toBeLessThan(0.003);
    expect(strummed({ strum: 'rock', chords: 'pop' })).toEqual(strummed({ strum: 'rock', chords: 'pop' }));
  });

  it('strums a played chord in the pattern for as long as it was held, over the chord loop', () => {
    const hits = strummed({ strum: 'steady', chords: 'pop', notes: [{ step: 8, degree: 5, len: 8 }] });
    const [c, g, am] = [0, 4, 5].map(d => guitarChord(C_MAJOR, d));
    expect(hits[0][0].midis).toEqual(c.slice(0, 4)); // the loop's C
    expect(hits[4][0].midis).toEqual(c);
    expect(hits[8][0].midis).toEqual(am.slice(0, 4)); // the played Am takes over on beat 3
    expect(hits[12][0].midis).toEqual(am);
    expect(hits[16][0].midis).toEqual(g.slice(0, 4)); // and hands back to the loop's G
    expect(hits.every(h => h.length <= 1)).toBe(true); // one guitar, one chord
  });

  it('always sounds a chord where it is pressed, and lets its last stroke ring', () => {
    // Island rests on beat 3; a chord pressed there is strummed down all the same.
    const hits = strummed({ strum: 'island', notes: [{ step: 8, degree: 3, len: 2 }] });
    expect(hits.flat()).toHaveLength(1);
    expect(hits[8][0]).toMatchObject({ midis: guitarChord(C_MAJOR, 3).slice(0, 4), len: 16 }); // a bar, the most
    expect(hits[8][0].gain).toBeGreaterThan(0.75);
    expect(guitarStroke(part({ sound: 'strum', strum: 'island' }), 3, 8, false)).toBeNull();
    // A later chord takes over from one still held; where it starts, the hand strums it.
    const two = strummed({ strum: 'single', notes: [{ step: 0, degree: 0, len: 16 }, { step: 6, degree: 4, len: 4 }] });
    expect(strokesIn(two)).toEqual([0, 6]);
    expect(two[0][0].len).toBe(6); // rings until the next chord damps it
    expect(two[6][0].midis).toEqual(guitarChord(C_MAJOR, 4));
  });

  it('starts a played chord on an 8th and holds it at least one', () => {
    expect(chordSpans({ notes: [{ step: 5, degree: 1, len: 3 }, { step: 62, degree: 2, len: 1 }, { step: 99, degree: 0, len: 2 }] })).toEqual([
      { step: 4, degree: 1, len: 4 },
      { step: 62, degree: 2, len: 2 },
    ]);
    // Held across the end of the loop, it carries on from the start.
    const wrapped = strummed({ strum: 'steady', notes: [{ step: 60, degree: 2, len: 8 }] });
    expect(wrapped.map((h, i) => (h.length ? i : -1)).filter(i => i >= 0)).toEqual([0, 60]);
  });

  it('strums once and lets it ring on Single, a slow sweep of every string', () => {
    const hits = strummed({ strum: 'single', chords: 'pop' });
    expect(hits.flat()).toHaveLength(4);
    expect(hits[0][0]).toMatchObject({ midis: guitarChord(C_MAJOR, 0), len: 16, gap: 0.007 });
  });

  it('chucks: a short muted hit on 2 and 4 that damps the stroke before it', () => {
    const bar = strummed({ strum: 'chuck', chords: 'pop' }).slice(0, 16);
    expect(bar[4][0]).toMatchObject({ midis: guitarChord(C_MAJOR, 0), mute: true });
    expect(bar[2][0].cut).toBe(true);
    expect(bar[6][0].cut).toBeUndefined();
    const c = guitarChord(C_MAJOR, 0);
    const [open, cut, muted] = [{}, { cut: true }, { mute: true }].map(t => renderSynth('strum', c, 0.5, 8000, t));
    expect(muted.length).toBeLessThan(0.2 * 8000); // however long it is "held"
    expect(muted.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeGreaterThan(0.05);
    expect(cut.length).toBeLessThan(open.length);
  });

  it('fingerpicks one string per 8th, each ringing until the chord changes', () => {
    const hits = synthHits(part({ sound: 'pick', chords: 'pop' }));
    const bar = hits.slice(0, 16);
    const c = guitarChord(C_MAJOR, 0);
    expect(bar.filter(h => h.length).every(h => h.length === 1 && h[0].midis.length === 1)).toBe(true);
    expect(strokesIn(hits)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(bar[0][0].midis).toEqual([c[0]]); // the root in the bass
    expect(bar[8][0].midis).toEqual([c[1]]); // the 5th in the bass
    expect(bar[0][0].gain).toBeGreaterThan(bar[2][0].gain!); // the thumb leads
    expect(bar.flatMap((h, i) => h.map(x => i + x.len)).every(end => end <= 16)).toBe(true);
    // The same chord in the next bar (Drive: two bars of the root): the strings ring through.
    expect(synthHits(part({ sound: 'pick', chords: 'drive' }))[12][0].len).toBe(8);
    // A played chord starts on its root.
    const played = synthHits(part({ sound: 'pick', notes: [{ step: 6, degree: 4, len: 4 }] }));
    expect(played[6][0].midis).toEqual([guitarChord(C_MAJOR, 4)[0]]);
    expect(strokesIn(played)).toEqual([6, 8]);
  });

  describe('sounds acoustic', () => {
    const sr = 48000;
    const power = (x: Float32Array, from: number, to: number) => {
      let p = 0;
      for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) p += x[i] * x[i];
      return p / ((to - from) * sr);
    };
    const db = (x: number) => 10 * Math.log10(x);
    /** How bright a stretch is: the energy in its sample-to-sample change, against its energy. */
    const brightness = (x: Float32Array, from: number, to: number) => {
      let d = 0;
      for (let i = Math.round(from * sr) + 1; i < Math.round(to * sr); i++) d += (x[i] - x[i - 1]) ** 2;
      return d / ((to - from) * sr) / power(x, from, to);
    };
    /** The level of one frequency over a stretch. */
    const tone = (x: Float32Array, hz: number, from: number, to: number) => {
      let re = 0, im = 0;
      for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) {
        re += x[i] * Math.cos((2 * Math.PI * hz * i) / sr);
        im += x[i] * Math.sin((2 * Math.PI * hz * i) / sr);
      }
      return Math.hypot(re, im);
    };

    // These hold the guitar to the recording its tone was fitted to (see TONE in synth.ts).
    const harmonics = (m: number) => {
      const hz = 440 * Math.pow(2, (m - 69) / 12);
      const x = renderSynth('pick', [m], 1, sr);
      const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => db(tone(x, hz * k, 0.1, 0.5) ** 2));
      return levels.map(v => v - levels[0]); // dB against the note itself
    };

    it('drops a little while a note is new, then rings on for seconds', () => {
      for (const m of [40, 52, 64]) {
        const x = renderSynth('pick', [m], 2, sr);
        const early = (db(power(x, 0.02, 0.07)) - db(power(x, 0.3, 0.35))) / 0.28;
        const late = db(power(x, 0.3, 0.35)) - db(power(x, 1.3, 1.35));
        expect(early).toBeGreaterThan(late * 1.15);
        expect(late).toBeGreaterThan(5); // it does fade…
        expect(late).toBeLessThan(16); // …but a strummed chord is still there seconds later
      }
    });

    it('is bright where it is picked and warm as it rings — the bass strings too', () => {
      for (const m of [40, 45, 57, 64]) {
        const x = renderSynth('pick', [m], 2, sr);
        expect(brightness(x, 0, 0.05)).toBeGreaterThan(4 * brightness(x, 0.5, 0.7));
      }
      const strum = renderSynth('strum', guitarChord(C_MAJOR, 4), 2, sr, { gap: 0.004 });
      expect(brightness(strum, 0, 0.05)).toBeGreaterThan(6 * brightness(strum, 0.5, 0.7));
    });

    it('carries the bass strings on their overtones more than their fundamentals', () => {
      // A small box moves little air that low: a low E is heard mostly an octave and more up.
      for (const m of [40, 45]) {
        const h = harmonics(m);
        expect(Math.max(h[1], h[2])).toBeGreaterThan(0);
      }
    });

    it('lets the pick speak first: the body swells in over the next few hundredths of a second', () => {
      // Two one-pole low-passes in a row: everything below `hz`.
      const below = (x: Float32Array, hz: number) => {
        const k = 1 - Math.exp((-2 * Math.PI * hz) / sr);
        const out = new Float32Array(x.length);
        let a = 0, b = 0;
        for (let i = 0; i < x.length; i++) {
          a += k * (x[i] - a);
          b += k * (a - b);
          out[i] = b;
        }
        return out;
      };
      for (const m of [45, 52, 59]) {
        const x = renderSynth('strum', [m], 0.5, sr);
        const warmth = below(x, 400);
        const dull = below(x, 1500);
        const bite = x.map((v, i) => v - dull[i]);
        // In its first 8 ms, against where it settles (30–60 ms in):
        const early = (band: Float32Array) => db(power(band, 0, 0.008) / power(band, 0.03, 0.06));
        expect(early(bite)).toBeGreaterThan(-8); // the bite is already there…
        expect(early(warmth)).toBeLessThan(early(bite) - 9); // …the warmth is still on its way
      }
    });

    it('plays a light stroke duller, not only quieter', () => {
      // Over every chord of the key: which strings a stroke happens to catch hardest moves one chord about.
      const ring = (hard: number) =>
        [0, 1, 2, 3, 4, 5, 6].reduce((sum, d) => sum + brightness(renderSynth('strum', guitarChord(C_MAJOR, d), 0.3, sr, { gap: 0.005, hard }), 0.06, 0.2), 0);
      expect(ring(0.7)).toBeLessThan(ring(1) * 0.8);
      expect(ring(0.4)).toBeLessThan(ring(0.7) * 0.9);
    });

    it('hits no two strings of a strum alike, so each kind of stroke has its own character', () => {
      const chord = guitarChord(C_MAJOR, 0);
      // Evenly struck, a strum is its strings added up. Ours is not.
      const strum = renderSynth('strum', chord.slice(0, 2), 0.3, sr, { gap: 0.005 });
      const first = renderSynth('strum', [chord[0]], 0.3, sr);
      const second = renderSynth('strum', [chord[1]], 0.3, sr);
      const gap = Math.round(0.005 * sr);
      let off = 0;
      for (let i = gap; i < strum.length; i++) off += (strum[i] - first[i] - second[i - gap]) ** 2;
      expect(off / strum.length).toBeGreaterThan(power(strum, 0, 0.3) * 0.01);
    });

    it('is picked over the sound hole: the overtones fall well away from the note', () => {
      // Picked at the bridge they are all as loud as the note itself — the electric twang.
      for (const m of [57, 64]) for (const v of harmonics(m).slice(2)) expect(v).toBeLessThan(-8);
    });

    it('holds the pick\'s first instant under the ceiling, every stroke of every chord', () => {
      for (const s of STRUMS) {
        const hits = strummed({ strum: s.id, chords: 'pop' }).flat();
        for (const h of hits) {
          const peak = renderSynth('strum', h.midis, 0.2, 24000, h).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
          expect(peak).toBeLessThanOrEqual(0.9001);
          expect(peak).toBeGreaterThan(0.1);
        }
      }
    });
  });

  it('sounds the same every time, and in tune', () => {
    const a = renderSynth('strum', guitarChord(C_MAJOR, 4), 0.5, 8000);
    expect(renderSynth('strum', guitarChord(C_MAJOR, 4), 0.5, 8000)).toEqual(a);
    // Each string's period, by autocorrelation once it has settled: within 3 cents of true.
    const sr = 48000;
    for (const m of [40, 45, 57, 64, 76]) {
      const out = renderSynth('pick', [m], 1, sr);
      const hz = 440 * Math.pow(2, (m - 69) / 12);
      const win = out.subarray(sr * 0.2, sr * 0.7);
      const corr = (lag: number) => { let c = 0; for (let i = 0; i + lag < win.length; i++) c += win[i] * win[i + lag]; return c; };
      const p0 = sr / hz;
      let best = 0, bestC = -Infinity;
      for (let lag = Math.floor(p0 * 0.9); lag <= Math.ceil(p0 * 1.1); lag++) { const c = corr(lag); if (c > bestC) { bestC = c; best = lag; } }
      const [l, mid, r] = [corr(best - 1), bestC, corr(best + 1)];
      const period = best + (0.5 * (l - r)) / (l - 2 * mid + r);
      expect(Math.abs(1200 * Math.log2(p0 / period))).toBeLessThan(3);
    }
  });
});
