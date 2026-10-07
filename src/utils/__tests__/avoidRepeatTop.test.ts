import { avoidRepeatTop } from '../avoidRepeatTop';

const p = (id: string) => ({ id });

it('swaps the first two when the new page opens with the post that was just on top', () => {
  const next = [p('stranger-dots'), p('beat-it'), p('photography')];
  expect(avoidRepeatTop(next, 'stranger-dots').map(x => x.id))
    .toEqual(['beat-it', 'stranger-dots', 'photography']);
});

it('leaves the order alone when the top already changed', () => {
  const next = [p('beat-it'), p('stranger-dots'), p('photography')];
  expect(avoidRepeatTop(next, 'stranger-dots').map(x => x.id))
    .toEqual(['beat-it', 'stranger-dots', 'photography']);
});

it('leaves a one-post feed alone — there is nothing to swap with', () => {
  expect(avoidRepeatTop([p('only')], 'only').map(x => x.id)).toEqual(['only']);
});

it('leaves the order alone with no previous top (first load)', () => {
  const next = [p('a'), p('b')];
  expect(avoidRepeatTop(next, null).map(x => x.id)).toEqual(['a', 'b']);
});

it('never mutates the server page', () => {
  const next = [p('a'), p('b')];
  avoidRepeatTop(next, 'a');
  expect(next.map(x => x.id)).toEqual(['a', 'b']);
});
