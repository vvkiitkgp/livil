/**
 * FormInput's `above` slot (the comment box's attached GIF). A TextInput that remounts
 * while focused drops the keyboard (CLAUDE.md, FormInput rule), so showing or clearing
 * what sits above the text must never remount it — and inputs that never pass `above`
 * keep exactly their old layout.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, View } from 'react-native';
import FormInput from '../FormInput';

function mountCount(ref: jest.Mock): number {
  return ref.mock.calls.filter(([instance]) => instance !== null).length;
}

it('showing and clearing what is above the text never remounts the field', () => {
  const ref = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<FormInput ref={ref} value="" above={null} />); });
  act(() => { r.update(<FormInput ref={ref} value="haha" above={<Text>GIF</Text>} />); });
  act(() => { r.update(<FormInput ref={ref} value="haha" above={null} />); });
  act(() => { r.update(<FormInput ref={ref} value="" above={<Text>GIF</Text>} />); });
  expect(mountCount(ref)).toBe(1);
  expect(ref).not.toHaveBeenCalledWith(null);
});

it('draws what is above inside the box, before the text', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<FormInput value="" above={<Text testID="above">GIF</Text>} />); });
  const box = r.root.findAllByType(View)[0];
  const order = box.findAll(n => n.props.testID === 'above' || n.type === TextInput).map(n => n.type === TextInput ? 'input' : 'above');
  expect(order[0]).toBe('above');
  expect(order).toContain('input');
});

it('without `above`, the box is the same single row it always was', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<FormInput value="" trailing={<Text>✓</Text>} />); });
  const views = r.root.findAllByType(View);
  const style = Object.assign({}, ...[views[0].props.style].flat(3).filter(Boolean));
  expect(style.flexDirection).toBe('row');
  // The TextInput sits directly in the box: one View, no extra row inside it.
  expect(views).toHaveLength(1);
  act(() => { r.update(<FormInput value="" trailing={<Text>✓</Text>} above={null} />); });
  expect(r.root.findAllByType(View)).toHaveLength(2);
});
