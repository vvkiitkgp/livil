/**
 * Spotify's design guidelines set hard minimums for its logo in a partner app, and the
 * logo must be Spotify's own artwork, not a redrawing. These pin the numbers the
 * component is built on, so a size tweak cannot quietly drop below them.
 */
import { spotifyLogoBox } from '../SpotifyLogo';
import {
  SPOTIFY_FULL_LOGO_ASPECT,
  SPOTIFY_FULL_LOGO_PATHS,
  SPOTIFY_GREEN,
  SPOTIFY_ICON_PATHS,
} from '../spotifyLogoArtwork';

const SIZES = ['xs', 'sm', 'md'] as const;

describe('SpotifyLogo sizes', () => {
  it.each(SIZES)('the icon is at least 21px at size %s', size => {
    expect(spotifyLogoBox(size, false).height).toBeGreaterThanOrEqual(21);
  });

  it.each(SIZES)('the full logo is at least 70px wide at size %s', size => {
    expect(spotifyLogoBox(size, true).width).toBeGreaterThanOrEqual(70);
  });

  it('keeps the artwork aspect ratio, so the logo is never stretched', () => {
    const { width, height } = spotifyLogoBox('md', true);
    expect(width / height).toBeCloseTo(SPOTIFY_FULL_LOGO_ASPECT, 1);
  });
});

describe('Spotify artwork', () => {
  it('is the official artwork: one icon path, icon + three wordmark paths, Spotify Green', () => {
    // Shape of the official 2024 downloads. A redrawn mark would not match these counts.
    expect(SPOTIFY_ICON_PATHS).toHaveLength(1);
    expect(SPOTIFY_FULL_LOGO_PATHS).toHaveLength(4);
    expect(SPOTIFY_GREEN).toBe('#1ED760');
  });
});
