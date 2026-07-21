/**
 * Contract test over the JavaScript ↔ native prop seam.
 *
 * WHY THIS IS THE HIGHEST-VALUE TEST IN THE REPOSITORY
 *
 * The Livil patch adds three props that cross into native code. Each must be declared in
 * THREE separate files inside react-native-video, because the prop reaches native via
 * {...rest} in Video.tsx — there is no single declaration to get wrong:
 *
 *   src/specs/VideoNativeComponent.ts   the codegen spec — what native actually receives
 *   src/types/video.ts                  the source-level type
 *   lib/types/video.d.ts                the published type
 *
 * A missed mirror does not fail the build, does not warn, and does not throw. The prop is
 * SILENTLY DROPPED: the lock screen simply stops showing the clip, or background next/prev
 * stops working, and only on a real device in a release build. kb/architecture/playback.md
 * calls this seam "easy to silently break" — a sentence that has been doing a regression
 * test's job.
 *
 * This test also guards a second failure mode: the patch lives in node_modules and is
 * reapplied by patch-package on install. If the patch fails to apply, or someone edits
 * node_modules without re-capturing, these declarations vanish. That is invisible until a
 * user reports the lock screen misbehaving.
 *
 * See kb/decisions/0002-patched-video-library.md and PROP-0001.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RNV = join(__dirname, '../../../node_modules/react-native-video');

/** The three props the Livil patch adds. Adding a fourth? Add it here. */
const PATCH_PROPS = [
  'mediaQueueJson',
  'currentClipJson',
  'mediaSessionStateJson',
] as const;

/** Every location a prop must be declared for it to reach native. */
const MIRRORS = [
  'src/specs/VideoNativeComponent.ts',
  'src/types/video.ts',
  'lib/types/video.d.ts',
] as const;

/**
 * Strip comments before matching.
 *
 * Without this the test is worthless: commenting a declaration out still leaves the text
 * in the file, so a naive regex matches and the test passes. That defect was in the first
 * version of this file and was caught by mutation-testing it — which is the entire reason
 * for mutation-testing (Constitution P29).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block
    .replace(/^\s*\/\/.*$/gm, '') // whole-line
    .replace(/\/\/.*$/gm, ''); // trailing
}

function read(rel: string): string {
  const p = join(RNV, rel);
  if (!existsSync(p)) {
    throw new Error(
      `${rel} is missing from react-native-video.\n` +
        'The patch may not have applied. Run: npx patch-package',
    );
  }
  return stripComments(readFileSync(p, 'utf8'));
}

describe('native prop seam', () => {
  describe.each(MIRRORS)('%s', mirror => {
    const source = read(mirror);

    it.each(PATCH_PROPS)('declares %s', prop => {
      // A declaration, not a mention in a comment.
      const declared = new RegExp(`\\b${prop}\\??\\s*:\\s*string`).test(source);
      expect(declared).toBe(true);
    });
  });

  it('declares every patch prop in all three mirrors', () => {
    // Stated as one assertion so a failure names exactly which pairing is missing,
    // rather than making someone cross-reference three separate failures.
    const missing: string[] = [];
    for (const mirror of MIRRORS) {
      const source = read(mirror);
      for (const prop of PATCH_PROPS) {
        if (!new RegExp(`\\b${prop}\\??\\s*:\\s*string`).test(source)) {
          missing.push(`${prop} not declared in ${mirror}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('sends every declared patch prop from the audio engine', () => {
    // The other direction: a prop declared but never sent is dead weight, and a prop
    // sent but not declared is silently dropped. GlobalAudioPlayer is the only component
    // permitted to own the media session (ADR-0001), so it is the only sender.
    const engine = stripComments(
      readFileSync(join(__dirname, '../../components/GlobalAudioPlayer.tsx'), 'utf8'),
    );
    const notSent = PATCH_PROPS.filter(
      prop => !new RegExp(`${prop}\\s*=\\s*\\{`).test(engine),
    );
    expect(notSent).toEqual([]);
  });
});
