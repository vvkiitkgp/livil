import {
  NativeModules,
  PermissionsAndroid,
  Platform,
  requireNativeComponent,
  type HostComponent,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

/**
 * Disappearing chat photos (PROP-0011): capture blocking and "Save to phone", through the
 * app's own native code — ios/livil/LivilChatMedia.m, android/.../ChatMediaModule.kt.
 *
 *   iPhone  — capture is blocked PER VIEW: <SecureImage> draws the photo in the layer iOS
 *             leaves out of screenshots and recordings (a "Photo hidden" card shows instead).
 *   Android — capture is blocked for the WINDOW while the viewer is open (setSecure).
 *
 * `available` is false on a build made before this code existed (JS reaches a phone through
 * Metro before the rebuild): the viewer then shows a plain <Image> and no Save button.
 */
type Native = {
  saveToPhotos(uri: string): Promise<boolean>;
  setSecure?(secure: boolean): void;
};

const native: Native | undefined = NativeModules.LivilChatMedia;

export type SecureImageProps = ViewProps & {
  /** A local `file://` photo. */
  uri: string;
  onLoad?: (event: NativeSyntheticEvent<{ ok: boolean }>) => void;
};

/** The screenshot-proof photo view; null where capture is blocked another way (or not built). */
export const SecureImage: HostComponent<SecureImageProps> | null =
  Platform.OS === 'ios' && native ? requireNativeComponent<SecureImageProps>('LivilSecureImage') : null;

export type SaveResult = 'saved' | 'denied' | 'failed';

export const chatMediaKit = {
  available: !!native,

  /** Android: block screenshots / recording of the whole window. iPhone: nothing to do. */
  setSecure(secure: boolean): void {
    if (Platform.OS === 'android') { native?.setSecure?.(secure); }
  },

  /** Adds a local photo file to the phone's gallery. Never throws. */
  async saveToPhotos(uri: string): Promise<SaveResult> {
    if (!native || !uri.startsWith('file://')) { return 'failed'; }
    // Android 7–9 needs the storage permission to write into Pictures; 10+ needs none.
    if (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 29) {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE)
        .catch(() => PermissionsAndroid.RESULTS.DENIED);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) { return 'denied'; }
    }
    try {
      await native.saveToPhotos(uri);
      return 'saved';
    } catch (e) {
      const code = e && typeof e === 'object' ? (e as { code?: string }).code : undefined;
      if (code !== 'E_DENIED') { console.warn('[chat-media] save to phone failed', e); }
      return code === 'E_DENIED' ? 'denied' : 'failed';
    }
  },
};
