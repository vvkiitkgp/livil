import {
  findSpotifyLinkInText,
  looksLikeSpotifyLink,
  parseSpotifyTrackId,
  spotifyTrackUrl,
} from '../spotifyLinks';

const ID = '0VjIjW4GlUZAMYd2vXMi3b';

describe('parseSpotifyTrackId', () => {
  it.each([
    [`https://open.spotify.com/track/${ID}`],
    [`https://open.spotify.com/track/${ID}?si=a1b2c3`],
    [`https://open.spotify.com/intl-de/track/${ID}`],
    [`open.spotify.com/track/${ID}`],
    [`spotify:track:${ID}`],
    [ID],
    [`  https://open.spotify.com/track/${ID}  `],
  ])('finds the track id in %s', input => {
    expect(parseSpotifyTrackId(input)).toBe(ID);
  });

  it.each([
    [`https://open.spotify.com/album/${ID}`],
    [`https://open.spotify.com/playlist/${ID}`],
    [`https://open.spotify.com.evil.example/track/${ID}`],
    [`https://example.com/?u=open.spotify.com/track/${ID}`],
    ['https://open.spotify.com/track/tooShort'],
    ['blinding lights'],
    [''],
  ])('refuses %s', input => {
    expect(parseSpotifyTrackId(input)).toBeNull();
  });
});

describe('looksLikeSpotifyLink', () => {
  it('treats Spotify links — including short links — as links, and words as a search', () => {
    expect(looksLikeSpotifyLink(`https://open.spotify.com/track/${ID}`)).toBe(true);
    expect(looksLikeSpotifyLink('https://spotify.link/AbCd1234')).toBe(true);
    expect(looksLikeSpotifyLink(`spotify:track:${ID}`)).toBe(true);
    expect(looksLikeSpotifyLink('the weeknd')).toBe(false);
    expect(looksLikeSpotifyLink('https://youtube.com/watch?v=x')).toBe(false);
  });
});

describe('spotifyTrackUrl', () => {
  it('builds the public URL the Spotify app opens', () => {
    expect(spotifyTrackUrl(ID)).toBe(`https://open.spotify.com/track/${ID}`);
  });
});

describe('findSpotifyLinkInText', () => {
  it('finds a pasted share link on its own', () => {
    const text = `https://open.spotify.com/track/${ID}?si=a1b2c3`;
    expect(findSpotifyLinkInText(text)).toEqual({ id: ID, match: text });
  });

  it('finds the link inside a sentence and reports exactly what to remove', () => {
    const link = `https://open.spotify.com/track/${ID}?si=x`;
    const found = findSpotifyLinkInText(`listen to this ${link} on repeat`);
    expect(found).toEqual({ id: ID, match: link });
  });

  it('finds spotify: URIs and locale links', () => {
    expect(findSpotifyLinkInText(`spotify:track:${ID}`)?.id).toBe(ID);
    expect(findSpotifyLinkInText(`(https://open.spotify.com/intl-de/track/${ID})`)?.id).toBe(ID);
  });

  it('returns a short link for the server to resolve', () => {
    expect(findSpotifyLinkInText('try https://spotify.link/AbCd1234 now')).toEqual({
      shortUrl: 'https://spotify.link/AbCd1234',
      match: 'https://spotify.link/AbCd1234',
    });
  });

  it('ignores albums, playlists, other sites and Spotify-looking fragments inside other URLs', () => {
    expect(findSpotifyLinkInText(`https://open.spotify.com/album/${ID}`)).toBeNull();
    expect(findSpotifyLinkInText(`https://open.spotify.com/playlist/${ID}`)).toBeNull();
    expect(findSpotifyLinkInText(`https://evil.example/open.spotify.com/track/${ID}`)).toBeNull();
    expect(findSpotifyLinkInText(`https://evil.example?u=https://open.spotify.com/track/${ID}`)).toBeNull();
    expect(findSpotifyLinkInText('see you at 8')).toBeNull();
  });
});
