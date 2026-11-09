/**
 * The Editor's tempo stepper. It has tests because its timing is the feature: in the Editor a
 * new tempo restarts playback and redraws every track, and a held button used to ask for that
 * on every step, so the number crawled and taps lagged (2026-11-09).
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BpmStepper } from '../BpmStepper';

jest.mock('../../../utils/haptics', () => ({ haptics: { tick: jest.fn() } }));

function mount(props: Partial<React.ComponentProps<typeof BpmStepper>> & { onBpm: (bpm: number) => void }) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(<BpmStepper bpm={92} {...props} />); });
  const button = (name: string) => tree.root.findAll(n => n.props.accessibilityLabel === name && typeof n.props.onPressIn === 'function')[0];
  const slower = button('Slower');
  const faster = button('Faster');
  const label = () => tree.root.findAll(n => typeof n.props.children === 'string' && n.props.children.endsWith(' BPM'))[0].props.children as string;
  return { tree, slower, faster, label };
}

describe('BpmStepper', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('hands every step over at once by default (Record)', () => {
    const onBpm = jest.fn();
    const { faster } = mount({ onBpm });
    act(() => { faster.props.onPressIn(); faster.props.onPressOut(); });
    expect(onBpm).toHaveBeenCalledWith(93);
  });

  it('settle: the number runs ahead and the tempo is handed over once, when the hold ends', () => {
    const onBpm = jest.fn();
    const { faster, label } = mount({ onBpm, settle: true });
    act(() => { faster.props.onPressIn(); });
    act(() => { jest.advanceTimersByTime(1500); });
    const held = Number(label().split(' ')[0]);
    expect(held).toBeGreaterThan(98);
    expect(onBpm).not.toHaveBeenCalled();
    act(() => { faster.props.onPressOut(); });
    act(() => { jest.advanceTimersByTime(299); });
    expect(onBpm).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(2); });
    expect(onBpm).toHaveBeenCalledTimes(1);
    expect(onBpm).toHaveBeenCalledWith(held);
  });

  it('settle: quick taps become one change', () => {
    const onBpm = jest.fn();
    const { slower, label } = mount({ onBpm, settle: true });
    for (let i = 0; i < 4; i++) {
      act(() => { slower.props.onPressIn(); slower.props.onPressOut(); });
      act(() => { jest.advanceTimersByTime(120); });
    }
    expect(label()).toBe('88 BPM');
    expect(onBpm).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(300); });
    expect(onBpm).toHaveBeenCalledTimes(1);
    expect(onBpm).toHaveBeenCalledWith(88);
  });

  it('settle: a tempo still waiting is handed over when the stepper goes away', () => {
    const onBpm = jest.fn();
    const { faster, tree } = mount({ onBpm, settle: true });
    act(() => { faster.props.onPressIn(); faster.props.onPressOut(); });
    act(() => { tree.unmount(); });
    expect(onBpm).toHaveBeenCalledWith(93);
  });

  it('steps from a sung tempo (96.4) to the next whole BPM', () => {
    const onBpm = jest.fn();
    const { faster, slower } = mount({ onBpm, bpm: 96.4 });
    act(() => { faster.props.onPressIn(); faster.props.onPressOut(); });
    expect(onBpm).toHaveBeenLastCalledWith(97);
    act(() => { slower.props.onPressIn(); slower.props.onPressOut(); });
    expect(onBpm).toHaveBeenLastCalledWith(96);
  });
});
