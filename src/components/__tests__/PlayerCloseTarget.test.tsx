import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import PlayerCloseTarget from '../PlayerCloseTarget';
import { haptics } from '../../utils/haptics';
import { CLOSE_HOLD_MS } from '../../utils/playerCloseGesture';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  cancelAnimation: jest.fn(),
  Easing: { linear: (x: number) => x },
  useAnimatedProps: (build: () => object) => build(),
  // Stable across renders, like the real one: the hold's effect depends on it.
  useSharedValue: (value: number) => jest.requireActual('react').useRef({ value }).current,
  withTiming: (value: number) => value,
}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle' }));
jest.mock('../Icon', () => ({ Icon: 'Icon' }));
jest.mock('../../utils/haptics', () => ({ haptics: { impact: jest.fn(), select: jest.fn() } }));

function render(holding: boolean, onHoldComplete: () => void): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PlayerCloseTarget visible holding={holding} bottom={50} onHoldComplete={onHoldComplete} />,
    );
  });
  return tree;
}

function update(tree: ReactTestRenderer, holding: boolean, onHoldComplete: () => void) {
  act(() => {
    tree.update(<PlayerCloseTarget visible holding={holding} bottom={50} onHoldComplete={onHoldComplete} />);
  });
}

function advance(ms: number) {
  act(() => { jest.advanceTimersByTime(ms); });
}

const label = (tree: ReactTestRenderer) => tree.root.findByType(Text).props.children;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); });

describe('PlayerCloseTarget', () => {
  it('closes only after the full 2 seconds on the X', () => {
    const onHoldComplete = jest.fn();
    render(true, onHoldComplete);
    expect(CLOSE_HOLD_MS).toBe(2000);
    advance(1999);
    expect(onHoldComplete).not.toHaveBeenCalled();
    advance(1);
    expect(onHoldComplete).toHaveBeenCalledTimes(1);
  });

  it('never closes while the X is only showing', () => {
    const onHoldComplete = jest.fn();
    render(false, onHoldComplete);
    advance(10_000);
    expect(onHoldComplete).not.toHaveBeenCalled();
  });

  it('cancels when the circle leaves the X, however late', () => {
    const onHoldComplete = jest.fn();
    const tree = render(true, onHoldComplete);
    advance(1900);
    update(tree, false, onHoldComplete);
    advance(10_000);
    expect(onHoldComplete).not.toHaveBeenCalled();
  });

  it('needs a full 2 seconds again after leaving and coming back', () => {
    const onHoldComplete = jest.fn();
    const tree = render(true, onHoldComplete);
    advance(1900);
    update(tree, false, onHoldComplete);
    update(tree, true, onHoldComplete);
    advance(1999);
    expect(onHoldComplete).not.toHaveBeenCalled();
    advance(1);
    expect(onHoldComplete).toHaveBeenCalledTimes(1);
  });

  it('counts down in the label and resets after leaving', () => {
    const onHoldComplete = jest.fn();
    const tree = render(false, onHoldComplete);
    expect(label(tree)).toBe('Drag on X to close');
    update(tree, true, onHoldComplete);
    expect(label(tree)).toBe('Keep holding 2');
    advance(1000);
    expect(label(tree)).toBe('Keep holding 1');
    update(tree, false, onHoldComplete);
    update(tree, true, onHoldComplete);
    expect(label(tree)).toBe('Keep holding 2');
  });

  it('calls the callback from the latest render', () => {
    const stale = jest.fn();
    const latest = jest.fn();
    const tree = render(true, stale);
    update(tree, true, latest);
    advance(2000);
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('buzzes on landing and once per remaining second', () => {
    render(true, jest.fn());
    expect(haptics.impact).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(haptics.select).toHaveBeenCalledTimes(1);
  });
});
