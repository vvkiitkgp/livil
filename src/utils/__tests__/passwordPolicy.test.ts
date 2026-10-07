import { isWeakPasswordError, passwordProblem } from '../passwordPolicy';

test('rejects eight zeros (the reported case)', () => {
  expect(passwordProblem('00000000')).not.toBeNull();
});

test('rejects anything under 8 characters', () => {
  expect(passwordProblem('abc123')).toMatch(/at least 8/);
});

test('rejects letters-only and digits-only', () => {
  expect(passwordProblem('password')).not.toBeNull();
  expect(passwordProblem('12345678')).not.toBeNull();
});

test('accepts 8+ characters with a letter and a number', () => {
  expect(passwordProblem('riya2026')).toBeNull();
  expect(passwordProblem('Long passphrase with 1 digit')).toBeNull();
});

test('recognises Supabase weak-password errors by code or message', () => {
  expect(isWeakPasswordError({ code: 'weak_password', message: 'x' })).toBe(true);
  expect(isWeakPasswordError({ message: 'Password is known to be weak and easy to guess, please choose a different one.' })).toBe(true);
  expect(isWeakPasswordError({ message: 'Invalid login credentials' })).toBe(false);
  expect(isWeakPasswordError(null)).toBe(false);
});
