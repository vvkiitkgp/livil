import { removeClicks, type ClickReport } from '../../utils/audioClean/clickRemover';
import { CLICK_REPAIR_VERSION, repairClicks, repairClicksAsync } from '../../utils/audioClean/clickRepair';
import { resampleAsync } from '../../utils/audioFx/level';
import type { StudioEngine, Take } from './studioEngine';

export type FinishedTake = {
  samples: Float32Array;
  sampleRate: number;
  offset: number;
  clicksRemoved: number;
  /** What the click remover did — shown on screen in this prototype; null = it did not run. */
  clickReport: ClickReport | null;
};

/**
 * Turns what the recorder captured into a take: takes the speaker click out (when the
 * metronome played on the speaker), moves it earlier by the measured latency, and cuts off
 * the count-in, so the take starts on the beat.
 */
export function finishTake(engine: StudioEngine, raw: NonNullable<ReturnType<StudioEngine['stopRecording']>>): FinishedTake {
  let samples = raw.samples;
  let clicksRemoved = 0;
  let clickReport: ClickReport | null = null;
  const sounds = engine.clickSounds();
  if (raw.clicks.length && sounds) {
    if (raw.sampleRate === engine.sampleRate) {
      const t = Date.now();
      const res = removeClicks(samples, raw.sampleRate, raw.clicks, sounds, raw.calibrationEnd);
      samples = res.cleaned;
      clicksRemoved = res.removed;
      clickReport = res.report;
      console.log(`[LIVIL][STUDIO] click remover ${Date.now() - t} ms`, JSON.stringify(res.report));
    } else {
      const why = `take ${raw.sampleRate} Hz ≠ engine ${engine.sampleRate} Hz`;
      clickReport = { removed: 0, lagMs: 0, learned: { accent: 0, beat: 0 }, reductionDb: 0, skipped: why };
      console.log(`[LIVIL][STUDIO] click remover skipped: ${why}`);
    }
  }
  // Recorder glitches (one stale sample per hardware buffer, an audible tick) — always out.
  const repair = repairClicks(samples);
  samples = repair.out;
  if (repair.report.repaired || repair.report.bursts) console.log(`[LIVIL][STUDIO] recorder glitches repaired: ${repair.report.repaired} + ${repair.report.bursts} bursts`);
  let offset = raw.offset;
  // Line the voice up with the beat: the click remover measured how late the mic heard the
  // clicks (speaker latency + mic latency + when the recorder really started). The singer sang
  // to what they HEARD, so the take is late by that much — it used to sit behind the beat and
  // stacked takes flammed. Headphone takes have no click in the mic to measure (not yet compensated).
  const lag = clickReport && !clickReport.skipped && clickReport.learned.accent + clickReport.learned.beat > 0 ? clickReport.lagMs : 0;
  if (lag !== 0 && Math.abs(lag) <= 400) {
    offset -= lag / 1000;
    console.log(`[LIVIL][STUDIO] take moved ${lag} ms earlier to sit on the beat`);
  }
  if (offset < 0) {
    samples = samples.slice(Math.min(samples.length, Math.round(-offset * raw.sampleRate)));
    offset = 0;
  }
  return { samples, sampleRate: raw.sampleRate, offset, clicksRemoved, clickReport };
}

/**
 * A take owed a click repair (an old draft, or one repaired by an older version): repair every
 * version of it at its own rate, keeping shared versions shared (a raw take kept raw IS its
 * original). Yields to the screen. Convert its rate only AFTER this.
 */
export async function repairTakeClicks(take: Take): Promise<Take> {
  if ((take.clickRepair ?? 0) >= CLICK_REPAIR_VERSION) return take;
  const fix = async (x: Float32Array) => (await repairClicksAsync(x)).out;
  const original = await fix(take.original);
  const raw = take.raw === take.original ? original : await fix(take.raw);
  const tuned = take.tuned ? (take.tuned === take.raw ? raw : await fix(take.tuned)) : null;
  return { ...take, original, raw, tuned, clickRepair: CLICK_REPAIR_VERSION };
}

/** A take at another sample rate, converted to `rate` (each distinct version once). */
export async function takeAtRate(take: Take, rate: number): Promise<Take> {
  if (take.sampleRate === rate) return take;
  const conv = (x: Float32Array) => resampleAsync(x, take.sampleRate, rate);
  const original = await conv(take.original);
  const raw = take.raw === take.original ? original : await conv(take.raw);
  const tuned = take.tuned ? (take.tuned === take.raw ? raw : await conv(take.tuned)) : null;
  return { ...take, sampleRate: rate, original, raw, tuned };
}
