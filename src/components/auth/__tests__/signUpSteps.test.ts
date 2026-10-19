import { stepProblem } from '../signUpSteps';
import { cleanUsername, usernameReady } from '../usernameCheck';

jest.mock('../../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

describe('stepProblem', () => {
  it('a name step needs a name that is not just spaces', () => {
    expect(stepProblem({ kind: 'name', displayName: '   ' })).toBe('Add your name.');
    expect(stepProblem({ kind: 'name', displayName: 'Riya' })).toBeNull();
  });

  it('a username step needs the rules met and the name not taken', () => {
    expect(stepProblem({ kind: 'username', username: 'ri', status: 'invalid' })).toMatch(/3–30/);
    expect(stepProblem({ kind: 'username', username: 'riya.sings', status: 'invalid' })).toMatch(/3–30/);
    expect(stepProblem({ kind: 'username', username: 'riya_sings', status: 'taken' })).toMatch(/taken/);
    expect(stepProblem({ kind: 'username', username: 'riya_sings', status: 'available' })).toBeNull();
    // A lookup that failed does not block: the write itself refuses a taken name.
    expect(stepProblem({ kind: 'username', username: 'riya_sings', status: 'error' })).toBeNull();
  });

  it('the account step needs a real-looking email and the password rules', () => {
    expect(stepProblem({ kind: 'account', email: 'riya@', password: 'beats2026' })).toBe('Enter a valid email.');
    expect(stepProblem({ kind: 'account', email: ' riya@example.com ', password: 'short1' })).toMatch(/at least/);
    expect(stepProblem({ kind: 'account', email: 'riya@example.com', password: 'onlyletters' })).not.toBeNull();
    expect(stepProblem({ kind: 'account', email: 'riya@example.com', password: 'beats2026' })).toBeNull();
  });
});

describe('username helpers', () => {
  it('cleanUsername trims, lower-cases and drops a leading @', () => {
    expect(cleanUsername('  @Riya_Sings ')).toBe('riya_sings');
  });

  it('usernameReady holds the button while checking or when taken', () => {
    expect(usernameReady('riya_sings', 'checking')).toBe(false);
    expect(usernameReady('riya_sings', 'taken')).toBe(false);
    expect(usernameReady('ri', 'invalid')).toBe(false);
    expect(usernameReady('riya_sings', 'available')).toBe(true);
    expect(usernameReady('riya_sings', 'error')).toBe(true);
  });
});
