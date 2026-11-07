import { emitPostDeleted, onPostDeleted } from '../postEvents';

describe('post deleted event', () => {
  it('reaches a listener with the post id, until it unsubscribes', () => {
    const listener = jest.fn();
    const sub = onPostDeleted(listener);

    emitPostDeleted('p1');
    expect(listener).toHaveBeenCalledWith('p1');

    sub.remove();
    emitPostDeleted('p2');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
