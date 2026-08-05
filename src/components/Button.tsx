import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { haptics } from '../utils/haptics';
import { GradientBorder } from './GradientBorder';
import { Icon, type IconName } from './Icon';

/**
 * The app's shared button. Use this instead of hand-rolling a TouchableOpacity
 * + local StyleSheet — that is how we ended up with ~40 divergent copies.
 *
 * Design rule (see CLAUDE.md): buttons are NEVER filled — the background is
 * always the dark page/surface behind them. Purple outlines and letters; it
 * never dominates. The one exception is `destructive`, which keeps a solid red
 * fill so dangerous actions stay heavy.
 *
 *   primary     black bg + purple GRADIENT glow border + purple label
 *   selected    black bg + purple GRADIENT glow border + purple label (tabs)
 *   secondary   black bg + neutral border + white label
 *   ghost       bare text link (modal "Cancel")
 *   destructive solid red fill + white label
 *
 * `primary` and `selected` intentionally paint the same — a selected tab and a
 * primary CTA are both "the purple one". They stay separate variants so call
 * sites read semantically and can diverge later without a find-and-replace.
 *
 * Label color is `purpleNeon`, not `purple`: #8B3DFF on a dark background is
 * only 3.4–4.0:1, which fails WCAG AA. #A855F7 is 4.3–5.0:1 and clears the 3:1
 * large-text bar that bold 15px+ labels fall under, while still reading purple.
 *
 * Android note: `elevation` is deliberately never set. Android ignores
 * `shadowColor` and paints elevation as a grey shadow, which reads as a smudge
 * under a dark outlined button. Glow is expressed purely via border + tint so
 * both platforms render identically.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'selected' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Shows a spinner in place of the label and blocks presses. */
  busy?: boolean;
  icon?: IconName;
  /**
   * An arbitrary node rendered before the label, for marks the `Icon` registry
   * cannot express — third-party brand logos in particular. Google's "G" is
   * multi-colour and is not a Phosphor or Lucide glyph, and its colours must not
   * be altered, so it cannot take `color` the way `icon` does.
   *
   * Prefer `icon` for anything in the registry. This exists so a brand button
   * doesn't have to be hand-rolled, which is how the app accumulated ~40
   * divergent button styles before Button was centralized.
   */
  leading?: React.ReactNode;
  /** Stretch to fill the parent's cross-axis. */
  fullWidth?: boolean;
  /**
   * Opaque near-black fill instead of a translucent one. Use when the button
   * floats over artwork or video, where a transparent fill kills the contrast
   * the border needs (e.g. FullScreenPlayer).
   */
  onMedia?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  /**
   * Haptic fired on press. Defaults to `tap` for real controls and `none` for
   * `ghost`, which is a text link ("Cancel") rather than a button — buzzing it
   * makes dismissing feel as weighty as confirming.
   *
   * Pass `warning` on a destructive confirm, or `none` where a screen fires its
   * own haptic on the resulting state change and would otherwise double-buzz.
   */
  haptic?: 'tap' | 'select' | 'impact' | 'warning' | 'none';
};

const SIZES: Record<ButtonSize, { padV: number; padH: number; radius: number; font: number; icon: number; gap: number }> = {
  sm: { padV: 7, padH: 12, radius: 999, font: 13, icon: 14, gap: 6 },
  md: { padV: 14, padH: 18, radius: 12, font: 15, icon: 18, gap: 8 },
  lg: { padV: 16, padH: 20, radius: 14, font: 16, icon: 20, gap: 10 },
};

/** Resolved paint for a variant, before the disabled override. */
function paintFor(variant: ButtonVariant, onMedia: boolean) {
  const mediaBg = 'rgba(10,10,15,0.9)';
  switch (variant) {
    case 'primary':
    case 'selected':
      return {
        bg: onMedia ? mediaBg : 'transparent',
        border: 'transparent',
        borderWidth: 0,
        label: COLORS.purpleNeon,
        weight: '700' as const,
        gradient: true,
      };
    case 'secondary':
      return {
        bg: onMedia ? mediaBg : 'transparent',
        border: COLORS.border,
        borderWidth: 1,
        label: COLORS.white,
        weight: '600' as const,
        gradient: false,
      };
    case 'destructive':
      return {
        bg: COLORS.error,
        border: 'transparent',
        borderWidth: 0,
        label: COLORS.white,
        weight: '700' as const,
        gradient: false,
      };
    case 'ghost':
    default:
      return {
        bg: 'transparent',
        border: 'transparent',
        borderWidth: 0,
        label: COLORS.textSecondary,
        weight: '400' as const,
        gradient: false,
      };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  icon,
  leading,
  fullWidth = false,
  onMedia = false,
  style,
  labelStyle,
  accessibilityLabel,
  haptic,
}: ButtonProps) {
  const s = SIZES[size];
  const inactive = disabled || busy;
  const paint = paintFor(variant, onMedia);

  // Disabled is a full repaint to grey rather than an opacity fade: dimming an
  // already-subtle outline on a black background makes it invisible. No extra
  // opacity is layered on top for the same reason.
  const bg = disabled && variant !== 'ghost' ? 'transparent' : paint.bg;
  const borderColor = disabled ? COLORS.border : paint.border;
  const borderWidth = disabled ? 1 : paint.borderWidth;
  const labelColor = disabled ? COLORS.textMuted : paint.label;
  const showGradient = paint.gradient && !disabled;

  // Every button in the app gets its press acknowledged from here, so no screen
  // has to remember to. `disabled`/`busy` presses never reach onPress, so they
  // can't buzz either.
  const hapticIntent = haptic ?? (variant === 'ghost' ? 'none' : 'tap');
  const handlePress = () => {
    if (hapticIntent !== 'none') { haptics[hapticIntent](); }
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={inactive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.base,
        {
          paddingVertical: s.padV,
          paddingHorizontal: s.padH,
          borderRadius: s.radius,
          backgroundColor: bg,
          borderColor,
          borderWidth,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {showGradient ? <GradientBorder borderRadius={s.radius} /> : null}
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <View style={[styles.content, { gap: s.gap }]}>
          {leading}
          {icon ? <Icon name={icon} size={s.icon} color={labelColor} /> : null}
          <Text
            style={[
              styles.label,
              { color: labelColor, fontSize: s.font, fontWeight: paint.weight },
              labelStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    // Deliberately no `overflow: 'hidden'`. GradientBorder draws its outline
    // inward within the bounds, so clipping adds nothing — and it clips to the
    // PADDING box (inside borderWidth), which shaves the outer edge of the glow
    // and makes the border look cut off along curves.
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    letterSpacing: 0.2,
  },
});

export default Button;
