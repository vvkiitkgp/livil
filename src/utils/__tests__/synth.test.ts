import {
  chordLoopDegrees,
  chordName,
  degreeName,
  degreeToMidi,
  renderSynth,
  sanitizeSynths,
  SYNTH_STEPS,
  synthHits,
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
    for (const sound of ['keys', 'pad', 'bass', 'lead'] as const) {
      const out = renderSynth(sound, sound === 'bass' ? [36] : [60, 64, 67], 0.5, 8000);
      expect(out.length).toBeGreaterThan(0.5 * 8000);
      const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThan(1);
      expect(Math.abs(out[out.length - 1])).toBeLessThan(0.02);
    }
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
