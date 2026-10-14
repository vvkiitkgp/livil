/**
 * Home's For you | New on Livil pills. The dot is the only thing telling a viewer that
 * someone uploaded, so it must show exactly when asked and never on the feed already open;
 * the open feed wears the `selected` pill, the other the quiet one.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HomeFeedTabs } from '../HomeFeedTabs';
import { Button } from '../Button';

function render(active: 'for_you' | 'new_on_livil', showNewDot: boolean, onSelect = jest.fn()) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<HomeFeedTabs active={active} onSelect={onSelect} showNewDot={showNewDot} />); });
  return tree;
}
const dots = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => n.props.testID === 'home-tab-new-dot' && typeof n.type === 'string');
const pill = (tree: TestRenderer.ReactTestRenderer, key: string) =>
  tree.root.find(n => n.props.testID === `home-tab-${key}` && typeof n.type === 'string').findByType(Button);

it('shows the dot on New on Livil while For you is open', () => {
  expect(dots(render('for_you', true))).toHaveLength(1);
});

it('never shows it on the feed already open, or when nothing is new', () => {
  expect(dots(render('new_on_livil', true))).toHaveLength(0);
  expect(dots(render('for_you', false))).toHaveLength(0);
});

it('wears the selected pill on the open feed and reports which one was pressed', () => {
  const onSelect = jest.fn();
  const tree = render('for_you', false, onSelect);
  expect(pill(tree, 'for_you').props.variant).toBe('selected');
  expect(pill(tree, 'new_on_livil').props.variant).toBe('secondary');
  act(() => { pill(tree, 'new_on_livil').props.onPress(); });
  expect(onSelect).toHaveBeenCalledWith('new_on_livil');
});

it('leaves the haptic to Home, so a switch buzzes once', () => {
  const tree = render('for_you', false);
  expect(pill(tree, 'for_you').props.haptic).toBe('none');
});
