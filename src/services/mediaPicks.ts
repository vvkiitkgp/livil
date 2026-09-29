import ImagePicker, { type Image as CroppedImage } from 'react-native-image-crop-picker';
import type { PickedFile } from './uploads';

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
  try {
    const img: CroppedImage = await ImagePicker.openPicker({
      ...SQUARE,
      cropping: true,
      mediaType: 'photo',
      cropperToolbarTitle: purpose === 'thumbnail' ? 'Crop thumbnail' : 'Crop cover art',
    });
    return {
      uri: img.path,
      name: `${purpose}.jpg`,
      type: img.mime || 'image/jpeg',
      size: typeof img.size === 'number' ? img.size : null,
    };
  } catch (err) {
    if (isCancel(err)) { return null; }
    throw err;
  }
}

/**
 * A video from the photo gallery.
 *
 * `compressVideoPreset: 'Passthrough'` is load-bearing on iOS: the default re-encodes the
 * video at MEDIUM quality before handing it over, which would quietly publish a worse copy
 * than the artist picked. Passthrough exports the original stream untouched. (Android's
 * system photo picker never re-encodes.) Null on cancel.
 */
export async function pickVideoFromGallery(): Promise<PickedFile | null> {
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
