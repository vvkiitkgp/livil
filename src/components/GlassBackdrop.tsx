import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView, LiquidGlassView } from '@sbaiahmed1/react-native-blur';
import { COLORS } from '../theme/colors';

const HAS_LIQUID_GLASS = Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * iPhone only: reach it through IosGlass (iosGlass.ts), never directly. iOS 26+ is Apple's own
 * Liquid Glass; older versions get a dark blur rather than LiquidGlassView's fallback, which sits
 * under a white overlay.
 */
export default function GlassBackdrop({ style }: { style: StyleProp<ViewStyle> }) {
  if (HAS_LIQUID_GLASS) {
    return (
      <LiquidGlassView
        glassType="clear"
        glassTintColor={COLORS.bg}
        glassOpacity={0.3}
        isInteractive={false}
        // Shown instead when the phone's Reduce Transparency setting is on. The library's default
        // is white, which would hide the bar's white icons.
        reducedTransparencyFallbackColor={COLORS.bg}
        style={style}
      />
    );
  }
  return (
    <BlurView
      blurType="systemUltraThinMaterialDark"
      blurAmount={50}
      overlayColor="rgba(10, 10, 15, 0.15)"
      reducedTransparencyFallbackColor={COLORS.bg}
      style={style}
    />
  );
}
