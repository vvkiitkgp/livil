/**
 * "What am I actually about to publish?" — the file's quality, in the two units that
 * matter to the person uploading it.
 *
 * Audio gets a bitrate, video gets a frame size, because those are the numbers each
 * medium is judged on and the ones an artist can act on: a 96 kbps export is worth
 * redoing, a 480p bounce is worth re-rendering, and neither is visible from a filename.
 *
 * The bitrate is DERIVED (bytes × 8 ÷ seconds), not read from a codec header. That is a
 * deliberate trade: parsing MP3/AAC/FLAC headers in the browser to recover the encoder's
 * nominal setting is a decoder's worth of work for a number that would differ from this
 * one by a couple of percent. Container overhead and embedded artwork are counted in, so
 * everything here is labelled as approximate and rounded to the settings people actually
 * export at.
 */
export type Quality = {
  /** The headline: `≈320 kbps`, `1920×1080`. */
  value: string;
  /** The qualifier under it: `MP3 · lossy`, `1080p`. Empty when there is nothing to add. */
  note: string;
  /** Worth a second look before publishing — a bitrate or a frame size below par. */
  poor: boolean;
};

/** Common export settings, so a derived 317 kbps is reported as the 320 the artist chose. */
const BITRATE_STEPS = [64, 96, 128, 160, 192, 224, 256, 320];

/** Below this, the upload is audibly worse than the source and probably a mistake. */
const LOW_BITRATE_KBPS = 160;

/** Below this on the short side, the video will be upscaled on every phone that plays it. */
const LOW_VIDEO_SIDE = 720;

const LOSSLESS = /\.(wav|flac|aiff?|alac)$/i;

const extensionOf = (name: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toUpperCase() : '';
};

/**
 * Snap to a standard rate when we are close to one; otherwise report what we measured.
 *
 * The window must stay under HALF the tightest gap between adjacent steps (224→256, 14%),
 * or a genuine VBR rate sitting between two standards gets pulled onto the wrong one — 240
 * kbps reported as 224 sends somebody off to re-export a file that was fine. 6% still
 * absorbs the container overhead and embedded artwork that push a 320 export to ~325.
 */
const SNAP_TOLERANCE = 0.06;

function snapBitrate(kbps: number): number {
  for (const step of BITRATE_STEPS) {
    if (Math.abs(kbps - step) / step <= SNAP_TOLERANCE) return step;
  }
  return Math.round(kbps / 8) * 8;
}

/**
 * The shorthand people actually say: 1080p, 4K.
 *
 * Takes the SHORT side, not the height. Resolution names are short-side names — a vertical
 * 1080×1920 export is "1080p vertical", the same 1080p as a 1920×1080 landscape one. Naming
 * it by height would call it 1440p, which is both wrong and flattering, and would let a
 * 540×960 phone bounce pass as 720p.
 */
function tierFor(shortSide: number): string {
  if (shortSide >= 2160) return '4K';
  if (shortSide >= 1440) return '1440p';
  if (shortSide >= 1080) return '1080p';
  if (shortSide >= 720) return '720p';
  if (shortSide >= 480) return '480p';
  return `${shortSide}p`;
}

export function describeQuality(file: {
  name: string;
  size: number;
  mode: 'audio' | 'video';
  duration: number | null;
  width: number | null;
  height: number | null;
}): Quality | null {
  const ext = extensionOf(file.name);

  if (file.mode === 'video') {
    // No frame size yet (still probing, or a container the browser would not open).
    if (!file.width || !file.height) return null;
    // Tier only, no container: the exact pixels matter (a portrait 1080×1920 is not a small
    // video) and the tier is the word people say, but the extension is already on the row
    // and a third term wraps the chip onto two lines.
    const shortSide = Math.min(file.width, file.height);
    return {
      value: `${file.width}×${file.height}`,
      note: tierFor(shortSide),
      poor: shortSide < LOW_VIDEO_SIDE,
    };
  }

  if (LOSSLESS.test(file.name)) {
    // A lossless file's bitrate is a function of sample rate and depth, not of quality.
    // Reporting "≈1411 kbps" invites a comparison with 320 that means nothing.
    return { value: 'Lossless', note: ext, poor: false };
  }

  if (!file.duration || file.duration <= 0) return null;
  const kbps = snapBitrate((file.size * 8) / file.duration / 1000);
  // The format alone, not "MP3 · lossy": the second half is redundant to anyone shipping
  // music, and the extra word pushed the chip onto two lines in the pill.
  return { value: `≈${kbps} kbps`, note: ext, poor: kbps < LOW_BITRATE_KBPS };
}
