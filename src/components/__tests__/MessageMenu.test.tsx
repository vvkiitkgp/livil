/**
 * The long-press menu: reactions above the message, its actions below, and every way out.
 */
import React from 'react';
import { Image, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 50, bottom: 30, left: 0, right: 0 }),
}));

import MessageMenu, { type MessageMenuAction } from '../MessageMenu';

type Props = React.ComponentProps<typeof MessageMenu>;

function render(over: Partial<Props> = {}) {
  const props = {
    visible: true,
    anchor: { y: 300, height: 50 },
    backdropUri: null,
    alignRight: false,
    timeLabel: '4:22 PM',
    reactions: ['❤️', '😂'],
    myReaction: null,
    actions: [] as MessageMenuAction[],
    onPick: jest.fn(),
    onMore: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<MessageMenu {...props}><Text>Hello</Text></MessageMenu>);
  });
  const press = (label: string) => act(() => { r.root.findByProps({ accessibilityLabel: label }).props.onPress(); });
  const hasLabel = (label: string) => r.root.findAllByProps({ accessibilityLabel: label }).length > 0;
  return { r, props, press, hasLabel };
}

it('shows nothing when closed', () => {
  const { r } = render({ visible: false });
  expect(r.toJSON()).toBeNull();
});

it('draws the message and its time', () => {
  const { r } = render();
  const texts = r.root.findAllByType(Text).map(t => t.props.children);
  expect(texts).toEqual(expect.arrayContaining(['Hello', '4:22 PM']));
});

it('a reaction reports its emoji', () => {
  const { props, press } = render();
  press('React with 😂');
  expect(props.onPick).toHaveBeenCalledWith('😂');
});

it('the plus opens more reactions', () => {
  const { props, press } = render();
  press('More reactions');
  expect(props.onMore).toHaveBeenCalledTimes(1);
});

it('runs each action, and offers only those it was given', () => {
  const onPress = jest.fn();
  const { press, hasLabel } = render({ actions: [{ key: 'copy', label: 'Copy', icon: 'copy', onPress }] });
  press('Copy');
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(hasLabel('Delete')).toBe(false);
});

it('a tap on the dim closes it', () => {
  const { props, press } = render();
  press('Close');
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

describe('the blurred chat behind it', () => {
  it('is drawn when there is a picture', () => {
    const { r } = render({ backdropUri: 'data:image/jpeg;base64,AAAA' });
    const image = r.root.findByType(Image);
    expect(image.props.source).toEqual({ uri: 'data:image/jpeg;base64,AAAA' });
    expect(image.props.blurRadius).toBeGreaterThan(0);
  });

  it('is left out without one, and the menu still works', () => {
    const { r, props, press } = render();
    expect(r.root.findAllByType(Image)).toHaveLength(0);
    press('Close');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('closing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps showing the same message and actions while it animates away, then leaves', () => {
    const { r, props } = render({ actions: [{ key: 'copy', label: 'Copy', icon: 'copy', onPress: jest.fn() }] });
    act(() => { r.update(<MessageMenu {...props} visible={false} actions={[]}>{null}</MessageMenu>); });
    const texts = r.root.findAllByType(Text).map(t => t.props.children);
    expect(texts).toEqual(expect.arrayContaining(['Hello', 'Copy']));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(r.toJSON()).toBeNull();
  });

  it('reopened, it shows the new message', () => {
    const { r, props } = render();
    act(() => { r.update(<MessageMenu {...props} visible={false}>{null}</MessageMenu>); });
    act(() => { r.update(<MessageMenu {...props} visible><Text>Newer</Text></MessageMenu>); });
    expect(r.root.findAllByType(Text).map(t => t.props.children)).toContain('Newer');
  });
});
