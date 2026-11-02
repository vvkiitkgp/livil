import { NativeModules } from 'react-native';
import { toBase64 } from '../utils/audioFile/wav';

/**
 * The drafts folder on this phone (ADR-0036 §9), through the app's own native module:
 * ios/livil/LivilStudioFiles.m, android/.../StudioFilesModule.kt. Paths are RELATIVE to
 * the drafts root; the native side rejects anything that would leave it.
 *
 * `available` is false on a build made before the module existed (the JS can reach a phone
 * through Metro before the native rebuild) — callers hide drafts rather than error.
 */
type Native = {
  root(): Promise<string>;
  writeBase64(rel: string, data: string, append: boolean): Promise<boolean>;
  writeText(rel: string, text: string): Promise<boolean>;
  readText(rel: string): Promise<string>;
  listDirs(rel: string): Promise<string[]>;
  move(from: string, to: string): Promise<boolean>;
  remove(rel: string): Promise<boolean>;
  freeBytes(): Promise<number>;
};

const native: Native | undefined = NativeModules.LivilStudioFiles;

export const studioFiles = {
  available: !!native,

  /** Absolute path of the drafts root — for `file://` URIs (decoding, uploading). */
  root: () => need().root(),

  /**
   * Writes `bytes` to `rel`, in ~768 KB slices so no single bridge message carries a whole
   * take as one huge string.
   */
  async writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    const n = need();
    // A multiple of 3: every slice but the last is padding-free. Small enough that encoding one
    // slice never holds the screen for long — taps and playback carry on while a draft saves.
    const SLICE = 3 * 64 * 1024;
    if (bytes.length === 0) { await n.writeBase64(rel, '', false); return; }
    for (let at = 0; at < bytes.length; at += SLICE) {
      await n.writeBase64(rel, toBase64(bytes, at, Math.min(bytes.length, at + SLICE)), at > 0);
    }
  },

  /**
   * Writes already-base64 data to `rel`, in slices like writeBytes (each a multiple of 4
   * characters, so every slice decodes on its own). Used by disappearing chat photos
   * (src/services/chatMedia.ts), which arrive as base64 from FileReader.
   */
  async writeBase64(rel: string, base64: string): Promise<void> {
    const n = need();
    const SLICE = 4 * 64 * 1024;
    if (base64.length === 0) { await n.writeBase64(rel, '', false); return; }
    for (let at = 0; at < base64.length; at += SLICE) {
      await n.writeBase64(rel, base64.slice(at, at + SLICE), at > 0);
    }
  },

  writeText: (rel: string, text: string) => need().writeText(rel, text),
  readText: (rel: string) => need().readText(rel),
  listDirs: (rel: string) => need().listDirs(rel),
  move: (from: string, to: string) => need().move(from, to),
  remove: (rel: string) => need().remove(rel),
  freeBytes: () => need().freeBytes(),
};

function need(): Native {
  if (!native) throw new Error('Drafts need the app rebuilt (LivilStudioFiles is missing).');
  return native;
}
