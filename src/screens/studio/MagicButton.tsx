import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GradientFill } from '../../components/GradientFill';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';

/**
 * Magic Tune's hero button. The one gradient-FILLED control in the app, on purpose: the
 * owner made Magic Tune the selling point and asked for it to look special (2026-10-30).
 * Do not copy this look onto other buttons — everything else follows Button's outline rule.
 */
export function MagicButton({ label, onPress, height = 60 }: { label: string; onPress: () => void; height?: number }) {
  const [w, setW] = useState(0);
  return (
    <Pressable
      onPress={() => { haptics.impact(); onPress(); }}
      onLayout={e => setW(Math.floor(e.nativeEvent.layout.width))}
      style={({ pressed }) => [styles.root, { height, borderRadius: height / 2 }, pressed && { opacity: 0.88 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: height / 2, overflow: 'hidden' }]}>
        <GradientFill width={w} height={height} borderRadius={height / 2} />
      </View>
      <Icon name="ai" size={22} color={COLORS.white} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: COLORS.purpleNeon, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  label: { color: COLORS.white, fontSize: 17, fontWeight: '800' },
});
