import React, { useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GradientFill } from '../../components/GradientFill';
import { COLORS } from '../../theme/colors';

type Props = {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  /** The finger lifted — the moment to do anything expensive with the value. */
  onDone?: (v: number) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
};

/** A horizontal slider: gradient fill, glowing thumb. Drag or tap anywhere on it. */
export function StudioSlider({ value, min = 0, max = 1, onChange, onDone, accessibilityLabel, style, compact }: Props) {
  const [w, setW] = useState(0);
  const thumb = compact ? 16 : 22;
  const frac = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const toValue = (x: number) => min + Math.min(1, Math.max(0, w > 0 ? x / w : 0)) * (max - min);
  const last = useRef(value);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .activeOffsetX([-2, 2])
    .failOffsetY([-12, 12])
    .onBegin(e => { last.current = toValue(e.x); onChange(last.current); })
    .onUpdate(e => { last.current = toValue(e.x); onChange(last.current); })
    .onFinalize(() => onDone?.(last.current));
  const step = (max - min) / 10;
  return (
    <GestureDetector gesture={pan}>
      <View
        style={[styles.root, { height: compact ? 24 : 32 }, style]}
        onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => {
          const v = Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step)));
          onChange(v);
          onDone?.(v);
        }}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: frac * w }]}>
            <GradientFill width={w} height={6} borderRadius={3} />
          </View>
        </View>
        <View
          pointerEvents="none"
          style={[styles.thumb, { width: thumb, height: thumb, borderRadius: thumb / 2, left: frac * w - thumb / 2 }]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.card },
  fill: { height: 6, borderRadius: 3, overflow: 'hidden' },
  thumb: {
    position: 'absolute',
    backgroundColor: COLORS.purpleNeon,
    shadowColor: COLORS.purpleNeon,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
