import ImagePicker, { type Image as CroppedImage } from 'react-native-image-crop-picker';
import type { PickedFile } from './uploads';
import type { PickedChatMedia } from './chatMedia';
import { photoPicker } from '../native/photoPicker';

/**
 * Photo-gallery picks for the upload screen. Only AUDIO comes from the Files app
 * (`@react-native-documents/picker`); a video, its feed thumbnail and cover art come from the
 * gallery, which is where they live on a phone.
 *
 * Its own module, not `uploads.ts`: the cropper's native module is looked up at import time,
 * and `uploads.ts` is imported by suites that have no reason to mock it.
 */

const SQUARE = {
  width: 1024,
  height: 1024,
  cropperChooseText: 'Use photo',
  cropperCancelText: 'Cancel',
  compressImageQuality: 0.85,
  includeBase64: false,
  forceJpg: true,
} as const;

function isCancel(err: unknown): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
  return code === 'E_PICKER_CANCELLED';
}

/** A square (or circle) crop's settings, as image-crop-picker's cropper takes them. */
export type CropSettings = Omit<Parameters<typeof ImagePicker.openCropper>[0], 'path'>;

/**
 * A photo from the gallery, cropped. On iPhone: Apple's own picker (src/native/photoPicker.ts —
 * the Photos app's look, no library permission), then image-crop-picker's cropper on the
 * chosen photo; the picker's temporary copy is deleted once the cropper has made its own. On
 * Android — or if the cropper cannot open that photo — image-crop-picker's picker-and-crop in
 * one step, as before. Null on cancel.
 */
export async function pickCroppedPhoto(crop: CropSettings): Promise<CroppedImage | null> {
  if (photoPicker.available) {
    // Big enough that the crop still fills its square sharply.
    const picked = await photoPicker.pick({ mediaType: 'photo', maxSide: 2048, quality: 0.92 });
    if (!picked) { return null; }
    try {
      return await ImagePicker.openCropper({ ...crop, path: picked.uri });
    } catch (err) {
      if (isCancel(err)) { return null; }
      console.warn('[picker] the cropper could not open the picked photo; using the older picker', err);
    } finally {
      void photoPicker.remove(picked.uri);
    }
  }
  try {
    return await ImagePicker.openPicker({ ...crop, cropping: true });
  } catch (err) {
    if (isCancel(err)) { return null; }
    throw err;
  }
}

function fileNameOf(path: string, fallback: string): string {
  const last = path.split('/').pop();
  return last && last.includes('.') ? decodeURIComponent(last) : fallback;
}

/**
 * Cover art or a video's feed thumbnail: chosen from the photo gallery and cropped to a
 * SQUARE in one step, at the same 1024px square the studio's cropper
 * (`web/src/components/CoverCropper.tsx`) and album covers produce.
 *
 * Why the crop is real: cover art used to be picked as a plain file and only DISPLAYED
 * square (the preview's `resizeMode="cover"` hid the edges), so the full original uploaded —
 * and the full-screen player, which draws artwork at its own proportions, showed the whole
 * picture the artist thought they had cropped away. Thumbnails render square in the feed
 * (`aspectRatio: 1`), where the feed was choosing the crop instead of the artist.
 *
 * Null on cancel.
 */
export async function pickSquareImageFromGallery(
  purpose: 'cover' | 'thumbnail',
): Promise<PickedFile | null> {
  const img = await pickCroppedPhoto({
    ...SQUARE,
    mediaType: 'photo',
    cropperToolbarTitle: purpose === 'thumbnail' ? 'Crop thumbnail' : 'Crop cover art',
  });
  if (!img) { return null; }
  return {
    uri: img.path,
    name: `${purpose}.jpg`,
    type: img.mime || 'image/jpeg',
    size: typeof img.size === 'number' ? img.size : null,
  };
}

/**
 * A video from the photo gallery.
 *
 * `compressVideoPreset: 'Passthrough'` is load-bearing on iOS: the default re-encodes the
 * video at MEDIUM quality before handing it over, which would quietly publish a worse copy
 * than the artist picked. Passthrough exports the original stream untouched. (Android's
 * system photo picker never re-encodes.) On iPhone, Apple's own picker hands over the original
 * file as it is (src/native/photoPicker.ts). Null on cancel.
 */
export async function pickVideoFromGallery(): Promise<PickedFile | null> {
  if (photoPicker.available) {
    const picked = await photoPicker.pick({ mediaType: 'video' });
    return picked ? { uri: picked.uri, name: picked.name, type: picked.mime, size: picked.bytes || null } : null;
  }
  try {
    const vid = await ImagePicker.openPicker({
      mediaType: 'video',
      compressVideoPreset: 'Passthrough',
    });
    return {
      uri: vid.path,
      name: vid.filename ?? fileNameOf(vid.path, 'video.mp4'),
      type: vid.mime || 'video/mp4',
      size: typeof vid.size === 'number' ? vid.size : null,
    };
  } catch (err) {
    if (isCancel(err)) { return null; }
    throw err;
  }
}

/**
 * A photo for a disappearing chat message (PROP-0011), from the gallery or the camera.
 *
 * Re-encoded to a JPEG of at most 1600 px on the long side: big enough to fill a phone screen,
 * small enough (~300 KB) to fetch the moment it arrives. The re-encode also drops the
 * original's metadata (location included) on both platforms. On iPhone the gallery is Apple's
 * own picker (src/native/photoPicker.ts — no library permission); elsewhere, and on an iPhone
 * build without it, image-crop-picker's. `camera` is the system camera for now; Livil's own
 * tap-for-photo / hold-for-video camera replaces it next release (PROP-0011). Null on cancel.
 */
export async function pickChatPhoto(source: 'camera' | 'gallery'): Promise<PickedChatMedia | null> {
  if (source === 'gallery' && photoPicker.available) {
    const picked = await photoPicker.pick({ mediaType: 'photo', maxSide: 1600, quality: 0.8 });
    return picked
      ? { type: 'photo', uri: picked.uri, mime: 'image/jpeg', w: picked.width, h: picked.height, bytes: picked.bytes }
      : null;
  }
  const options = {
    mediaType: 'photo' as const,
    compressImageMaxWidth: 1600,
    compressImageMaxHeight: 1600,
    compressImageQuality: 0.8,
    forceJpg: true,
    includeExif: false,
    includeBase64: false,
  };
  try {
    const img: CroppedImage = source === 'camera'
      ? await ImagePicker.openCamera(options)
      : await ImagePicker.openPicker(options);
    return {
      type: 'photo',
      uri: img.path,
      mime: 'image/jpeg',
      w: img.width,
      h: img.height,
      bytes: typeof img.size === 'number' ? img.size : 0,
    };
  } catch (err) {
    if (isCancel(err)) { return null; }
    throw err;
  }
}

/**
 * Deletes a file the picker or camera made (a chat photo that was discarded, replaced, failed
 * to send, or has expired). Quiet: a file already gone is fine.
 */
export function cleanPickedFile(path: string): void {
  if (photoPicker.owns(path)) {
    void photoPicker.remove(path);
    return;
  }
  ImagePicker.cleanSingle(path).catch(() => {});
}
