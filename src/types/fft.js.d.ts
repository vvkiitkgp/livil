// Minimal ambient types for `fft.js` (indutny) — a pure-JS radix-4 FFT with no
// bundled types. Used by src/services/waveform.ts for the beat-synced visualizer
// analysis (Hermes-safe, no native surface).
declare module 'fft.js' {
  export default class FFT {
    readonly size: number;
    constructor(size: number);
    createComplexArray(): number[];
    /** Forward FFT of a REAL input (length `size`); fills the half-spectrum into `out`. */
    realTransform(out: number[], data: ArrayLike<number>): void;
    /** Mirror the half-spectrum into the full complex array (not needed if you only read bins 0..size/2). */
    completeSpectrum(out: number[]): void;
    transform(out: number[], data: ArrayLike<number>): void;
    inverseTransform(out: number[], data: ArrayLike<number>): void;
  }
}
