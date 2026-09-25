import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';

/**
 * A selectable row.
 *
 * `Pressable` with an opacity callback rather than `android_ripple`: the ripple is drawn
 * as a RECTANGLE that ignores borderRadius, flashing a square over the rounded outline.
 *
 * SHAPE CARRIES MEANING and is not decoration: a circle means "pick one of these", a
 * square means "pick any that apply". The scope list is genuinely multi-select — a
 * licence can cover streaming AND user-generated content — and drawing it identically to
 * the four mutually-exclusive options tells the reader the wrong thing before they have
 * touched anything.
 */
export function Choice({
  label,
  hint,
  selected,
  onPress,
  compact = false,
  shape = 'radio',
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  shape?: 'radio' | 'checkbox';
}) {
  const isRadio = shape === 'radio';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={isRadio ? 'radio' : 'checkbox'}
      accessibilityState={{ selected, checked: selected }}
      style={({ pressed }) => [
        styles.choice,
        compact && styles.choiceCompact,
        selected && styles.choiceSelected,
        pressed && styles.choicePressed,
      ]}
    >
      <View
        style={[
          styles.dot,
          isRadio ? styles.dotRadio : styles.dotCheckbox,
          selected && styles.dotSelected,
          selected && !isRadio && styles.dotCheckboxOn,
        ]}
      >
        {/* A radio fills from the centre so its ring stays visible; a checkbox fills
            solid and carries a tick. */}
        {selected && isRadio ? <View style={styles.dotInner} /> : null}
        {selected && !isRadio ? (
          <Icon name="check" size={11} color={COLORS.white} weight="bold" />
        ) : null}
      </View>
      <View style={styles.choiceText}>
        <Text style={[styles.choiceLabel, selected && styles.choiceLabelOn]}>{label}</Text>
        {hint ? <Text style={styles.choiceHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  choiceCompact: { paddingVertical: 9 },
  choiceSelected: { borderColor: COLORS.purple, backgroundColor: COLORS.purpleDim },
  choicePressed: { opacity: 0.7 },
  // The control, and it must be VISIBLE WHEN UNSELECTED. Drawn with COLORS.border
  // (#252545) on a surface of #12121C it was effectively invisible — a fine container
  // edge and an unreadable form control. Controls need contrast against the surface they
  // sit on, so this uses the secondary text colour.
  //
  // Filled when selected is the design system's documented indicator exception to the
  // no-solid-purple rule: a hollow 18px shape reads as unchecked.
  dot: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRadio: { borderRadius: 9 },
  dotCheckbox: { borderRadius: 5 },
  dotSelected: { borderColor: COLORS.purple },
  dotCheckboxOn: { backgroundColor: COLORS.purple },
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple },
  choiceText: { flex: 1 },
  choiceLabel: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  choiceLabelOn: { color: COLORS.purpleLight },
  choiceHint: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
});
