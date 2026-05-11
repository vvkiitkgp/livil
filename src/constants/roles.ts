import { COLORS } from '../theme/colors';

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

export function getChipTone(
  kind: CollaboratorKind,
  status: CollaboratorStatus = 'pending',
): ChipTone {
  if (kind === 'custom') {return 'custom';}
  return status === 'accepted' ? 'accepted' : 'pending';
}

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
