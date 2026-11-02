/**
 * The saved shape of an Editor draft (ADR-0036 §9) — pure, so it unit-tests. The I/O lives in
 * src/services/drafts.ts. A draft is a folder `<userId>/<draftId>/` with `project.json` and
 * one WAV per distinct take version, referenced by RELATIVE paths only (the iOS container
 * path changes on every app update).
 */
import { HEADROOM } from '../../utils/audioFx/effects';
import { sanitizeSynths } from '../../utils/synth';
import type { Project, TuneChoice, VoiceLane } from './studioEngine';

export const DRAFT_SCHEMA_VERSION = 1;

export type StoredTake = {
  id: string;
  sampleRate: number;
  tune: TuneChoice;
  clickRepair?: number;
  /** Drafts from the first repair (2026-11-02 morning) said only "repaired". */
  clicksRepaired?: boolean;
  files: { original: string; raw: string; tuned: string | null };
};

export type StoredVoice = Omit<VoiceLane, 'take'> & { take: StoredTake };

export type DraftFile = {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Length of what plays (the trim), for the Drafts list. */
  durationSec: number;
  project: Omit<Project, 'voices'> & { voices: StoredVoice[] };
};

export type DraftSummary = Pick<DraftFile, 'id' | 'title' | 'updatedAt' | 'durationSec'> & {
  voiceCount: number;
  /** Synth parts, plus the drums when there is a beat. */
  instrumentCount: number;
};

/** A path a draft may point at: relative, inside its own folder, a plain .wav name. */
export function isSafeDraftPath(p: unknown): p is string {
  return typeof p === 'string' && /^takes\/[A-Za-z0-9_-]+\.wav$/.test(p);
}

/** A draft or user folder name: no slashes, dots or anything a path could abuse. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/**
 * The JSON for `project`, plus the audio it needs written: each distinct Float32Array once
 * (a take kept raw has raw === original, so it is stored once).
 */
export function toDraftFile(
  project: Project,
  meta: { id: string; title: string; createdAt: string; updatedAt: string; durationSec: number },
): { file: DraftFile; audio: { path: string; samples: Float32Array; sampleRate: number }[] } {
  const audio: { path: string; samples: Float32Array; sampleRate: number }[] = [];
  const pathOf = new Map<Float32Array, string>();
  const store = (samples: Float32Array, sampleRate: number, name: string) => {
    const hit = pathOf.get(samples);
    if (hit) return hit;
    const path = `takes/${name}.wav`;
    pathOf.set(samples, path);
    audio.push({ path, samples, sampleRate });
    return path;
  };
  const voices: StoredVoice[] = project.voices.map(v => {
    const t = v.take;
    return {
      ...v,
      take: {
        id: t.id,
        sampleRate: t.sampleRate,
        tune: t.tune,
        clickRepair: t.clickRepair ?? 0,
        files: {
          original: store(t.original, t.sampleRate, `${t.id}-original`),
          raw: store(t.raw, t.sampleRate, `${t.id}-raw`),
          tuned: t.tuned ? store(t.tuned, t.sampleRate, `${t.id}-tuned`) : null,
        },
      },
    };
  });
  return {
    file: { schemaVersion: DRAFT_SCHEMA_VERSION, ...meta, project: { ...project, voices } },
    audio,
  };
}

/** Parses and checks a project.json; null when it isn't a draft this build can open safely. */
export function parseDraftFile(text: string): DraftFile | null {
  let d: DraftFile;
  try { d = JSON.parse(text) as DraftFile; } catch { return null; }
  if (!d || d.schemaVersion !== DRAFT_SCHEMA_VERSION || !isSafeId(d.id)) return null;
  const voices = d.project?.voices;
  if (!Array.isArray(voices)) return null;
  for (const v of voices) {
    const f = v?.take?.files;
    if (!f || !isSafeDraftPath(f.original) || !isSafeDraftPath(f.raw) || (f.tuned !== null && !isSafeDraftPath(f.tuned))) return null;
    if (!isSafeId(v.id) || !isSafeId(v.take.id) || !(v.take.sampleRate > 0)) return null;
  }
  // Settings added after the first drafts: an old draft opens exactly as it sounded.
  for (const v of voices) if (!(typeof v.level === 'number' && v.level > 0 && v.level <= 8)) v.level = 1;
  // Synth parts are pure settings (no audio files): keep what this build can play, and
  // drafts saved before instruments existed simply have none.
  d.project.synths = sanitizeSynths(d.project.synths);
  const mv = d.project.masterVolume;
  if (!(typeof mv === 'number' && mv >= 0 && mv <= HEADROOM)) d.project.masterVolume = 1;
  return d;
}

/** "12:59 am" — 12-hour, as people read a clock. */
export const clock12 = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;

/**
 * A draft's name for the list. Untitled drafts are named after when they were made, and the
 * first ones were named on a 24-hour clock ("Draft · 2 Nov, 0:59"): show those as "12:59 am".
 */
export function displayTitle(title: string): string {
  const m = /^(Draft · \d{1,2} \w+), (\d{1,2}):(\d{2})$/.exec(title);
  return m ? `${m[1]}, ${clock12(Number(m[2]), Number(m[3]))}` : title;
}

export function summaryOf(d: DraftFile): DraftSummary {
  const p = d.project;
  const beat = p.drumsOn && !!p.pattern && Object.values(p.pattern).some(row => Array.isArray(row) && row.some(Boolean));
  return {
    id: d.id, title: d.title, updatedAt: d.updatedAt, durationSec: d.durationSec,
    voiceCount: p.voices.length,
    instrumentCount: (p.synths?.length ?? 0) + (beat ? 1 : 0),
  };
}
