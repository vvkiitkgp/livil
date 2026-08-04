import React from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../../theme/colors';

/**
 * The barcode strip along the bottom of the backstage pass.
 *
 * The design specifies a 9px repeating pattern: 2px bar, 3px gap, 1px bar, 3px
 * gap. That is a `repeating-linear-gradient` in CSS; here it is a row of Views,
 * which is cheaper than an SVG for something this regular and stays crisp at any
 * pixel density.
 */

const PERIOD = 9;

export type BarcodeProps = {
  width: number;
  height: number;
};

export function Barcode({ width, height }: BarcodeProps) {
  const periods = Math.ceil(width / PERIOD);

  return (
    <View style={[styles.strip, { width, height }]}>
      {Array.from({ length: periods }, (_, i) => (
        <View key={i} style={styles.period}>
          <View style={[styles.wide, { height }]} />
          <View style={[styles.gap, { height }]} />
          <View style={[styles.thin, { height }]} />
          <View style={[styles.gap, { height }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', overflow: 'hidden' },
  period: { flexDirection: 'row' },
  wide: { width: 2, backgroundColor: COLORS.purpleLight },
  thin: { width: 1, backgroundColor: COLORS.purpleLight },
  gap: { width: 3 },
});
