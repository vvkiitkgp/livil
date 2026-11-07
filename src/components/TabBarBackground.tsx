import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IosGlass } from './iosGlass';

const CORNER_RADIUS = 20;

/**
 * The bottom bar's backdrop, with the purple outline on top of it: glass on iPhone, a plain dark
 * bar on Android (see iosGlass).
 *
 * The backdrop is one uniform radius, because older iOS can only round all four corners alike, so
 * it runs past the screen's bottom edge to put its lower corners out of sight.
 */
export default function TabBarBackground() {
  return (
    <>
      {IosGlass ? (
        <IosGlass style={styles.backdrop} />
      ) : (
        <View style={[styles.backdrop, styles.androidBar]} />
      )}
      <View style={styles.outline} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    bottom: -CORNER_RADIUS,
    borderRadius: CORNER_RADIUS,
  },
  androidBar: { backgroundColor: 'rgba(10, 10, 15, 0.85)' },
  outline: {
    ...StyleSheet.absoluteFill,
    borderTopLeftRadius: CORNER_RADIUS,
    borderTopRightRadius: CORNER_RADIUS,
    // On the sides as well: a top-only border thins out to nothing around a curve.
    borderColor: 'rgba(139, 61, 255, 0.25)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
});
