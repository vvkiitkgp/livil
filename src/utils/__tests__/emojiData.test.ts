import { chunk, EMOJI_CATEGORIES, searchEmojis } from '../emojiData';

describe('EMOJI_CATEGORIES', () => {
  it('every emoji has search words and a real character', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emojis.length).toBeGreaterThan(0);
      for (const e of c.emojis) {
        expect(e.char).not.toMatch(/[a-z ]/i);
        expect(e.words.length).toBeGreaterThan(0);
      }
    }
  });

  it('no emoji is listed twice', () => {
    const all = EMOJI_CATEGORIES.flatMap(c => c.emojis.map(e => e.char));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('searchEmojis', () => {
  it('finds by a word, in any case', () => {
    expect(searchEmojis('FIRE')).toContain('🔥');
    expect(searchEmojis('chai')).toEqual(expect.arrayContaining(['☕', '🍵']));
  });

  it('needs every word typed', () => {
    expect(searchEmojis('heart broken')).toEqual(['💔']);
  });

  it('nothing typed or nothing found is empty', () => {
    expect(searchEmojis('   ')).toEqual([]);
    expect(searchEmojis('zzzzqq')).toEqual([]);
  });
});

it('chunk makes rows, with a short last one', () => {
  expect(chunk(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  expect(chunk([], 2)).toEqual([]);
});
