/**
 * The Apple popup → Supabase hand-off.
 *
 * Pinned because none of it can be exercised before production: Apple refuses localhost, so
 * the first real run is on livil-music.com. The rules that would lock people out quietly:
 * the popup must open inside the click (Safari blocks it otherwise), the nonce must reach
 * Apple hashed and Supabase raw, a foreign state must be refused, and a cancelled popup
 * must not be reported as an error.
 */
import { createHash, webcrypto } from 'crypto';
import type { AppleIdApi, AppleIdConfig, AppleIdResponse } from '../appleId';
import { makeNonce } from '../appleId';

const mockSignInWithIdToken = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();

jest.mock('../../supabase', () => ({
  supabase: {
    auth: { signInWithIdToken: (args: unknown) => mockSignInWithIdToken(args) },
    from: (table: string) => ({
      update: (values: unknown) => {
        mockUpdate(table, values);
        const chain = {
          eq: (column: string, value: unknown) => {
            mockEq(column, value);
            return chain;
          },
          then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  },
}));

// `basePath` reads `import.meta.env`, which Jest cannot parse.
jest.mock('../../basePath', () => ({
  studioUrl: (path: string) => `https://livil-music.com/studio${path}`,
}));

import { signInWithApple, type AppleSignInRequest } from '../signIn';

function fakeApple(answer: (config: AppleIdConfig) => Promise<AppleIdResponse>) {
  let config: AppleIdConfig | null = null;
  const calls: string[] = [];
  const api: AppleIdApi = {
    auth: {
      init: c => {
        calls.push('init');
        config = c;
      },
      signIn: () => {
        calls.push('signIn');
        return answer(config!);
      },
    },
  };
  return { api, calls, config: () => config! };
}

async function request(api: AppleIdApi): Promise<AppleSignInRequest> {
  return { api, nonce: await makeNonce(webcrypto as unknown as Crypto), state: 'state-123' };
}

const ok = (config: AppleIdConfig, user?: AppleIdResponse['user']): AppleIdResponse => ({
  authorization: { id_token: 'apple.jwt', state: config.state },
  user,
});

beforeEach(() => {
  mockSignInWithIdToken
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mockUpdate.mockReset();
  mockEq.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it('opens the popup synchronously, inside the click', async () => {
  const apple = fakeApple(async c => ok(c));
  const req = await request(apple.api);

  const pending = signInWithApple(req);
  // Nothing awaited yet — if init/signIn had not run by now, Safari would block the window.
  expect(apple.calls).toEqual(['init', 'signIn']);
  await pending;
});

it('configures Apple for the website and the registered return URL', async () => {
  const apple = fakeApple(async c => ok(c));
  await signInWithApple(await request(apple.api));

  expect(apple.config()).toMatchObject({
    clientId: 'com.livil.web',
    scope: 'name email',
    redirectURI: 'https://livil-music.com/studio/',
    usePopup: true,
    state: 'state-123',
  });
});

it('sends Apple the hashed nonce and Supabase the raw one', async () => {
  const apple = fakeApple(async c => ok(c));
  const req = await request(apple.api);
  const result = await signInWithApple(req);

  expect(result).toEqual({ ok: true });
  expect(apple.config().nonce).toBe(createHash('sha256').update(req.nonce.raw).digest('hex'));
  expect(mockSignInWithIdToken).toHaveBeenCalledWith({
    provider: 'apple',
    token: 'apple.jwt',
    nonce: req.nonce.raw,
  });
});

it('refuses an answer whose state is not ours', async () => {
  const apple = fakeApple(async () => ({ authorization: { id_token: 'x', state: 'other' } }));
  const result = await signInWithApple(await request(apple.api));

  expect(result.ok).toBe(false);
  expect(mockSignInWithIdToken).not.toHaveBeenCalled();
});

it('stays silent when the person closes Apple’s window', async () => {
  const apple = fakeApple(() => Promise.reject({ error: 'popup_closed_by_user' }));
  expect(await signInWithApple(await request(apple.api))).toEqual({ ok: false, message: null });
});

it('explains a blocked popup', async () => {
  const apple = fakeApple(() => Promise.reject({ error: 'popup_blocked_by_browser' }));
  const result = await signInWithApple(await request(apple.api));
  expect(result).toEqual({ ok: false, message: expect.stringMatching(/pop-ups/) });
});

it('does not show Supabase’s raw token error to the person', async () => {
  mockSignInWithIdToken.mockResolvedValue({
    data: { user: null },
    error: { message: 'Unacceptable audience in id_token: [com.livil.web]', status: 400 },
  });
  const apple = fakeApple(async c => ok(c));
  const result = await signInWithApple(await request(apple.api));

  expect(result.ok).toBe(false);
  expect(result.ok === false && result.message).not.toMatch(/audience/);
});

it('keeps the name Apple shares on first sign-in, only on a profile still being created', async () => {
  const apple = fakeApple(async c => ok(c, { name: { firstName: 'Riya', lastName: 'Sharma' } }));
  await signInWithApple(await request(apple.api));

  expect(mockUpdate).toHaveBeenCalledWith('profiles', { display_name: 'Riya Sharma' });
  expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
  expect(mockEq).toHaveBeenCalledWith('username_set', false);
});

it('writes nothing when Apple sends no name (every later sign-in)', async () => {
  const apple = fakeApple(async c => ok(c));
  await signInWithApple(await request(apple.api));
  expect(mockUpdate).not.toHaveBeenCalled();
});
