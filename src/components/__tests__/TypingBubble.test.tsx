import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import TypingBubble, { TYPING_SLOT_STYLE } from '../TypingBubble';
import { applyTypingEvent, clearAllTyping } from '../../utils/chatTyping';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'Animated.View' },
  cancelAnimation: jest.fn(),
  useAnimatedStyle: (build: () => object) => build(),
  useSharedValue: (value: number) => jest.requireActual('react').useRef({ value }).current,
  withDelay: (_delay: number, value: number) => value,
  withRepeat: (value: number) => value,
  withTiming: (value: number) => value,
}));

const typing = (userId: string, name: string, conversationId = 'c1', isTyping = true) =>
  applyTypingEvent({ conversationId, userId, name, avatarUrl: null, typing: isTyping });

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<TypingBubble conversationId="c1" />); });
  return tree;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  act(() => { clearAllTyping(); });
  jest.useRealTimers();
});

describe('TypingBubble', () => {
  it('is empty until someone in THIS chat types', () => {
    const tree = render();
    expect(tree.toJSON()).toBeNull();

    act(() => { typing('sam', 'Sam', 'c2'); });
    expect(tree.toJSON()).toBeNull();

    act(() => { typing('riya', 'Riya'); });
    expect(tree.root.findByProps({ accessibilityLabel: 'Riya is typing…' })).toBeTruthy();
    expect(tree.root.findAllByType('Animated.View' as never)).toHaveLength(3);
    expect(tree.root.findByType(Text).props.children).toBe('R');
  });

  it('goes again when they stop', () => {
    const tree = render();
    act(() => { typing('riya', 'Riya'); });
    act(() => { typing('riya', 'Riya', 'c1', false); });
    expect(tree.toJSON()).toBeNull();
  });

  it('takes no room in the list: its slot cancels its own height and the list gap after it', () => {
    expect(TYPING_SLOT_STYLE.marginTop + TYPING_SLOT_STYLE.height + 6).toBe(0);
  });
});
