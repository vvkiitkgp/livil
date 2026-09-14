import { postIdFromUrl } from '../shareLinks';

const ID = '8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e';

describe('postIdFromUrl', () => {
  describe('accepts the two forms the app actually publishes', () => {
    it('reads the custom scheme', () => {
      expect(postIdFromUrl(`livil://post/${ID}`)).toBe(ID);
    });

    it('reads the https share link', () => {
      expect(postIdFromUrl(`https://livil-music.com/p/${ID}`)).toBe(ID);
    });

    it('reads the www form, which a pasted link can carry', () => {
      expect(postIdFromUrl(`https://www.livil-music.com/p/${ID}`)).toBe(ID);
    });

    it('ignores a trailing query — chat apps append tracking params', () => {
      expect(postIdFromUrl(`https://livil-music.com/p/${ID}?utm_source=whatsapp`)).toBe(ID);
      expect(postIdFromUrl(`livil://post/${ID}?ref=story`)).toBe(ID);
    });

    it('normalises an uppercased uuid rather than rejecting it', () => {
      expect(postIdFromUrl(`https://livil-music.com/p/${ID.toUpperCase()}`)).toBe(ID);
    });
  });

  describe('refuses lookalike hosts', () => {
    // The whole reason this matches a PARSED host instead of calling includes():
    // every string below contains "livil-music.com" and none of them is ours.
    it.each([
      `https://livil-music.com.evil.test/p/${ID}`,
      `https://evil.test/livil-music.com/p/${ID}`,
      `https://notlivil-music.com/p/${ID}`,
      `https://evil.test/p/${ID}?x=livil-music.com`,
    ])('rejects %s', url => {
      expect(postIdFromUrl(url)).toBeNull();
    });
  });

  describe('refuses everything else', () => {
    it('rejects http — a downgraded link is not ours', () => {
      expect(postIdFromUrl(`http://livil-music.com/p/${ID}`)).toBeNull();
    });

    it('rejects an auth deep link, which has its own handler', () => {
      expect(postIdFromUrl('livil://auth?code=abc123')).toBeNull();
    });

    it('rejects a non-uuid id rather than passing a free-form string on', () => {
      expect(postIdFromUrl('https://livil-music.com/p/not-a-uuid')).toBeNull();
      expect(postIdFromUrl("https://livil-music.com/p/' or 1=1--")).toBeNull();
      expect(postIdFromUrl('livil://post/../../etc/passwd')).toBeNull();
    });

    it('rejects a deeper path, so future /p/ routes cannot open a post by accident', () => {
      expect(postIdFromUrl(`https://livil-music.com/p/${ID}/edit`)).toBeNull();
    });

    it('rejects the marketing pages and the dashboard', () => {
      expect(postIdFromUrl('https://livil-music.com/')).toBeNull();
      expect(postIdFromUrl('https://livil-music.com/studio/tracks')).toBeNull();
      expect(postIdFromUrl('https://livil-music.com/privacy-policy.html')).toBeNull();
    });

    it('rejects junk without throwing', () => {
      expect(postIdFromUrl('')).toBeNull();
      expect(postIdFromUrl('not a url at all')).toBeNull();
      expect(postIdFromUrl('livil://post/')).toBeNull();
    });
  });
});
