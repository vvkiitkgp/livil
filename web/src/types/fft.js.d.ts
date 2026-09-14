// Minimal ambient types for `fft.js` (indutny), duplicated from `src/types/fft.js.d.ts`.
//
// It has to be duplicated rather than shared: an ambient `declare module` is global to a
// TypeScript project, so putting one copy in `shared/` would make the React Native project
// see two declarations of the same module and fail to compile. `src/types/**` is also not
// an agent-writable path.
declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    createComplexArray(): number[];
    realTransform(out: number[], data: ArrayLike<number>): void;
    completeSpectrum(out: number[]): void;
    transform(out: number[], data: ArrayLike<number>): void;
    inverseTransform(out: number[], data: ArrayLike<number>): void;
  }
}
