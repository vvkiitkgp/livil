import { retryOnce } from '../retryOnce';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('returns the first result without retrying', async () => {
  const fn = jest.fn().mockResolvedValue(3);
  await expect(retryOnce(fn)).resolves.toBe(3);
  expect(fn).toHaveBeenCalledTimes(1);
});

it('retries once after the delay when the first call fails', async () => {
  const fn = jest.fn()
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValueOnce(7);
  const p = retryOnce(fn, 1000);
  await Promise.resolve();
  expect(fn).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1000);
  await expect(p).resolves.toBe(7);
  expect(fn).toHaveBeenCalledTimes(2);
});

it('gives up after the second failure, so callers keep their fallback', async () => {
  const fn = jest.fn().mockRejectedValue(new Error('down'));
  const p = retryOnce(fn, 10);
  const assertion = expect(p).rejects.toThrow('down');
  await jest.advanceTimersByTimeAsync(10);
  await assertion;
  expect(fn).toHaveBeenCalledTimes(2);
});
