import { likerToName } from '../likedBy';

const me = { userId: 'me', name: 'Vamsi' };
const vidya = { userId: 'vidya', name: 'Vidya' };

it('names the newest liker', () => {
  expect(likerToName([vidya, me], 'me', true)).toBe(vidya);
  expect(likerToName([me, vidya], 'me', true)).toBe(me);
});

it('never names the viewer once their heart is off, even if the server has not caught up', () => {
  // Like then unlike: the fetch ran before the unlike landed, so the viewer is still newest.
  expect(likerToName([me, vidya], 'me', false)).toBe(vidya);
  expect(likerToName([me], 'me', false)).toBeNull();
});

it('names nobody when there are no rows', () => {
  expect(likerToName([], 'me', true)).toBeNull();
  expect(likerToName([], 'me', false)).toBeNull();
});

it('cannot skip the viewer before it knows who they are', () => {
  expect(likerToName([me, vidya], '', false)).toBe(me);
});
