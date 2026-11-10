import { decodeAudioData } from 'react-native-audio-api';
import {
  isSafeId,
  parseDraftFile,
  parseUploadDraftFile,
  storedFileName,
  summaryOf,
  toDraftFile,
  uploadDraftSummary,
  UPLOAD_DRAFT_SCHEMA_VERSION,
  type DraftSummary,
  type StoredPick,
  type UploadDraftFile,
} from '../screens/studio/draftFormat';
import type { Project, VoiceLane } from '../screens/studio/studioEngine';
import { encodeWav16 } from '../utils/audioFile/wav';
import { studioFiles } from './studioFiles';
import type { PickedFile } from './uploads';

/**
 * Drafts, from the Editor and from Upload — ON THIS PHONE ONLY (ADR-0036 §9, owner 2026-10-31).
 * Nothing here touches the network or Supabase: a draft is private because it never leaves the
 * device, not because of a rule somewhere. Each user has their own folder; only the signed-in
 * user's is listed.
 */

/** Keep this much free beyond the draft itself, so saving never fills the phone. */
const SPARE_BYTES = 100 * 1024 * 1024;

export const draftsAvailable = () => studioFiles.available;
export const uploadDraftsAvailable = () => studioFiles.available && studioFiles.canCopyIn;

export function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Saves run one at a time: two overlapping saves of one draft once destroyed it. */
let saveChain: Promise<unknown> = Promise.resolve();

/**
 * The drafts list, read once and reused until a draft is saved or deleted. Drafts and New Post
 * re-read every draft's files on every visit, one file after another (~20 reads for 10 drafts),
 * exactly while the screens were sliding — the slow exit from the Editor (owner, Android,
 * 2026-11-10). Every write below bumps `listVersion` when it finishes; a list read while a write
 * was running is kept under the version it started at, so the next visit reads again.
 */
let listVersion = 0;
let listCache: { userId: string; version: number; drafts: DraftSummary[] } | null = null;
const listChanged = () => { listVersion++; listCache = null; };
/** Runs a draft write and marks the list stale once it has finished, whether it worked or not. */
function changing<T>(run: Promise<T>): Promise<T> {
  run.then(listChanged, listChanged);
  return run;
}

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
  const run = changing(saveChain.then(() => saveDraftNow(userId, project, meta)));
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
  if (listCache && listCache.userId === userId && listCache.version === listVersion) return [...listCache.drafts];
  const version = listVersion;
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
    // All drafts at once, not one after another: each read is a round trip to the native side.
    const read = async (name: string): Promise<DraftSummary | null> => {
      const upload = await readUploadDraft(userId, name);
      if (upload) return uploadDraftSummary(upload);
      const text = await studioFiles.readText(`${userId}/${name}/project.json`).catch((e: unknown) => {
        console.log(`[LIVIL][DRAFTS] ${name}: project.json unreadable`, e);
        return '';
      });
      const d = parseDraftFile(text);
      if (d && d.id === name) return summaryOf(d);
      if (text) console.log(`[LIVIL][DRAFTS] ${name}: skipped, not a draft this build can open (${text.length} chars)`);
      return null;
    };
    const out = (await Promise.all(names.map(read))).filter((d): d is DraftSummary => d !== null);
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    listCache = { userId, version, drafts: out };
    return [...out];
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
  /** After each recording file is read (2–3 per voice): files done, files in all. */
  onFile?: (done: number, total: number) => void,
): Promise<{ project: Project; title: string; createdAt: string; converted: number }> {
  if (!isSafeId(userId) || !isSafeId(id)) throw new Error('Bad draft id');
  const d = parseDraftFile(await studioFiles.readText(`${userId}/${id}/project.json`));
  if (!d || d.id !== id) throw new Error("This draft can't be opened.");
  const base = `${await studioFiles.root()}/${userId}/${id}`;
  const decoded = new Map<string, Float32Array>();
  // Progress per FILE, not per voice: reading is most of the wait, and a one-voice draft used to
  // report nothing until all of it was read (the bar sat empty, then the screen closed).
  const totalFiles = d.project.voices.reduce((n, v) => n + (v.take.files.tuned ? 3 : 2), 0);
  let filesDone = 0;
  const read = async (rel: string, rate: number) => {
    const key = `${rel}@${rate}`;
    let samples = decoded.get(key);
    if (!samples) {
      const buf = await decodeAudioData(`file://${base}/${rel}`, rate);
      // The decoded channel itself, not a copy of it: a copy doubled every take in memory while
      // the decoded original waited for the garbage collector (see CLAUDE.md, Editor memory).
      samples = buf.getChannelData(0);
      decoded.set(key, samples);
    }
    onFile?.(++filesDone, totalFiles);
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
  }
  return { project: { ...d.project, voices }, title: d.title, createdAt: d.createdAt, converted };
}

