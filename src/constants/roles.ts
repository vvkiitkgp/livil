/**
 * Credit roles, for the mobile app.
 *
 * The lists and the collaborator shapes now live in `shared/constants/roles.ts` so the two
 * clients cannot drift into writing "Mixing", "mix" and "Mixed by" as three different
 * credits in one column. They are re-exported here rather than imported from `shared/`
 * across every screen, so existing imports of this path keep working and a future move
 * touches one file.
 *
 * Only `getChipStyle` is defined here, and deliberately: it returns React Native colour
 * values for inline styles, which is the one thing in this module the web client cannot
 * use. The shared half stops at `getChipTone` and each client paints the tone its own way.
 */
import { COLORS } from '../theme/colors';
import type { ChipTone } from '../../shared/constants/roles';

export {
  ROLES,
  AI_ROLES,
  isPresetRole,
  getChipTone,
} from '../../shared/constants/roles';

export type {
  ChipTone,
  CollaboratorKind,
  CollaboratorStatus,
  PendingCollaborator,
} from '../../shared/constants/roles';

export function getChipStyle(tone: ChipTone): {
  bg: string;
  border: string;
  text: string;
} {
  switch (tone) {
    case 'accepted':
      return {
        bg: COLORS.purpleDim,
        border: COLORS.purple,
        text: COLORS.purpleLight,
      };
    case 'pending':
      return {
        bg: COLORS.warningBg,
        border: COLORS.warningBorder,
        text: COLORS.warning,
      };
    case 'custom':
      return {
        bg: COLORS.infoBg,
        border: COLORS.infoBorder,
        text: COLORS.info,
      };
  }
}
