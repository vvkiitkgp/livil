import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IosGlass } from './iosGlass';

const CORNER_RADIUS = 20;

/**
 * Home's top bar backdrop, the bottom bar's turned upside down: rounded along the bottom and running
 * up behind the status bar. Glass on iPhone, a plain dark bar on Android (see iosGlass).
 *
 * The glass runs past the screen's top edge to put its upper corners out of sight (see
 * TabBarBackground).
 */
export default function TopBarBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {IosGlass ? <IosGlass style={styles.glass} /> : null}
      <View style={[styles.outline, !IosGlass && styles.androidBar]} />
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    ...StyleSheet.absoluteFill,
    top: -CORNER_RADIUS,
    borderRadius: CORNER_RADIUS,
  },
  androidBar: { backgroundColor: 'rgba(10, 10, 15, 0.85)' },
  outline: {
    ...StyleSheet.absoluteFill,
    borderBottomLeftRadius: CORNER_RADIUS,
    borderBottomRightRadius: CORNER_RADIUS,
    // On the sides as well: a bottom-only border thins out to nothing around a curve.
    borderColor: 'rgba(139, 61, 255, 0.25)',
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
});
