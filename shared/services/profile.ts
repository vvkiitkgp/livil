/**
 * Profile editing, shared by both clients.
 *
 * THE PAYLOAD IS AN EXPLICIT LITERAL, never a spread of form state. That is the whole point
 * of this function existing rather than a `.update()` in a component.
 *
 * `profiles_update_own` is `using (id = auth.uid()) with check (id = auth.uid())` — it
 * constrains WHICH ROW, not WHICH COLUMNS. The database has triggers for the columns that
 * matter most (`profiles_freeze_counters` for the follower counts,
 * `enforce_username_immutable` once a username is claimed), but several columns are guarded
 * by nothing: `created_at` lets an account fake its age, `last_seen_at` lets it spoof
 * presence. A spread of form state is one stray field away from writing any of them.
 *
 * `username` and `username_set` are absent deliberately and permanently. A username is
 * permanent for life via a DB trigger, and it is claimed through the `claim_username` RPC —
 * never through an update. A UI that merely disables the field is a client-side check
 * standing in for a perimeter control.
 */
import { livil } from '../client';

export type ProfilePatch = {
  displayName: string | null;
  bio: string | null;
  links: string[];
  /** Omit to leave the current avatar alone; null clears it. */
  avatarUrl?: string | null;
};

/** Mirrors `profile_links_ok` in the database, so the UI can say why before the round trip. */
export function validateLink(raw: string): string | null {
  const link = raw.trim();
  if (!link) return null;
  if (!/^https?:\/\/\S+$/.test(link)) {
    return 'Links must start with http:// or https:// and contain no spaces.';
  }
  if (link.length > 500) return 'That link is too long.';
  return null;
}

export const MAX_LINKS = 10;
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 160;

/**
 * Apply an edit.
 *
 * `.select('id')` is load-bearing: without it supabase-js sends `Prefer: return=minimal` and
 * PostgREST answers 204 with no error for an update that matched zero rows, so an RLS denial
 * is indistinguishable from a successful save.
 */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const displayName = patch.displayName?.trim() || null;
  const bio = patch.bio?.trim() || null;

  const links = patch.links.map(l => l.trim()).filter(Boolean);
  if (links.length > MAX_LINKS) throw new Error(`At most ${MAX_LINKS} links.`);
  for (const link of links) {
    const problem = validateLink(link);
    if (problem) throw new Error(problem);
  }
  if (displayName && displayName.length > DISPLAY_NAME_MAX) {
    throw new Error(`Display name is at most ${DISPLAY_NAME_MAX} characters.`);
  }
  if (bio && bio.length > BIO_MAX) {
    throw new Error(`Bio is at most ${BIO_MAX} characters.`);
  }

  const { data, error } = await livil()
    .from('profiles')
    .update({
      display_name: displayName,
      bio,
      links,
      ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
    })
    .eq('id', userId)
    .select('id');

  if (error) throw new Error(error.message);
  if (!data || data.length !== 1) {
    throw new Error('That profile could not be updated.');
  }
}
