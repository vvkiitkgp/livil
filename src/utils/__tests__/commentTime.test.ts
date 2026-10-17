/** The time beside a comment's author: "just now" for its first minute, then 1m, 2h, 3d… */

import { relativeTime } from '../../utils/commentTime';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

it('says "just now" for the whole first minute', () => {
  expect(relativeTime(ago(0), NOW)).toBe('just now');
  expect(relativeTime(ago(14), NOW)).toBe('just now');
  expect(relativeTime(ago(59), NOW)).toBe('just now');
});

it('then minutes, hours and days, as before', () => {
  expect(relativeTime(ago(60), NOW)).toBe('1m');
  expect(relativeTime(ago(2 * 3600), NOW)).toBe('2h');
  expect(relativeTime(ago(3 * 86400), NOW)).toBe('3d');
});

it('a time a little in the future (clock skew) is "just now", not negative', () => {
  expect(relativeTime(new Date(NOW + 5000).toISOString(), NOW)).toBe('just now');
});
