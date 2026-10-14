/**
 * The first play milestone (5 plays) is when strangers start listening, so it reads as
 * that; every later one keeps its "hit N plays" line.
 */
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../spotify', () => ({ fetchSpotifyTrackIds: jest.fn() }));
jest.mock('../pushDispatch', () => ({ sendPush: jest.fn() }));

import { activityBubbleParts, type ActivityItem } from '../activity';

const milestone = (threshold: number) =>
  ({ type: 'play_milestone', threshold } as unknown as ActivityItem);

it('greets the first listeners at 5 plays', () => {
  expect(activityBubbleParts(milestone(5))).toEqual({
    actor: null,
    text: 'Your first listeners are in 🎉 5 plays so far',
  });
});

it('keeps the milestone line from 25 plays up', () => {
  expect(activityBubbleParts(milestone(25)).text).toBe('Your track hit 25 plays 🎉');
  expect(activityBubbleParts(milestone(1000)).text).toBe('Your track hit 1K plays 🎉');
});
