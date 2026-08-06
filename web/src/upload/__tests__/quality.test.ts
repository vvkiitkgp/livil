/**
 * File quality — the bitrate and frame-size reading on the level pill.
 *
 * The bitrate is derived from size ÷ duration rather than parsed from a codec header, so
 * what is worth pinning is that the derivation lands on the number the artist actually
 * exported at, and that it declines to guess when it has nothing to go on. A wrong bitrate
 * is worse than no bitrate: it would send somebody back to re-export a file that was fine.
 */
import { describeQuality } from '../quality';

/** `kbps` for `seconds` of audio, as a byte count. */
const bytesFor = (kbps: number, seconds: number) => (kbps * 1000 * seconds) / 8;

const audio = (over: Partial<Parameters<typeof describeQuality>[0]> = {}) => ({
  name: 'track.mp3',
  size: bytesFor(320, 200),
  mode: 'audio' as const,
  duration: 200,
  width: null,
  height: null,
  ...over,
});

describe('describeQuality — audio', () => {
  it('reports the export setting, not the arithmetic', () => {
    // Real files carry container overhead and artwork, so the measured rate lands near the
    // nominal one rather than on it.
    expect(describeQuality(audio({ size: bytesFor(317, 200) }))?.value).toBe('≈320 kbps');
    expect(describeQuality(audio({ size: bytesFor(122, 200) }))?.value).toBe('≈128 kbps');
  });

  it('leaves a genuine VBR rate between two standards alone', () => {
    // 240 sits between 224 and 256. Snapping it to either would misreport a fine file.
    expect(describeQuality(audio({ size: bytesFor(240, 200) }))?.value).toBe('≈240 kbps');
  });

  it('flags a lossy export worth redoing', () => {
    expect(describeQuality(audio({ size: bytesFor(96, 200) }))?.poor).toBe(true);
    expect(describeQuality(audio({ size: bytesFor(320, 200) }))?.poor).toBe(false);
  });

  it('does not put a bitrate on a lossless file', () => {
    // 1411 kbps is a property of 16/44.1, not of the mix, and inviting a comparison with
    // 320 would read as "eleven times better".
    const wav = describeQuality(audio({ name: 'master.wav', size: 50_000_000 }));
    expect(wav?.value).toBe('Lossless');
    expect(wav?.poor).toBe(false);
    expect(describeQuality(audio({ name: 'master.flac' }))?.value).toBe('Lossless');
  });

  it('says nothing rather than guessing when the duration has not arrived', () => {
    expect(describeQuality(audio({ duration: null }))).toBeNull();
    expect(describeQuality(audio({ duration: 0 }))).toBeNull();
  });
});

describe('describeQuality — video', () => {
  const video = (width: number, height: number) => ({
    name: 'clip.mp4',
    size: 80_000_000,
    mode: 'video' as const,
    duration: 120,
    width,
    height,
  });

  it('reports the frame size and the name people use for it', () => {
    expect(describeQuality(video(1920, 1080))?.value).toBe('1920×1080');
    expect(describeQuality(video(1920, 1080))?.note).toContain('1080p');
    expect(describeQuality(video(3840, 2160))?.note).toContain('4K');
  });

  it('flags anything a phone will have to upscale', () => {
    expect(describeQuality(video(854, 480))?.poor).toBe(true);
    expect(describeQuality(video(1280, 720))?.poor).toBe(false);
  });

  it('names a vertical video by its SHORT side, the way resolutions are named', () => {
    // 1080×1920 is a portrait 1080p, the same 1080p as 1920×1080. Naming it by height
    // would call it 1440p — wrong, and flattering.
    const portrait = describeQuality(video(1080, 1920));
    expect(portrait?.note).toContain('1080p');
    expect(portrait?.poor).toBe(false);
  });

  it('does not let a vertical phone bounce pass on its long side', () => {
    // 540×960: the height clears 720, the actual resolution does not. The tier buckets
    // round down — the exact pixels are already in the value beside it.
    const bounce = describeQuality(video(540, 960));
    expect(bounce?.value).toBe('540×960');
    expect(bounce?.note).toContain('480p');
    expect(bounce?.poor).toBe(true);
  });

  it('says nothing until the probe has returned a frame size', () => {
    expect(describeQuality({ ...video(0, 0), width: null, height: null })).toBeNull();
  });
});
