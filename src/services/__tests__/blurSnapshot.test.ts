const mockCapture = jest.fn();
jest.mock('react-native-view-shot', () => ({ captureRef: (...args: unknown[]) => mockCapture(...args) }));

import { takeBlurSnapshot } from '../blurSnapshot';

const view = { current: null };

beforeEach(() => {
  mockCapture.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('takes a small picture in memory, never a file', async () => {
  mockCapture.mockResolvedValue('data:image/jpeg;base64,AAAA');
  await expect(takeBlurSnapshot(view)).resolves.toBe('data:image/jpeg;base64,AAAA');
  const [target, options] = mockCapture.mock.calls[0];
  expect(target).toBe(view);
  expect(options.result).toBe('data-uri');
  expect(options.width).toBeLessThanOrEqual(240);
});

it('a failed picture only means no blur', async () => {
  mockCapture.mockRejectedValue(new Error('view not found'));
  await expect(takeBlurSnapshot(view)).resolves.toBeNull();
});
