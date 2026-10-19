import {
  __resetLikeStoreForTest,
  queueLikeWrite,
  readLike,
  seedLike,
  subscribeLike,
  writeLike,
} from '../likeStore';

beforeEach(() => __resetLikeStoreForTest());

it("a surface's first look fills the tally only when nothing is known", () => {
  // The player liked it: 4, liked.
  writeLike('p1', { liked: true, count: 4 });
  // The profile card opens with the snapshot it loaded earlier: 3, not liked.
  expect(seedLike('p1', { liked: false, count: 3 })).toEqual({ liked: true, count: 4 });
  expect(readLike('p1')).toEqual({ liked: true, count: 4 });
  // A post nobody has shown yet takes the snapshot.
  expect(seedLike('p2', { liked: false, count: 3 })).toEqual({ liked: false, count: 3 });
});

it('a newer answer reaches every surface showing the post, and only those', () => {
  const card = jest.fn();
  const player = jest.fn();
  const other = jest.fn();
  subscribeLike('p1', card);
  const offPlayer = subscribeLike('p1', player);
  subscribeLike('p2', other);
  writeLike('p1', { liked: true, count: 4 });
  expect(card).toHaveBeenCalledTimes(1);
  expect(player).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();

  offPlayer();
  writeLike('p1', { liked: false, count: 3 });
  expect(card).toHaveBeenCalledTimes(2);
  expect(player).toHaveBeenCalledTimes(1);
});

it('writing what is already known notifies nobody', () => {
  writeLike('p1', { liked: true, count: 4 });
  const card = jest.fn();
  subscribeLike('p1', card);
  writeLike('p1', { liked: true, count: 4 });
  expect(card).not.toHaveBeenCalled();
});

it('a count never goes below zero', () => {
  writeLike('p1', { liked: false, count: -1 });
  expect(readLike('p1')).toEqual({ liked: false, count: 0 });
});

it("one post's server writes run in the order they were made, even when one fails", async () => {
  const order: string[] = [];
  const slow = (label: string, ms: number, fail = false) => () =>
    new Promise<void>((resolve, reject) => setTimeout(() => {
      order.push(label);
      if (fail) { reject(new Error(label)); } else { resolve(); }
    }, ms));
  const like = queueLikeWrite('p1', slow('like', 30, true));
  const unlike = queueLikeWrite('p1', slow('unlike', 1));
  const elsewhere = queueLikeWrite('p2', slow('other post', 1));
  await expect(like).rejects.toThrow('like');
  await unlike;
  await elsewhere;
  expect(order).toEqual(['other post', 'like', 'unlike']);
});
