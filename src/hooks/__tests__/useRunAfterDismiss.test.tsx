/**
 * "Close this sheet, then open that modal" must wait for the sheet on iOS — iOS refuses to
 * present a modal while another is animating closed — and must still run on Android, where
 * RN never fires `onDismiss`. A callback that never runs is the failure that is easy to miss
 * here: the button would simply do nothing.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { useRunAfterDismiss } from '../useRunAfterDismiss';

type Api = ReturnType<typeof useRunAfterDismiss>;

function mount() {
  const api: { current: Api | null } = { current: null };
  function Probe() {
    api.current = useRunAfterDismiss();
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<Probe />); });
  return { api: api as { current: Api }, tree };
}

const realOS = Platform.OS;

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  jest.useRealTimers();
  Platform.OS = realOS;
});

describe('useRunAfterDismiss', () => {
  it('iOS: waits for onDismiss, then runs once', () => {
    Platform.OS = 'ios';
    const { api } = mount();
    const fn = jest.fn();
    api.current.runAfterDismiss(fn);
    jest.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();

    api.current.onDismiss();
    expect(fn).toHaveBeenCalledTimes(1);

    // The fallback timer was cleared — no second run.
    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('iOS: still runs if onDismiss never arrives', () => {
    Platform.OS = 'ios';
    const { api } = mount();
    const fn = jest.fn();
    api.current.runAfterDismiss(fn);
    jest.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Android: runs on the next tick without waiting for onDismiss', () => {
    Platform.OS = 'android';
    const { api } = mount();
    const fn = jest.fn();
    api.current.runAfterDismiss(fn);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a dismissal with nothing pending does nothing', () => {
    Platform.OS = 'ios';
    const { api } = mount();
    expect(() => api.current.onDismiss()).not.toThrow();
  });

  it('a newer callback replaces a pending one', () => {
    Platform.OS = 'ios';
    const { api } = mount();
    const first = jest.fn();
    const second = jest.fn();
    api.current.runAfterDismiss(first);
    api.current.runAfterDismiss(second);
    api.current.onDismiss();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unmounting cancels a pending callback', () => {
    Platform.OS = 'ios';
    const { api, tree } = mount();
    const fn = jest.fn();
    api.current.runAfterDismiss(fn);
    act(() => { tree.unmount(); });
    jest.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
