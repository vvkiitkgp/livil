/**
 * The round ✓ (comment box, "+ Something else" fields). Its circle must never be flattened
 * away by Fabric: when it was, going from "something to send" back to "empty" brought it
 * back on Android without its borderRadius, and the grey ring drew square.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../GradientBorder', () => ({ GradientBorder: () => null }));
jest.mock('../Icon', () => ({ Icon: () => null }));

import RoundTickButton from '../RoundTickButton';

function circle(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll(n => n.props.testID === 'round-tick-circle' && n.props.style)[0];
}

it('the circle is never flattened, idle or enabled', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<RoundTickButton enabled onPress={jest.fn()} accessibilityLabel="Send" />); });
  expect(circle(r).props.collapsable).toBe(false);
  act(() => { r.update(<RoundTickButton enabled={false} onPress={jest.fn()} accessibilityLabel="Send" />); });
  expect(circle(r).props.collapsable).toBe(false);
});

it('idle, it keeps its round shape in the same style as the ring', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<RoundTickButton enabled={false} onPress={jest.fn()} accessibilityLabel="Send" />); });
  const style = Object.assign({}, ...[circle(r).props.style].flat(2).filter(Boolean));
  expect(style.borderRadius).toBe(style.width / 2);
  expect(style.borderWidth).toBeGreaterThan(0);
});
