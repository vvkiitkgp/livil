import { chatGifFrom, chatGifMetadata } from '../chatGif';

const GOOD = { gif: { provider: 'giphy', id: '3o7TKSjRrfIPjeiVyM', width: 200, height: 150 } };

it('round-trips what the picker sends', () => {
  expect(chatGifFrom(chatGifMetadata({ id: '3o7TKSjRrfIPjeiVyM', width: 200, height: 150 }))).toEqual(GOOD.gif);
});

it("never trusts the sender's metadata", () => {
  expect(chatGifFrom(null)).toBeNull();
  expect(chatGifFrom({})).toBeNull();
  expect(chatGifFrom({ gif: 'x' })).toBeNull();
  expect(chatGifFrom({ gif: { ...GOOD.gif, provider: 'tenor' } })).toBeNull();
  expect(chatGifFrom({ gif: { ...GOOD.gif, id: '../../etc' } })).toBeNull();
  expect(chatGifFrom({ gif: { ...GOOD.gif, id: 'https://evil.example/x.gif' } })).toBeNull();
  expect(chatGifFrom({ gif: { ...GOOD.gif, width: 0 } })).toBeNull();
  expect(chatGifFrom({ gif: { ...GOOD.gif, height: 99999 } })).toBeNull();
  expect(chatGifFrom({ gif: { ...GOOD.gif, width: '200' } })).toBeNull();
});

it('a track share or sticker is not a GIF', () => {
  expect(chatGifFrom({ track_id: 't', title: 'Song' })).toBeNull();
  expect(chatGifFrom({ sticker_id: 's', sticker_url: 'https://x' })).toBeNull();
});
