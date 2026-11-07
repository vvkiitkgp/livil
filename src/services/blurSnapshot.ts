import type { RefObject } from 'react';
import { Dimensions, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

/** Small on purpose: it is about to be blurred, and a small one is cheap to take and to blur. */
const SNAPSHOT_WIDTH = 200;

/**
 * A tiny picture of `view`, for drawing it blurred behind something (<Image blurRadius>). React
 * Native has no blur for live views on every phone we support, and a blur library would be a new
 * native dependency, so this is a still picture taken once. Kept in memory: chat words never
 * reach a file on disk. Null if it could not be taken, and the caller just dims instead.
 */
export async function takeBlurSnapshot(view: RefObject<View | null>): Promise<string | null> {
  try {
    const { width, height } = Dimensions.get('window');
    return await captureRef(view, {
      format: 'jpg',
      quality: 0.5,
      result: 'data-uri',
      width: SNAPSHOT_WIDTH,
      height: Math.round((SNAPSHOT_WIDTH * height) / width),
    });
  } catch (e) {
    console.warn('[chat] blur snapshot failed', e);
    return null;
  }
}
