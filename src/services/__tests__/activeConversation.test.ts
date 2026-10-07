import {
  setActiveConversation,
  getActiveConversation,
  onConversationPing,
  pingConversation,
} from '../activeConversation';

afterEach(() => { setActiveConversation(null); });

it('tracks the open chat and clears it on blur', () => {
  setActiveConversation('conv-riya');
  expect(getActiveConversation()).toBe('conv-riya');
  setActiveConversation(null);
  expect(getActiveConversation()).toBeNull();
});

it('pings only the listeners of that conversation', () => {
  const riya = jest.fn();
  const sam = jest.fn();
  const offRiya = onConversationPing('conv-riya', riya);
  const offSam = onConversationPing('conv-sam', sam);
  expect(pingConversation('conv-riya')).toBe(true);
  expect(riya).toHaveBeenCalledTimes(1);
  expect(sam).not.toHaveBeenCalled();
  offRiya();
  offSam();
});

it('reports nobody listening once the chat screen unsubscribes, so the banner is shown after all', () => {
  const off = onConversationPing('conv-riya', jest.fn());
  off();
  expect(pingConversation('conv-riya')).toBe(false);
});

it('a throwing listener does not stop the others', () => {
  const good = jest.fn();
  const offBad = onConversationPing('conv-riya', () => { throw new Error('boom'); });
  const offGood = onConversationPing('conv-riya', good);
  expect(() => pingConversation('conv-riya')).not.toThrow();
  expect(good).toHaveBeenCalledTimes(1);
  offBad();
  offGood();
});
