jest.mock('@react-native-async-storage/async-storage', () => ({}));

import { AuthClient, createClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, readSavedSession } from '../authStorage';

const memoryStore = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => { map.set(k, v); },
    removeItem: async (k: string) => { map.delete(k); },
  };
};

describe('readSavedSession', () => {
  it('returns a login, and null for anything that is not one', async () => {
    const good = { access_token: 'a', user: { id: 'u1' } };
    expect((await readSavedSession(memoryStore({ k: JSON.stringify(good) }), 'k'))?.user.id).toBe('u1');
    expect(await readSavedSession(memoryStore(), 'k')).toBeNull();
    expect(await readSavedSession(memoryStore({ k: 'not json' }), 'k')).toBeNull();
    expect(await readSavedSession(memoryStore({ k: '{"access_token":"a"}' }), 'k')).toBeNull();
  });
});

it('AUTH_STORAGE_KEY is the key the library uses for this project (changing it signs everyone out)', () => {
  const client = createClient('https://fqzrmqnlgjeuxzinbqvs.supabase.co', 'anon', {
    auth: { storage: memoryStore(), autoRefreshToken: false, persistSession: false },
  });
  expect((client.auth as unknown as { storageKey: string }).storageKey).toBe(AUTH_STORAGE_KEY);
});

// The real auth client: `isFailedRefreshEvent` relies on a refused login arriving as SIGNED_OUT.
it('the auth client signs out when the server refuses an expired login', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const store = memoryStore({
    [AUTH_STORAGE_KEY]: JSON.stringify({
      access_token: 'old.jwt.token',
      refresh_token: 'refresh-1',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) - 3600,
      user: { id: 'u1', aud: 'authenticated', email: 'a@example.com' },
    }),
  });
  const body = { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' };
  const client = new AuthClient({
    url: 'https://example.supabase.co/auth/v1',
    storageKey: AUTH_STORAGE_KEY,
    storage: store,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
    fetch: (async () => ({
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch,
  });
  const events: string[] = [];
  client.onAuthStateChange(e => { events.push(e); });

  const { data } = await client.getSession();
  expect(data.session).toBeNull();
  expect(store.map.has(AUTH_STORAGE_KEY)).toBe(false);
  expect(events).toContain('SIGNED_OUT');
  jest.restoreAllMocks();
});
