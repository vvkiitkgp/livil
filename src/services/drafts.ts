import { decodeAudioData } from 'react-native-audio-api';
import {
  isSafeId,
  parseDraftFile,
  summaryOf,
  toDraftFile,
  type DraftSummary,
} from '../screens/studio/draftFormat';
import type { Project, VoiceLane } from '../screens/studio/studioEngine';
import { encodeWav16 } from '../utils/audioFile/wav';
import { studioFiles } from './studioFiles';

/**
 * Editor drafts — ON THIS PHONE ONLY (ADR-0036 §9, owner 2026-10-31). Nothing here touches
 * the network or Supabase: a draft is private because it never leaves the device, not because
 * of a rule somewhere. Each user has their own folder; only the signed-in user's is listed.
 */

/** Keep this much free beyond the draft itself, so saving never fills the phone. */
const SPARE_BYTES = 100 * 1024 * 1024;

export const draftsAvailable = () => studioFiles.available;

export function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Saves run one at a time: two overlapping saves of one draft once destroyed it. */
let saveChain: Promise<unknown> = Promise.resolve();

/**
 * Saves (or re-saves) a draft. Written into `<id>.saving/` first and swapped in at the end,
 * so a crash mid-save leaves the previous version intact.
 *
 * One at a time: two overlapping saves shared the `.saving` folder, and the loser's swap
 * removed the draft and then failed, leaving a folder with no project.json — the draft was
 * gone (2026-10-31, a Create post tapped while the song was still loading).
 */
export function saveDraft(
  userId: string,
  project: Project,
  meta: { id: string; title: string; createdAt: string; durationSec: number },
): Promise<void> {
  const run = saveChain.then(() => saveDraftNow(userId, project, meta));
  saveChain = run.catch(() => undefined);
  return run;
}

/**
 * Writes the finished song (Create post) next to the draft — IN LINE with saves. A save swaps
 * the whole draft folder for a fresh one, so a song written while a save was running landed in
 * the folder being thrown away and Upload got a file that no longer existed (2026-11-02).
 * Returns the file's URI.
 */
export function writeDraftMix(userId: string, id: string, bytes: Uint8Array): Promise<string> {
  const run = saveChain.then(async () => {
    if (!isSafeId(userId) || !isSafeId(id)) throw new Error('Bad draft id');
    const rel = `${userId}/${id}/mix.flac`;
    await studioFiles.writeBytes(rel, bytes);
    return `file://${await studioFiles.root()}/${rel}`;
  });
  saveChain = run.catch(() => undefined);
  return run;
}

async function saveDraftNow(
  userId: string,
  project: Project,
  meta: { id: string; title: string; createdAt: string; durationSec: number },
): Promise<void> {
  if (!isSafeId(userId) || !isSafeId(meta.id)) throw new Error('Bad draft id');
  const { file, audio } = toDraftFile(project, { ...meta, updatedAt: new Date().toISOString() });
  const bytes = audio.reduce((n, a) => n + 44 + a.samples.length * 2, 0);
  const free = await studioFiles.freeBytes().catch(() => Infinity);
  if (free < bytes + SPARE_BYTES) throw new Error('Not enough space on this phone to save the draft.');
  const dir = `${userId}/${meta.id}`;
  const tmp = `${dir}.saving`;
  await studioFiles.remove(tmp).catch(() => false);
  for (const a of audio) {
    await studioFiles.writeBytes(`${tmp}/${a.path}`, encodeWav16(a.samples, a.sampleRate));
  }
  await studioFiles.writeText(`${tmp}/project.json`, JSON.stringify(file));
  // Swap without ever having no draft: the old one steps aside, the new one moves in, and
  // only then is the old one removed. If moving in fails, the old one comes back.
  const old = `${dir}.old`;
  await studioFiles.remove(old).catch(() => false);
  const hadOld = await studioFiles.move(dir, old).then(() => true, () => false);
  try {
    await studioFiles.move(tmp, dir);
  } catch (e) {
    if (hadOld) await studioFiles.move(old, dir).catch(() => undefined);
    throw e;
  }
  if (hadOld) await studioFiles.remove(old).catch(() => false);
}

