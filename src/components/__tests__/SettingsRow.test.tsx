/**
 * The row is the settings primitive every settings screen uses. The Delete
 * account row depends on `destructive` meaning "red label + red tile, nothing
 * else", and the Activity status / Push notification rows depend on `toggle`
 * making the WHOLE row the switch's hit target.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Switch, Text } from 'react-native';
import {
  SettingsRow,
  SETTINGS_ICON_GAP,
  SETTINGS_ICON_TILE,
  SETTINGS_ROW_INSET,
} from '../SettingsRow';
import { SettingsSection } from '../SettingsSection';
import { COLORS } from '../../theme/colors';

function render(el: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(el); });
  return tree;
}

const texts = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map(n => n.props.children);

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

const pressable = (t: TestRenderer.ReactTestRenderer, label: string) =>
  t.root.findAll(
    n => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === label,
    { deep: false },
  )[0]!;

const icons = (t: TestRenderer.ReactTestRenderer, name: string) =>
  t.root.findAll(n => n.props?.name === name, { deep: false });

const separators = (t: TestRenderer.ReactTestRenderer) =>
  t.root.findAll(n => {
    const s = StyleSheet.flatten(n.props?.style);
    return !!s && s.height === StyleSheet.hairlineWidth && s.backgroundColor === COLORS.border;
  }, { deep: false });

describe('SettingsRow', () => {
  it('renders its label and subtitle', () => {
    const t = render(
      <SettingsRow label="Edit profile" subtitle="Name, bio and avatar" onPress={() => {}} />,
    );
    expect(texts(t)).toContain('Edit profile');
    expect(texts(t)).toContain('Name, bio and avatar');
  });

  it('paints a destructive label and tile red, and leaves the row shape alone', () => {
    const plain = render(<SettingsRow icon="profile" label="Sign out" onPress={() => {}} />);
    const danger = render(
      <SettingsRow icon="trash" label="Delete account" destructive onPress={() => {}} />,
    );

    expect(labelStyle(plain, 'Sign out').color).toBe(COLORS.white);
    expect(labelStyle(danger, 'Delete account').color).toBe(COLORS.error);
    expect(icons(danger, 'trash')[0]!.props.color).toBe(COLORS.error);

    const idle = StyleSheet.flatten(pressableStyle(danger, 'Delete account')({ pressed: false }));
    expect(idle.backgroundColor).toBeUndefined();
    expect(idle.borderWidth).toBeUndefined();
  });

  it('shows a disclosure chevron on navigation rows and none on action rows', () => {
    expect(icons(render(<SettingsRow label="Edit profile" onPress={() => {}} />), 'disclosure'))
      .toHaveLength(1);
    expect(
      icons(render(<SettingsRow label="Sign out" chevron={false} onPress={() => {}} />), 'disclosure'),
    ).toHaveLength(0);
  });

  it('swaps the chevron for an external glyph on rows that leave the app', () => {
    const t = render(<SettingsRow label="Privacy policy" external onPress={() => {}} />);
    expect(icons(t, 'externalLink')).toHaveLength(1);
    expect(icons(t, 'disclosure')).toHaveLength(0);
  });

  it('tints the whole row while pressed', () => {
    const t = render(<SettingsRow label="Edit profile" onPress={() => {}} />);
    const style = pressableStyle(t, 'Edit profile');
    expect(StyleSheet.flatten(style({ pressed: true })).backgroundColor).toBe(COLORS.card);
    expect(StyleSheet.flatten(style({ pressed: false })).backgroundColor).toBeUndefined();
  });

  describe('toggle rows', () => {
    it('renders a Switch instead of a chevron', () => {
      const t = render(
        <SettingsRow
          label="Activity status"
          toggle={{ value: true, onValueChange: () => {} }}
        />,
      );
      expect(t.root.findAllByType(Switch)).toHaveLength(1);
      expect(icons(t, 'disclosure')).toHaveLength(0);
    });

    it('flips the value when the row body is pressed, not just the switch', () => {
      const onValueChange = jest.fn();
      const t = render(
        <SettingsRow label="Activity status" toggle={{ value: false, onValueChange }} />,
      );
      act(() => { pressable(t, 'Activity status').props.onPress(); });
      expect(onValueChange).toHaveBeenCalledWith(true);
    });

    it('reports switch state to accessibility', () => {
      const t = render(
        <SettingsRow label="Activity status" toggle={{ value: true, onValueChange: () => {} }} />,
      );
      const row = pressable(t, 'Activity status');
      expect(row.props.accessibilityRole).toBe('switch');
      expect(row.props.accessibilityState.checked).toBe(true);
    });
  });

  it('renders a non-pressable row when there is nothing to do', () => {
    const t = render(<SettingsRow label="Version" value="1.1.13" />);
    expect(
      t.root.findAll(n => typeof n.props?.onPress === 'function', { deep: false }),
    ).toHaveLength(0);
    expect(texts(t)).toContain('1.1.13');
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

  it('drops conditional children instead of leaving a stray separator', () => {
    const show = false;
    const t = render(
      <SettingsSection>
        <SettingsRow label="One" onPress={() => {}} />
        {show ? <SettingsRow label="Two" onPress={() => {}} /> : null}
      </SettingsSection>,
    );
    expect(separators(t)).toHaveLength(0);
  });

  it('insets separators past the icon tile so they start under the label', () => {
    const t = render(
      <SettingsSection>
        <SettingsRow icon="bell" label="One" onPress={() => {}} />
        <SettingsRow icon="bell" label="Two" onPress={() => {}} />
      </SettingsSection>,
    );
    const inset = StyleSheet.flatten(separators(t)[0]!.props.style).marginLeft;
    expect(inset).toBe(SETTINGS_ROW_INSET + SETTINGS_ICON_TILE + SETTINGS_ICON_GAP);
  });

  it('runs separators full width when the group is flush', () => {
    const t = render(
      <SettingsSection flushSeparators>
        <SettingsRow label="One" onPress={() => {}} />
        <SettingsRow label="Two" onPress={() => {}} />
      </SettingsSection>,
    );
    expect(StyleSheet.flatten(separators(t)[0]!.props.style).marginLeft).toBe(0);
  });

  it('renders its title, and omits it when unlabelled', () => {
    const titled = render(
      <SettingsSection title="Account"><SettingsRow label="One" onPress={() => {}} /></SettingsSection>,
    );
    const bare = render(
      <SettingsSection><SettingsRow label="One" onPress={() => {}} /></SettingsSection>,
    );
    expect(texts(titled)).toContain('Account');
    expect(texts(bare)).not.toContain('Account');
  });

  it('renders nothing at all when it has no rows', () => {
    const t = render(<SettingsSection title="Account">{false}</SettingsSection>);
    expect(t.toJSON()).toBeNull();
  });
});
