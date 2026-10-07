/**
 * The "Friends with … and N others" grammar at each size that reads differently.
 */
import { mutualsParts, mutualsSentence } from '../mutualsText';

const say = (names: string[], noun?: { one: string; many: string }) => {
  const parts = mutualsParts('Friends with', names, noun);
  return parts ? mutualsSentence(parts) : null;
};

describe('mutualsParts', () => {
  it('is null when there is nobody in common', () => {
    expect(say([])).toBeNull();
  });

  it('names one person', () => {
    expect(say(['riya'])).toBe('Friends with riya');
  });

  it('joins two with "and", no count', () => {
    expect(say(['riya', 'sam'])).toBe('Friends with riya and sam');
  });

  it('says "1 other" (singular) at three', () => {
    expect(say(['riya', 'sam', 'kiran'])).toBe('Friends with riya, sam and 1 other');
  });

  it('counts the rest past two names', () => {
    expect(say(['a', 'b', 'c', 'd', 'e'])).toBe('Friends with a, b and 3 others');
  });

  it('takes a custom noun for the rest', () => {
    const noun = { one: 'other friend', many: 'other friends' };
    expect(say(['a', 'b', 'c'], noun)).toBe('Friends with a, b and 1 other friend');
    expect(say(['a', 'b', 'c', 'd'], noun)).toBe('Friends with a, b and 2 other friends');
  });

  it('bolds the names and the count, never the connecting words', () => {
    const parts = mutualsParts('Friends with', ['a', 'b', 'c', 'd'])!;
    expect(parts.filter(p => p.bold).map(p => p.text)).toEqual(['a', 'b', '2 others']);
  });
});
