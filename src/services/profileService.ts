import { DeviceEventEmitter, Platform, type EmitterSubscription } from 'react-native';
import ImagePicker, {
  type Image as CroppedImage,
} from 'react-native-image-crop-picker';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../../lib/supabase';
import { TRACKS_MEDIA_BUCKET } from './uploads';
import type { ExitReasonId } from '../../shared/constants/exitFeedback';

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
  const { data, error } = await supabase
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
  const { error } = await supabase.rpc('claim_username', {
    p_username: username.trim().toLowerCase(),
    // The generated signature types this arg as optional, not nullable, so the key is
    // omitted rather than sent as null. Same result: the function declares
    // `p_display_name text DEFAULT NULL`, so an absent key resolves to NULL server-side.
    p_display_name: displayName?.trim() || undefined,
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
  emitMyAvatarChanged(patch.avatar_url ?? null);
}

const MY_AVATAR_CHANGED = 'livil:profile:my-avatar-changed';

/**
 * The signed-in user's avatar changed. Lets surfaces that show it outside the profile
 * screens (the tab bar) update without refetching. Only updateProfile emits it, and
 * updateProfile is only ever called for the signed-in user's own row.
 */
function emitMyAvatarChanged(url: string | null): void {
  DeviceEventEmitter.emit(MY_AVATAR_CHANGED, url);
}

export function onMyAvatarChanged(listener: (url: string | null) => void): EmitterSubscription {
  return DeviceEventEmitter.addListener(MY_AVATAR_CHANGED, listener);
}

/**
 * "Show what I'm listening to" (Privacy): whether friends see the user's live
 * now-playing. Enforced by the database (`can_see_listening`), not only here.
 * It does NOT control "last seen" — that is shown to no user at all.
 * Defaults to `true` on any error so a transient failure never silently
 * presents the user as having opted out of something they didn't.
 */
export async function getShowActivity(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('show_activity')
    .eq('id', userId)
    .single();
  if (error) {throw error;}
  return (data as { show_activity: boolean | null } | null)?.show_activity ?? true;
}

export async function updateShowActivity(
  userId: string,
  showActivity: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ show_activity: showActivity })
    .eq('id', userId);
  if (error) {throw error;}
}

/**
 * Whether the user wants comments on their posts limited to accepted friends.
 *
 * NOT ENFORCED YET. `post_comments_insert_self` still only checks
 * `author_id = auth.uid()`, so this reads and writes a preference that nothing
 * acts on. Enforcement needs an RLS amendment on post_comments plus a security
 * review — see 20260803000000_profiles_comments_friends_only.sql.
 *
 * Defaults to false (everyone) on error, matching the column default, so a
 * failed read never shows the user a restriction they did not choose.
 */
export async function getCommentsFriendsOnly(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('comments_friends_only')
    .eq('id', userId)
    .single();
  if (error) {throw error;}
  return (data as { comments_friends_only: boolean | null } | null)?.comments_friends_only ?? false;
}

/**
 * Who sees the user's reposts: true = anyone on Livil (the default), false = accepted
 * friends only. ENFORCED by the database — posts_select_authenticated reads
 * profiles.reposts_public live (20261019000000, ADR-0028), so flipping it hides or shows
 * every repost the user has made, past ones included.
 *
 * Returns NULL when the setting can't be read — including before that backend change is
 * applied, when the column does not exist. The caller hides the switch rather than show
 * one that might be wrong: a switch reading "everyone" over reposts that are actually
 * friends-only would be a lie about privacy.
 */
export async function getRepostsPublic(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('reposts_public')
    .eq('id', userId)
    .single();
  if (error) {return null;}
  const value = (data as { reposts_public?: boolean | null } | null)?.reposts_public;
  return typeof value === 'boolean' ? value : null;
}

export async function updateRepostsPublic(userId: string, isPublic: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ reposts_public: isPublic })
    .eq('id', userId);
  if (error) {throw error;}
}

/**
 * Whether the first-run guide (the animated tour shown once after sign-up) has been
 * finished or skipped. NULL on a brand-new account; the migration stamped every
 * account that predates the guide. Fails CLOSED (returns true) so a transient
 * network error never shows a returning user a tour they already sat through.
 */
