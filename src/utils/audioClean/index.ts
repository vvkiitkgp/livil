/**
 * "Clean up background", as one step: steady room noise out (denoise.ts), then breaths
 * between lines turned down (breath.ts). Click repair is NOT part of it: recorder glitches
 * are never wanted, so every take gets that whether or not it is cleaned (finishTake).
 */
import { reduceBreaths } from './breath';
import { cleanBackground } from './denoise';

/**
 * Bump when "Clean up background" does more: voices cleaned by an older version are cleaned
 * again (once, when their draft opens), and an outdated cleaned copy is never reused.
 * 1 = room noise only; 2 = + breaths (2026-11-02).
 */
export const CLEAN_VERSION = 2;

/** How hard the room-noise gate works (0..1). */
export const CLEAN_STRENGTH = 0.8;

export async function cleanTake(x: Float32Array, sampleRate: number, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const denoised = await cleanBackground(x, sampleRate, CLEAN_STRENGTH, f => onProgress?.(f * 0.95));
  // In place: `denoised` is our own fresh copy, so no third full-length array is needed.
  const { out, report } = reduceBreaths(denoised, sampleRate, true);
  if (report.breaths) console.log(`[LIVIL][CLEANUP] ${report.breaths} breaths turned down (${report.seconds.toFixed(2)} s)`);
  onProgress?.(1);
  return out;
}
