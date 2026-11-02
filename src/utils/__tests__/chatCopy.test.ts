import { copyableText } from '../chatCopy';

const text = (body: string | null, extra: Partial<Parameters<typeof copyableText>[0]> = {}) =>
  copyableText({ kind: 'text', body, metadata: null, deletedAt: null, ...extra });

describe('copyableText', () => {
  it("copies a text message's words exactly, line breaks and all", () => {
    expect(text('see you at 7\nbring the aux')).toBe('see you at 7\nbring the aux');
  });

  it('copies a link message (a Spotify song is sent as its link)', () => {
    expect(text('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe(
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    );
  });

  it('offers nothing for a GIF or a disappearing photo — their body is only a label', () => {
    expect(text('🎞 GIF', { metadata: { gif: { provider: 'giphy', id: 'abc123XYZ', width: 200, height: 150 } } })).toBeNull();
    expect(
      text('📷 Photo · Update Livil to view', {
        metadata: {
          media: {
            v: 1,
            type: 'photo',
            object: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg',
            mime: 'image/jpeg',
            width: 1080,
            height: 1350,
          },
        },
      }),
    ).toBeNull();
  });

  it('offers nothing for a deleted message, an empty body, or a non-text kind', () => {
    expect(text('gone', { deletedAt: '2026-11-02T10:00:00Z' })).toBeNull();
    expect(text('   ')).toBeNull();
    expect(text(null)).toBeNull();
    expect(copyableText({ kind: 'track_share', body: null, metadata: { title: 'Kesariya' }, deletedAt: null })).toBeNull();
  });
});
