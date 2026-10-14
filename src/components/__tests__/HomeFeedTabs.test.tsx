/**
 * Home's For you | New on Livil switch. The dot is the only thing telling a viewer that
 * someone uploaded, so it must show exactly when asked and never on the tab already open.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { HomeFeedTabs } from '../HomeFeedTabs';

function render(active: 'for_you' | 'new_on_livil', showNewDot: boolean, onSelect = jest.fn()) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<HomeFeedTabs active={active} onSelect={onSelect} showNewDot={showNewDot} />); });
  return tree;
}
const dots = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => n.props.testID === 'home-tab-new-dot' && typeof n.type === 'string');

it('shows the dot on New on Livil while For you is open', () => {
  expect(dots(render('for_you', true))).toHaveLength(1);
});

it('never shows it on the tab already open, or when nothing is new', () => {
  expect(dots(render('new_on_livil', true))).toHaveLength(0);
  expect(dots(render('for_you', false))).toHaveLength(0);
});

it('reports which tab was pressed and which one is selected', () => {
  const onSelect = jest.fn();
  const tree = render('for_you', false, onSelect);
  const tab = (key: string) =>
    tree.root.find(n => n.props.testID === `home-tab-${key}` && n.props.accessibilityRole === 'tab');
  expect(tab('for_you').props.accessibilityState).toEqual({ selected: true });
  expect(tab('new_on_livil').props.accessibilityState).toEqual({ selected: false });
  act(() => { tab('new_on_livil').props.onPress(); });
  expect(onSelect).toHaveBeenCalledWith('new_on_livil');
});