export async function deleteDraft(userId: string, id: string): Promise<void> {
  if (!isSafeId(userId) || !isSafeId(id)) return;
  await changing(studioFiles.remove(`${userId}/${id}`));
}

// ─── Upload drafts ───────────────────────────────────────────────────────────

export type UploadDraftInput = Omit<UploadDraftFile['form'], 'media' | 'picture'> & {
  id: string;
  createdAt: string;
  title: string;
  durationSec: number;
  media: PickedFile | null;
  picture: PickedFile | null;
};

/**
 * Saves (or re-saves) an upload as a draft, in line with every other draft write.
 *
 * Not the Editor's swap of a whole folder: that would copy a 100 MB video again on every save.
 * A file already in the draft stays where it is, and the JSON (written atomically by the native
 * side) only ever names files that are fully there, so a crash mid-save leaves the previous
 * version intact.
 */
export function saveUploadDraft(userId: string, input: UploadDraftInput): Promise<void> {
  const run = changing(saveChain.then(() => saveUploadDraftNow(userId, input)));
  saveChain = run.catch(() => undefined);
  return run;
}

async function saveUploadDraftNow(userId: string, input: UploadDraftInput): Promise<void> {
  if (!isSafeId(userId) || !isSafeId(input.id)) throw new Error('Bad draft id');
  const dir = `${userId}/${input.id}`;
  const own = `file://${await studioFiles.root()}/${dir}/`;
  const previous = await readUploadDraft(userId, input.id);

  const bytes = [input.media, input.picture].reduce(
    (n, p) => n + (p && !p.uri.startsWith(own) ? (p.size ?? 0) : 0),
    0,
  );
  const free = await studioFiles.freeBytes().catch(() => Infinity);
  if (free < bytes + SPARE_BYTES) throw new Error('Not enough space on this phone to save the draft.');

  const { media: pickedMedia, picture: pickedPicture, id, createdAt, title, durationSec, ...form } = input;
  const writeJson = (media: StoredPick | null, picture: StoredPick | null) => {
    const file: UploadDraftFile = {
      schemaVersion: UPLOAD_DRAFT_SCHEMA_VERSION,
      kind: 'upload',
      id,
      title,
      createdAt,
      updatedAt: new Date().toISOString(),
      durationSec,
      form: { ...form, media, picture },
    };
    return studioFiles.writeText(`${dir}/upload.json`, JSON.stringify(file));
  };
  const store = async (slot: 'media' | 'picture', p: PickedFile | null): Promise<StoredPick | null> => {
    if (!p) return null;
    const inDraft = p.uri.startsWith(own);
    const file = inDraft ? p.uri.slice(own.length) : storedFileName(slot, p.name, newDraftId());
    // The iPhone cropper hands back a bare path; every other pick is already a URI.
    if (!inDraft) await studioFiles.copyIn(p.uri.startsWith('/') ? `file://${encodeURI(p.uri)}` : p.uri, `${dir}/${file}`);
    return { file, name: p.name, type: p.type, size: p.size };
  };

  // Listed (so deletable) from the first moment: an app killed during a long copy leaves a draft
  // short of its file, not a hidden folder nobody can ever remove.
  if (!previous) await writeJson(null, null);
  try {
    const media = await store('media', pickedMedia);
    const picture = await store('picture', pickedPicture);
    await writeJson(media, picture);
    for (const old of [previous?.form.media, previous?.form.picture]) {
      if (old && old.file !== media?.file && old.file !== picture?.file) {
        await studioFiles.remove(`${dir}/${old.file}`).catch(() => false);
      }
    }
  } catch (e) {
    if (!previous) await studioFiles.remove(dir).catch(() => false);
    throw e;
  }
}

async function readUploadDraft(userId: string, id: string): Promise<UploadDraftFile | null> {
  const text = await studioFiles.readText(`${userId}/${id}/upload.json`).catch(() => '');
  const d = text ? parseUploadDraftFile(text) : null;
  return d && d.id === id ? d : null;
}

/** Opens an upload draft: what was filled in, and its files as the form holds them. */
export async function loadUploadDraft(
  userId: string,
  id: string,
): Promise<{ draft: UploadDraftFile; media: PickedFile | null; picture: PickedFile | null }> {
  if (!isSafeId(userId) || !isSafeId(id)) throw new Error('Bad draft id');
  const draft = await readUploadDraft(userId, id);
  if (!draft) throw new Error("This draft can't be opened.");
  const base = `file://${await studioFiles.root()}/${userId}/${id}/`;
  const pick = (s: StoredPick | null): PickedFile | null =>
    (s ? { uri: base + s.file, name: s.name, type: s.type, size: s.size } : null);
  return { draft, media: pick(draft.form.media), picture: pick(draft.form.picture) };
}
