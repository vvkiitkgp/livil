/**
 * Credit roles and the collaborator shapes — the source of truth for both clients.
 *
 * This file used to be a shim re-exporting `src/constants/roles.ts`, in the same direction
 * as `theme/colors.ts`. That direction cannot work once the shared file has anything of its
 * OWN to say: mobile importing the AI roles from here while this file imported the human
 * roles from there is a cycle. So the definitions moved and `src/constants/roles.ts` became
 * the shim, which is the arrangement the two lists needed anyway.
 *
 * Kept free of imports on purpose. Every value here is a plain string or a type, so the web
 * bundle takes it directly and Metro resolves it by relative path — and the day something
 * here reaches for a React Native module, one of the two clients stops building.
 *
 * The lists are shared because the alternative is drift with no error: two pickers writing
 * free text into one `track_collaborators.role` column produce "Mixing", "mix" and "Mixed
 * by" as three different credits on the same track, and nothing downstream can tell they
 * were meant to be one.
 */

/** What a person did. Ordered roughly by how often it is picked, not alphabetically. */
export const ROLES: readonly string[] = [
  'Vocals',
  'Lead Vocals',
  'Backing Vocals',
  'Drums',
  'Piano',
  'Keys',
  'Guitar',
  'Bass',
  'Production',
  'Mixing',
  'Mastering',
  'Songwriting',
  'Lyrics',
  'Featured',
];

/**
 * What the AI did — a ROLE, not a kind of collaborator.
 *
 * This distinction is the whole design. An AI company holds a Livil profile like anybody
 * else, so crediting one is the same two choices as crediting a person: tag @suno if they
 * are here, type "Suno" if they are not. Making AI a third way to name somebody would have
 * meant a tool could never be tagged, only ever typed — and a tagged profile is the thing
 * that makes a credit verifiable rather than a claim.
 *
 * A separate list rather than more entries in `ROLES`, because a generated vocal is not
 * "Vocals" — an artist held to a credit list later will care about the difference — and
 * because nobody picking an instrument should scroll past six AI entries to reach "Bass".
 */
export const AI_ROLES: readonly string[] = [
  'AI vocals',
  'AI instrumental',
  'AI production',
  'AI mastering',
  'AI stem separation',
  'AI assisted',
];

/** True when `role` came from a list rather than being typed in. */
export const isPresetRole = (role: string): boolean =>
  ROLES.includes(role) || AI_ROLES.includes(role);

export type CollaboratorKind = 'user' | 'custom';

export type CollaboratorStatus = 'pending' | 'accepted' | 'declined';

export type PendingCollaborator = {
  clientId: string;
  kind: CollaboratorKind;
  userId?: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  role: string;
};

export type ChipTone = 'accepted' | 'pending' | 'custom';

/**
 * How a credit should read: confirmed, awaiting confirmation, or a name with nobody behind
 * it to confirm. Shared so a credit does not change meaning between the phone and the
 * dashboard; each client paints the tone in its own idiom.
 */
export function getChipTone(
  kind: CollaboratorKind,
  status: CollaboratorStatus = 'pending',
): ChipTone {
  if (kind === 'custom') {
    return 'custom';
  }
  return status === 'accepted' ? 'accepted' : 'pending';
}
