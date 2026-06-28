import ImagePicker, {
  type Image as CroppedImage,
} from 'react-native-image-crop-picker';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../../lib/supabase';

export const AVATARS_BUCKET = 'avatars';

export type PickedAvatar = {
  uri: string;
  mime: string;
};

const AVATAR_CROP_OPTIONS = {
  width: 512,
  height: 512,
  cropping: true,
  mediaType: 'photo' as const,
  cropperCircleOverlay: true,
  cropperToolbarTitle: 'Edit profile picture',
  cropperChooseText: 'Use photo',
  cropperCancelText: 'Cancel',
  compressImageQuality: 0.8,
  includeBase64: false,
  forceJpg: true,
};

function toPickedAvatar(image: CroppedImage): PickedAvatar {
  return { uri: image.path, mime: image.mime || 'image/jpeg' };
}

function isCancelError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {return false;}
  const code = (err as { code?: string }).code;
  return code === 'E_PICKER_CANCELLED' || code === 'E_PERMISSION_MISSING';
}

export type MyProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  links: string[];
};

export type MyPrivateProfile = {
  date_of_birth: string | null;
  phone_number: string | null;
};

export type ProfileUpdatePatch = {
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  links: string[];
};

export type PrivateProfilePatch = {
  date_of_birth: string | null;
  phone_number: string | null;
};

/**
 * Whether the user has deliberately chosen a username. OAuth (Google) signups
 * start as `false` and are prompted to pick one on first launch. Fails open
 * (returns true) so a transient network error never traps a returning user on
 * the username screen.
 */
export async function getUsernameSet(userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from('profiles')
    .select('username_set')
    .eq('id', userId)
    .single();
  if (error) {throw error;}
  return data?.username_set ?? true;
}

/**
 * One-time username claim. Atomically validates + claims a username
 * (case-insensitive uniqueness), optionally sets the display name, and marks
 * username_set = true. The username is permanent afterwards — a second call
 * throws. Throws with a user-facing message on conflict / bad format.
 */
export async function claimUsername(
  username: string,
  displayName?: string | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db.rpc('claim_username', {
    p_username: username.trim().toLowerCase(),
    p_display_name: displayName?.trim() || null,
  });
  if (error) {throw new Error(error.message);}
}

export async function getMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, links')
    .eq('id', userId)
    .single();
  if (error) {throw error;}
  return data as MyProfile;
}

export async function getMyPrivateProfile(
  userId: string,
): Promise<MyPrivateProfile> {
  const { data, error } = await supabase
    .from('profiles_private')
    .select('date_of_birth, phone_number')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {throw error;}
  return data ?? { date_of_birth: null, phone_number: null };
}

export async function updateProfile(
  userId: string,
  patch: ProfileUpdatePatch,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: patch.display_name,
      bio: patch.bio,
      avatar_url: patch.avatar_url,
      links: patch.links,
    })
    .eq('id', userId);
  if (error) {throw error;}
}

export async function updatePrivateProfile(
  userId: string,
  patch: PrivateProfilePatch,
): Promise<void> {
  const { error } = await supabase.from('profiles_private').upsert(
    {
      user_id: userId,
      date_of_birth: patch.date_of_birth,
      phone_number: patch.phone_number,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {throw error;}
}

export async function pickAvatarFromLibrary(): Promise<PickedAvatar | null> {
  try {
    const image = await ImagePicker.openPicker(AVATAR_CROP_OPTIONS);
    return toPickedAvatar(image);
  } catch (err) {
    if (isCancelError(err)) {return null;}
    throw err;
  }
}

export async function pickAvatarFromCamera(): Promise<PickedAvatar | null> {
  try {
    const image = await ImagePicker.openCamera({
      ...AVATAR_CROP_OPTIONS,
      useFrontCamera: true,
    });
    return toPickedAvatar(image);
  } catch (err) {
    if (isCancelError(err)) {return null;}
    throw err;
  }
}

function extensionForMime(mime: string): string {
  if (mime.includes('png')) {return 'png';}
  if (mime.includes('webp')) {return 'webp';}
  if (mime.includes('heic')) {return 'heic';}
  return 'jpg';
}

/**
 * Uploads via the Storage REST endpoint (not supabase-js) so we can include
 * `Authorization: Bearer <session token>`. Path is timestamped per upload so
 * the public URL changes each time, bypassing CDN cache for the previous file.
 */
export async function uploadAvatar(
  userId: string,
  avatar: PickedAvatar,
  accessToken: string,
): Promise<string> {
  const ext = extensionForMime(avatar.mime);
  const path = `${userId}/avatar_${Date.now()}.${ext}`;

  // Stream the cropped image straight from disk via multipart/form-data rather than reading it into
  // a JS ArrayBuffer first (same fragility the track upload hit on large files). The shape mirrors
  // supabase-js so storage-api parses it identically: cacheControl field, then the empty-named file
  // part whose Content-Type becomes the stored object's content type. No request Content-Type
  // header — fetch fills in `multipart/form-data; boundary=…`.
  const formData = new FormData();
  formData.append('cacheControl', '3600');
  formData.append('', { uri: avatar.uri, name: `avatar.${ext}`, type: avatar.mime } as any);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${AVATARS_BUCKET}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
        'x-upsert': 'false',
      },
      body: formData,
    },
  );

  if (!res.ok) {
    let message = `Avatar upload failed (HTTP ${res.status})`;
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed.message === 'string') {message = parsed.message;}
    } catch {
      // non-JSON body
    }
    throw new Error(message);
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
