import { postIdFromUrl, profileHandleIfExactLink, profileUsernameFromUrl } from '../shareLinks';
import { buildProfileShareMessage, profileDeepLink, profileShareUrl } from '../../constants/links';

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

describe('profileUsernameFromUrl', () => {
  describe('accepts the two forms the app and the web page publish', () => {
    it('reads the profile link people put in their bio', () => {
      expect(profileUsernameFromUrl('https://livil-music.com/@riya')).toBe('riya');
    });

    it('reads the custom scheme the web page hands off with', () => {
      expect(profileUsernameFromUrl('livil://profile/riya')).toBe('riya');
    });

    it('reads the www form and a trailing slash', () => {
      expect(profileUsernameFromUrl('https://www.livil-music.com/@riya/')).toBe('riya');
    });

    it('ignores tracking params, and lowercases the handle as it is stored', () => {
      expect(profileUsernameFromUrl('https://livil-music.com/@Riya_99?igsh=abc')).toBe('riya_99');
    });

    it('reads an over-escaped @', () => {
      expect(profileUsernameFromUrl('https://livil-music.com/%40riya')).toBe('riya');
    });

    it('round-trips what the app itself builds', () => {
      expect(profileUsernameFromUrl(profileShareUrl('riya_99'))).toBe('riya_99');
      expect(profileUsernameFromUrl(profileDeepLink('riya_99'))).toBe('riya_99');
    });
  });

  describe('refuses everything else', () => {
    it('refuses lookalike hosts and http', () => {
      expect(profileUsernameFromUrl('https://livil-music.com.evil.test/@riya')).toBeNull();
      expect(profileUsernameFromUrl('https://evil.test/@riya')).toBeNull();
      expect(profileUsernameFromUrl('http://livil-music.com/@riya')).toBeNull();
    });

    it('refuses userinfo tricks, which is where an @ in the URL usually means trouble', () => {
      // Parsed by hand (not URL()), so these are judged by the exact authority string.
      expect(profileUsernameFromUrl('https://livil-music.com@evil.test/@riya')).toBeNull();
      expect(profileUsernameFromUrl('https://user@livil-music.com/@riya')).toBeNull();
      expect(profileUsernameFromUrl('https://livil-music.com:8443/@riya')).toBeNull();
    });

    it('accepts an uppercased scheme and host, as a pasted link can carry', () => {
      expect(profileUsernameFromUrl('HTTPS://Livil-Music.com/@riya')).toBe('riya');
    });

    it('is not fooled by a post link, and a post link is not fooled by it', () => {
      const id = '8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e';
      expect(profileUsernameFromUrl(`https://livil-music.com/p/${id}`)).toBeNull();
      expect(postIdFromUrl('https://livil-music.com/@riya')).toBeNull();
    });

    it('refuses a path without the @, and a deeper path', () => {
      expect(profileUsernameFromUrl('https://livil-music.com/riya')).toBeNull();
      expect(profileUsernameFromUrl('https://livil-music.com/@riya/posts')).toBeNull();
      expect(profileUsernameFromUrl('https://livil-music.com/studio')).toBeNull();
    });

    it('refuses a handle that could not be one', () => {
      expect(profileUsernameFromUrl("https://livil-music.com/@' or 1=1--")).toBeNull();
      expect(profileUsernameFromUrl('livil://profile/../../etc')).toBeNull();
      expect(profileUsernameFromUrl('https://livil-music.com/@')).toBeNull();
      expect(profileUsernameFromUrl('livil://profile/')).toBeNull();
    });

    it('refuses auth links and junk without throwing', () => {
      expect(profileUsernameFromUrl('livil://auth?code=abc123')).toBeNull();
      expect(profileUsernameFromUrl('')).toBeNull();
      expect(profileUsernameFromUrl('not a url at all')).toBeNull();
      expect(profileUsernameFromUrl('https://livil-music.com/@%E0%A4%A')).toBeNull();
    });
  });
});

describe('profileHandleIfExactLink — when a chat message becomes a profile card', () => {
  it('accepts exactly what the Share sheet sends, and a pasted copy of it', () => {
    expect(profileHandleIfExactLink(profileShareUrl('riya'))).toBe('riya');
    expect(profileHandleIfExactLink('  https://livil-music.com/@riya\n')).toBe('riya');
    expect(profileHandleIfExactLink('https://www.livil-music.com/@riya/')).toBe('riya');
  });

  it('keeps anything with extra text as text, so nothing is hidden behind a card', () => {
    // Each of these parses as a profile link for OPENING it — and each carries words the
    // card would swallow on new builds while old builds show them.
    expect(profileHandleIfExactLink('https://livil-music.com/@riya?Your account is locked')).toBeNull();
    expect(profileHandleIfExactLink('https://livil-music.com/@riya#\nhidden lines')).toBeNull();
    expect(profileHandleIfExactLink('livil://profile/riya?any text')).toBeNull();
    expect(profileHandleIfExactLink('livil://profile/riya/ any text')).toBeNull();
    expect(profileHandleIfExactLink('check this out https://livil-music.com/@riya')).toBeNull();
  });

  it('keeps a non-canonical spelling as text rather than guessing', () => {
    expect(profileHandleIfExactLink('https://livil-music.com/@Riya')).toBeNull();
    expect(profileHandleIfExactLink('https://livil-music.com/%40riya')).toBeNull();
  });
});

describe('buildProfileShareMessage', () => {
  it('speaks in the first person only about your own profile', () => {
    expect(buildProfileShareMessage('riya', { isOwn: true })).toBe(
      'Follow me on Livil 🎵\n\nhttps://livil-music.com/@riya',
    );
    expect(buildProfileShareMessage('riya', { isOwn: false, name: 'Riya' })).toBe(
      'Check out Riya on Livil 🎵\n\nhttps://livil-music.com/@riya',
    );
    expect(buildProfileShareMessage('riya', { isOwn: false, name: '  ' })).toBe(
      'Check out @riya on Livil 🎵\n\nhttps://livil-music.com/@riya',
    );
  });
});
