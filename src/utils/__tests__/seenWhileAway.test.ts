import { AppState, Platform } from 'react-native';
import { seenMustWait } from '../seenWhileAway';

const realOS = Platform.OS;
const setState = (s: string) =>
  Object.defineProperty(AppState, 'currentState', { value: s, configurable: true });

afterAll(() => { Platform.OS = realOS; });

it('waits on Android while backgrounded — the socket stays open there', () => {
  Platform.OS = 'android';
  setState('background');
  expect(seenMustWait()).toBe(true);
});

it('does not wait on Android in the foreground', () => {
  Platform.OS = 'android';
  setState('active');
  expect(seenMustWait()).toBe(false);
});

it('never waits on iOS, so iPhone behaviour is unchanged (a backgrounded jam included)', () => {
  Platform.OS = 'ios';
  setState('background');
  expect(seenMustWait()).toBe(false);
  setState('inactive');
  expect(seenMustWait()).toBe(false);
});
