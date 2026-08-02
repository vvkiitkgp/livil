/**
 * The row is the settings primitive both screens use, and LIV-74's Delete
 * account row depends on `destructive` meaning "red label, nothing else".
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { SettingsRow } from '../SettingsRow';
import { SettingsSection } from '../SettingsSection';
import { COLORS } from '../../theme/colors';

function render(el: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(el); });
  return tree;
}

const labelStyle = (t: TestRenderer.ReactTestRenderer, label: string) =>
  StyleSheet.flatten(
    t.root.findAllByType(Text).find(n => n.props.children === label)!.props.style,
  );

/** accessibilityLabel excludes the SettingsRow composite, which also carries onPress. */
const pressableStyle = (t: TestRenderer.ReactTestRenderer, label: string) =>
  t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  )[0]!.props.style;

const chevrons = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => n.props?.name === 'disclosure', { deep: false });

const separators = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => {
    const s = StyleSheet.flatten(n.props?.style);
    return !!s && s.height === StyleSheet.hairlineWidth && s.backgroundColor === COLORS.border;
  }, { deep: false });

describe('SettingsRow', () => {
  it('renders its label', () => {
    const t = render(<SettingsRow label="Edit profile" onPress={() => {}} />);
    expect(t.root.findAllByType(Text).map(n => n.props.children)).toContain('Edit profile');
  });

  it('paints a destructive label red and leaves everything else alone', () => {
    const plain = render(<SettingsRow label="Sign out" onPress={() => {}} />);
    const danger = render(<SettingsRow label="Delete account" destructive onPress={() => {}} />);
    expect(labelStyle(plain, 'Sign out').color).toBe(COLORS.white);
    expect(labelStyle(danger, 'Delete account').color).toBe(COLORS.error);
    const idle = StyleSheet.flatten(pressableStyle(danger, 'Delete account')({ pressed: false }));
    expect(idle.backgroundColor).toBeUndefined();
    expect(idle.borderWidth).toBeUndefined();
  });

  it('shows a disclosure chevron on navigation rows and none on action rows', () => {
    expect(chevrons(render(<SettingsRow label="Edit profile" onPress={() => {}} />))).toHaveLength(1);
    expect(chevrons(render(<SettingsRow label="Sign out" chevron={false} onPress={() => {}} />))).toHaveLength(0);
  });

  it('tints the whole row while pressed', () => {
    const t = render(<SettingsRow label="Edit profile" onPress={() => {}} />);
    const style = pressableStyle(t, 'Edit profile');
    expect(StyleSheet.flatten(style({ pressed: true })).backgroundColor).toBe(COLORS.surface);
    expect(StyleSheet.flatten(style({ pressed: false })).backgroundColor).toBeUndefined();
  });
});

describe('SettingsSection', () => {
  it('separates rows without a leading or trailing rule', () => {
    const t = render(
      <SettingsSection title="Account">
        <SettingsRow label="One" onPress={() => {}} />
        <SettingsRow label="Two" onPress={() => {}} />
        <SettingsRow label="Three" onPress={() => {}} />
      </SettingsSection>,
    );
    expect(separators(t)).toHaveLength(2);
  });

  it('renders its title, and omits it when unlabelled', () => {
    const titled = render(
      <SettingsSection title="Account"><SettingsRow label="One" onPress={() => {}} /></SettingsSection>,
    );
    const bare = render(
      <SettingsSection><SettingsRow label="One" onPress={() => {}} /></SettingsSection>,
    );
    expect(titled.root.findAllByType(Text).map(n => n.props.children)).toContain('Account');
    expect(bare.root.findAllByType(Text).map(n => n.props.children)).not.toContain('Account');
  });
});