export async function getGuideSeen(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('guide_seen_at')
    .eq('id', userId)
    .single();
  if (error) {throw error;}
  return (data as { guide_seen_at: string | null } | null)?.guide_seen_at != null;
}

/** Stamps the guide as seen. Idempotent; the owner's own row only (profiles_update_own). */
export async function markGuideSeen(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ guide_seen_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {throw error;}
}

export async function updateCommentsFriendsOnly(
  userId: string,
  friendsOnly: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ comments_friends_only: friendsOnly })
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

const DELETABLE_BUCKETS = [AVATARS_BUCKET, TRACKS_MEDIA_BUCKET];
const LIST_PAGE = 100;
const REMOVE_BATCH = 100;

/**
 * `list()` is one level deep, pages at 100, and returns folders as entries with
 * a null id — so `tracks-media/${userId}` yields track folders, not files.
 * Without the recursion every upload survives the account, silently.
 */
async function listOwnedPaths(bucket: string, root: string): Promise<string[]> {
  const paths: string[] = [];
  const dirs = [root];

  while (dirs.length > 0) {
    const dir = dirs.shift() as string;
    let offset = 0;

    for (;;) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(dir, { limit: LIST_PAGE, offset });
      if (error) {
        throw new Error(`Could not read your files in ${bucket}: ${error.message}`);
      }

      const entries = data ?? [];
      for (const entry of entries) {
        const path = `${dir}/${entry.name}`;
        if (entry.id === null) { dirs.push(path); } else { paths.push(path); }
      }

      if (entries.length < LIST_PAGE) { break; }
      offset += LIST_PAGE;
    }
  }

  return paths;
}

/**
 * storage-api answers 200 with only the rows it actually deleted, so a short
 * return is a refusal rather than an error. Treating it as success would orphan
 * those files behind a deleted account, unreachable forever.
 */
async function removeOwnedPaths(bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { data, error } = await supabase.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Could not delete your files in ${bucket}: ${error.message}`);
    }
    if ((data?.length ?? 0) < batch.length) {
      throw new Error(`Only some of your files in ${bucket} could be deleted.`);
    }
  }
}

/** How long the exit survey may hold up a deletion before we give up on it. */
const EXIT_FEEDBACK_TIMEOUT_MS = 4000;

/**
 * The optional "why are you leaving?" answer, sent just before `deleteMyAccount`.
 *
 * NEVER THROWS, and gives up after a few seconds: a survey must not be the reason someone
 * cannot delete their account. A missing function (backend not migrated yet), a network
 * error or a rejected value all end the same way — the answer is dropped and deletion
 * carries on. An empty answer is a skip and makes no request at all.
 *
 * The row survives the deletion anonymously: `user_id` is SET NULL when the auth user goes
 * (migration 20261012000000).
 */
export async function submitExitFeedback(
  reason: ExitReasonId | null,
  note: string,
): Promise<void> {
  const trimmed = note.trim();
  if (!reason && !trimmed) {
    return;
  }
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined;
  const send = (async () => {
    try {
      await supabase.rpc('submit_account_exit_feedback', {
        p_reason: reason ?? undefined,
        p_note: trimmed || undefined,
        p_platform: platform,
      });
    } catch {
      // Swallowed on purpose — see above.
    }
  })();
  await Promise.race([
    send,
    new Promise<void>(resolve => setTimeout(resolve, EXIT_FEEDBACK_TIMEOUT_MS)),
  ]);
}

/**
 * Permanent. Storage goes first and a failure there aborts: the RPC removes the
 * auth user, and since 20260802000000 the client is the only thing that deletes
 * the files at all. Takes no argument — the prefix is the session's.
 */
export async function deleteMyAccount(): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) {
    throw new Error('You are not signed in.');
  }

  for (const bucket of DELETABLE_BUCKETS) {
    await removeOwnedPaths(bucket, await listOwnedPaths(bucket, userId));
  }

  const { error: rpcError } = await supabase.rpc('delete_my_account');
  if (rpcError) {
    throw new Error(rpcError.message);
  }

  await supabase.auth.signOut();
}
