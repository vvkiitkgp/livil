import { NativeModules, Platform } from 'react-native';

/**
 * Apple's own photo picker (ios/livil/LivilPhotoPicker.m) for every gallery pick on iPhone —
 * the Photos app's look, and no photo-library permission: the app only receives the item
 * that was tapped. A photo comes back downsampled (long side ≤ `maxSide`) as a metadata-free
 * JPEG; a video as its original file, untouched. Both land in the temporary folder.
 *
 * `available` is false on Android and on an iPhone build made before the module existed (JS
 * can reach a phone through Metro before the rebuild): callers fall back to
 * image-crop-picker's gallery (src/services/mediaPicks.ts).
 */
export type PickedItem = {
  uri: string;
  /** For display (a video keeps the name it had in the library). */
  name: string;
  mime: string;
  /** Pixels; 0 for a video. */
  width: number;
  height: number;
  bytes: number;
};

type PickOptions = { mediaType: 'photo' | 'video'; maxSide?: number; quality?: number };

type Native = {
  pick(options: PickOptions): Promise<PickedItem | null>;
  remove(uri: string): Promise<boolean>;
};

const native: Native | undefined = Platform.OS === 'ios' ? NativeModules.LivilPhotoPicker : undefined;

export const photoPicker = {
  available: !!native,

  /** The chosen item, or null when the picker was cancelled or swiped away. */
  pick(options: PickOptions): Promise<PickedItem | null> {
    if (!native) { return Promise.reject(new Error('LivilPhotoPicker is missing (rebuild the iPhone app)')); }
    return native.pick(options);
  },

  /** Is this a file the picker made? (Only those may be deleted through `remove`.) */
  owns(uri: string): boolean {
    return native !== undefined && uri.includes('/livil-pick-');
  },

  /** Deletes a photo the picker made; anything else is left alone. */
  remove(uri: string): Promise<boolean> {
    return native ? native.remove(uri).then(Boolean).catch(() => false) : Promise.resolve(false);
  },
};