/** The signed-in user's drafts, newest first. Never throws: no drafts → []. */
export async function listDrafts(userId: string): Promise<DraftSummary[]> {
  if (!studioFiles.available || !isSafeId(userId)) return [];
  try {
    const all = await studioFiles.listDirs(userId);
    // A save interrupted mid-swap (app killed) leaves the previous version as `<id>.old`
    // with no `<id>`: put it back.
    for (const n of all) {
      const id = n.endsWith('.old') ? n.slice(0, -4) : null;
      if (id && isSafeId(id) && !all.includes(id)) {
        await studioFiles.move(`${userId}/${n}`, `${userId}/${id}`).catch(() => undefined);
        all.push(id);
      }
    }
    const names = all.filter(n => isSafeId(n));
    const out: DraftSummary[] = [];
    for (const name of names) {
      const text = await studioFiles.readText(`${userId}/${name}/project.json`).catch((e: unknown) => {
        console.log(`[LIVIL][DRAFTS] ${name}: project.json unreadable`, e);
        return '';
      });
      const d = parseDraftFile(text);
      if (d && d.id === name) out.push(summaryOf(d));
      else if (text) console.log(`[LIVIL][DRAFTS] ${name}: skipped, not a draft this build can open (${text.length} chars)`);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

/**
 * Opens a draft back into an Editor project (audio decoded from its WAVs).
 *
 * A take is decoded at the Editor's fixed `sampleRate` — the native decoder converts a take
 * saved at another rate on the way in (fast; the audio library never converts a buffer's rate
 * when playing it). EXCEPT a take still owed a click repair (`clickRepair` below
 * `repairVersion`): that one is decoded at its OWN rate, because a rate conversion smears a
 * one-sample click into a burst; the caller repairs it, then converts it (StudioScreen).
 * `onTake(i, n)` reports progress.
 */
export async function loadDraft(
  userId: string,
  id: string,
  sampleRate: number,
  repairVersion: number,
  onTake?: (done: number, total: number) => void,
): Promise<{ project: Project; title: string; createdAt: string; converted: number }> {
  if (!isSafeId(userId) || !isSafeId(id)) throw new Error('Bad draft id');
  const d = parseDraftFile(await studioFiles.readText(`${userId}/${id}/project.json`));
  if (!d || d.id !== id) throw new Error("This draft can't be opened.");
  const base = `${await studioFiles.root()}/${userId}/${id}`;
  const decoded = new Map<string, Float32Array>();
  const read = async (rel: string, rate: number) => {
    const key = `${rel}@${rate}`;
    const hit = decoded.get(key);
    if (hit) return hit;
    const buf = await decodeAudioData(`file://${base}/${rel}`, rate);
    // The decoded channel itself, not a copy of it: a copy doubled every take in memory while
    // the decoded original waited for the garbage collector (see CLAUDE.md, Editor memory).
    const samples = buf.getChannelData(0);
    decoded.set(key, samples);
    return samples;
  };
  const voices: VoiceLane[] = [];
  let converted = 0;
  for (const v of d.project.voices) {
    const t = v.take;
    const clickRepair = typeof t.clickRepair === 'number' ? t.clickRepair : t.clicksRepaired ? 1 : 0;
    const rate = clickRepair < repairVersion ? t.sampleRate : sampleRate;
    if (t.sampleRate !== rate) converted++;
    voices.push({
      ...v,
      take: {
        id: t.id,
        sampleRate: rate,
        tune: t.tune,
        clickRepair,
        original: await read(t.files.original, rate),
        raw: await read(t.files.raw, rate),
        tuned: t.files.tuned ? await read(t.files.tuned, rate) : null,
      },
    });
    onTake?.(voices.length, d.project.voices.length);
  }
  return { project: { ...d.project, voices }, title: d.title, createdAt: d.createdAt, converted };
}

export async function deleteDraft(userId: string, id: string): Promise<void> {
  if (!isSafeId(userId) || !isSafeId(id)) return;
  await studioFiles.remove(`${userId}/${id}`);
}
