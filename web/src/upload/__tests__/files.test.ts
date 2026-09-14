/**
 * Cover-art pairing for batch upload.
 *
 * Worth pinning because the failure is quiet and expensive: a wrong pairing publishes a
 * track with someone else's artwork, and cover art is not something the artist re-checks
 * after a twelve-track upload.
 */
import { pairAssets } from '../files';

const file = (name: string, type = '') => new File([new Uint8Array([1])], name, { type });

describe('pairAssets — matching artwork to tracks', () => {
  it('matches artwork by filename stem', () => {
    const { items } = pairAssets([
      file('01 Intro.mp3', 'audio/mpeg'),
      file('01 Intro.jpg', 'image/jpeg'),
      file('02 Drift.mp3', 'audio/mpeg'),
      file('02 Drift.jpg', 'image/jpeg'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]!.image!.name).toBe('01 Intro.jpg');
    expect(items[1]!.image!.name).toBe('02 Drift.jpg');
  });

  it('ignores case and extension when matching', () => {
    const { items } = pairAssets([
      file('Sunset.WAV', 'audio/wav'),
      file('sunset.PNG', 'image/png'),
    ]);
    expect(items[0]!.image!.name).toBe('sunset.PNG');
  });

  it('applies a single unmatched image to every track as album art', () => {
    const { items, sharedImage } = pairAssets([
      file('a.mp3', 'audio/mpeg'),
      file('b.mp3', 'audio/mpeg'),
      file('cover.jpg', 'image/jpeg'),
    ]);
    expect(sharedImage!.name).toBe('cover.jpg');
    expect(items.every(i => i.image?.name === 'cover.jpg')).toBe(true);
  });

  it('prefers a stem match over the shared cover', () => {
    const { items } = pairAssets([
      file('a.mp3', 'audio/mpeg'),
      file('a.jpg', 'image/jpeg'),
      file('b.mp3', 'audio/mpeg'),
      file('cover.jpg', 'image/jpeg'),
    ]);
    const a = items.find(i => i.media.name === 'a.mp3')!;
    const b = items.find(i => i.media.name === 'b.mp3')!;
    expect(a.image!.name).toBe('a.jpg');
    expect(b.image!.name).toBe('cover.jpg');
  });

  it('leaves artwork unset when several images are ambiguous', () => {
    // Guessing here is worse than asking: publishing the wrong cover is silent.
    const { items, sharedImage } = pairAssets([
      file('a.mp3', 'audio/mpeg'),
      file('front.jpg', 'image/jpeg'),
      file('back.jpg', 'image/jpeg'),
    ]);
    expect(sharedImage).toBeNull();
    expect(items[0]!.image).toBeNull();
  });
});

describe('pairAssets — deciding what counts as media', () => {
  it('accepts audio and video by MIME type', () => {
    const { items } = pairAssets([
      file('song.mp3', 'audio/mpeg'),
      file('clip.mp4', 'video/mp4'),
    ]);
    expect(items).toHaveLength(2);
  });

  it('falls back to the extension when the browser reports no type', () => {
    // AIFF is the usual case — browsers routinely hand back an empty File.type for it,
    // and silently dropping an artist's master would be the worst possible response.
    const { items } = pairAssets([file('master.aiff'), file('take.aif')]);
    expect(items.map(i => i.media.name)).toEqual(['master.aiff', 'take.aif']);
  });

  it('does not treat images or stray files as tracks', () => {
    const { items } = pairAssets([
      file('cover.jpg', 'image/jpeg'),
      file('notes.txt', 'text/plain'),
    ]);
    expect(items).toHaveLength(0);
  });
});
