/**
 * Contract tests for the profile header's badges.
 *
 * WHY A COMPONENT TEST HERE, WHEN THEY ARE OTHERWISE RARE
 *
 * kb/standards/testing.md limits component tests to components where logic actually
 * lives. Four properties qualify, and each one regresses INVISIBLY — the screen still
 * renders, it is just wrong:
 *
 *   1. NO BADGES MUST RENDER NOTHING — not an empty box, which would still be a layout
 *      participant and would open a gap after the name on most profiles in the app.
 *
 *   2. THE BADGES MUST NOT SHRINK. They sit in a row with the display name, which is
 *      allowed to truncate. Flip the flexShrink and a long name squashes the seal into
 *      an unreadable smear instead of ellipsising itself.
 *
 *   3. GRADIENT IDS MUST BE UNIQUE PER INSTANCE. react-native-svg resolves url(#id)
 *      against one document, so two badges sharing an id make the second paint with
 *      the first's gradient, and unmounting the first leaves the survivor unfilled.
 *      This is the same trap GradientBorder counts ids for.
 *
 *   4. THE POPUP CARRIES NO ORDINAL. "All 100 are treated the same" is a product rule
 *      enforced server-side by badges_for_profiles returning no ordering column — but
 *      a future edit could reintroduce a rank in the copy without any server change.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import ProfileBadges from '../ProfileBadges';

function render(badges: React.ComponentProps<typeof ProfileBadges>['badges']) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ProfileBadges badges={badges} />);
  });
  return tree;
}

/** Flattened style of the row, whatever array form it was written in. */
function rowStyle(tree: ReactTestRenderer.ReactTestRenderer) {
  const row = tree.root.findAll(
    n => n.props?.style != null && n.props?.accessibilityRole !== 'button',
  )[0];
  return Object.assign({}, ...[row.props.style].flat(Infinity).filter(Boolean));
}

function pressables(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    n => typeof n.props?.accessibilityLabel === 'string'
      && n.props.accessibilityRole === 'button',
  );
}

function gradientIds(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root
    .findAll(n => typeof n.type !== 'string'
      && (n.type as { displayName?: string })?.displayName === 'LinearGradient')
    .map(n => n.props.id as string);
}

describe('ProfileBadges', () => {
  it('renders nothing at all when there are no badges', () => {
    // Not "renders an empty box" — an empty View would still be a layout participant.
    expect(render([]).toJSON()).toBeNull();
  });

  it('lays the badges out in a row beside the name, in flow', () => {
    const style = rowStyle(render(['first_100']));
    expect(style.flexDirection).toBe('row');
    // NOT absolute any more. This used to be a rail pinned past the avatar's right edge;
    // it now sits in the name's row so a badge is in the same place here as in the feed.
    expect(style.position).toBeUndefined();
  });

  it('never shrinks — the display name is what gives way', () => {
    // Flip this and a long name squashes the seal instead of ellipsising itself.
    expect(rowStyle(render(['first_100', 'verified'])).flexShrink).toBe(0);
  });

  it('gives the badge a real touch target and a label', () => {
    const [badge] = pressables(render(['first_100']));
    expect(badge.props.accessibilityLabel).toMatch(/First 100/i);
    // 20px is well under the 44px minimum; the slop is what makes it hittable.
    expect(badge.props.hitSlop).toEqual({ top: 12, bottom: 12, left: 12, right: 12 });
  });

  it('gives every rendered badge its own gradient id', () => {
    const ids = gradientIds(render(['first_100']));
    const second = gradientIds(render(['first_100']));
    expect(ids[0]).toBeTruthy();
    expect(second[0]).not.toBe(ids[0]);
  });

  it('opens a popup on tap and closes it again on tap-away', () => {
    const tree = render(['first_100']);
    const modal = () => tree.root.findByType(Modal);

    expect(modal().props.visible).toBe(false);

    ReactTestRenderer.act(() => { pressables(tree)[0].props.onPress(); });
    expect(modal().props.visible).toBe(true);

    // The backdrop is what receives a tap outside the card. Without it, tapping away
    // does nothing at all — the popup is inside a Modal, so no ancestor sees the touch.
    const backdrop = tree.root.findAll(n => n.props?.accessibilityLabel === 'Close')[0];
    ReactTestRenderer.act(() => { backdrop.props.onPress(); });
    expect(modal().props.visible).toBe(false);
  });

  it('closes on Android back', () => {
    const tree = render(['first_100']);
    ReactTestRenderer.act(() => { pressables(tree)[0].props.onPress(); });

    const modal = () => tree.root.findByType(Modal);
    expect(modal().props.visible).toBe(true);
    ReactTestRenderer.act(() => { modal().props.onRequestClose(); });
    expect(modal().props.visible).toBe(false);
  });

  it('says nothing about rank in the popup', () => {
    const tree = render(['first_100']);
    ReactTestRenderer.act(() => { pressables(tree)[0].props.onPress(); });

    // VISIBLE COPY ONLY. Serialising the whole tree would drag in hex colours (which
    // look like "#1") and the seal's path data, so the assertion would fail on its own
    // noise rather than on a rank.
    const copy = tree.root
      .findAllByType(Text)
      .flatMap(n => React.Children.toArray(n.props.children))
      .filter((c): c is string => typeof c === 'string')
      .join(' ');

    expect(copy).toContain('First 100');
    // An ORDINAL is what must never appear — "#23", "23 of 100", "23/100", "No. 23".
    // The cohort size itself is fine, which is why this needs a digit in front of it:
    // "one of the first 100 artists" says nothing about who came first.
    expect(copy).not.toMatch(/#\s*\d|\b\d+\s*(?:of|\/)\s*100\b|\bno\.?\s*\d/i);
  });
});
