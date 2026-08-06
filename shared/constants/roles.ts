/**
 * Credit roles and the collaborator shapes, re-exported for both clients.
 *
 * `src/constants/roles.ts` remains the single source of truth. It is a plain module whose
 * only dependency is the colour tokens, so the web bundle can consume it directly — and it
 * MUST stay that way: the day it imports something from React Native, this shim stops
 * building and the dashboard's credit picker goes with it.
 *
 * Re-exported rather than moved for the same two reasons as `theme/colors.ts`: `web/`
 * never reaches into `src/`, and `src/constants/**` is not an agent-writable path.
 *
 * The list itself is shared on purpose. Two clients writing free text into one
 * `track_collaborators.role` column would produce "Mixing", "mix" and "Mixed by" as three
 * different credits on the same track, and nothing downstream could tell they were one.
 */
export {
  ROLES,
  getChipTone,
  type CollaboratorKind,
  type CollaboratorStatus,
  type PendingCollaborator,
  type ChipTone,
} from '../../src/constants/roles';

// `getChipStyle` is deliberately NOT re-exported. It returns React Native colour values for
// inline styles; the web client expresses the same three tones as CSS classes driven by
// `getChipTone`, so the shared surface stops at the tone and each client paints it.

/**
 * What the AI did — a ROLE, not a kind of collaborator.
 *
 * This distinction is the whole design. An AI company holds a Livil profile like anybody
 * else, so crediting one is the same two choices as crediting a person: tag @suno if they
 * are here, type "Suno" if they are not. Making AI a third way to name somebody would have
 * meant a tool could never be tagged, only ever typed — and a tagged profile is the thing
 * that makes a credit verifiable.
 *
 * The roles are separate from `ROLES` because a generated vocal is not "Vocals", and an
 * artist held to a credit list later will care about the difference. Kept as a second group
 * rather than merged so somebody picking their instrument does not scroll past six AI
 * entries to reach "Bass".
 *
 * Defined here rather than in `src/constants/roles.ts` because that file is not an
 * agent-writable path. Mobile's picker should adopt this list when it is next touched —
 * until then it renders these credits fine (the column is free text) but cannot offer them.
 */
export const AI_ROLES: readonly string[] = [
  'AI vocals',
  'AI instrumental',
  'AI production',
  'AI mastering',
  'AI stem separation',
  'AI assisted',
];
