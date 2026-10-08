/**
 * Why someone deleted their account — the optional question asked on the way out.
 *
 * The ids are the stored values: `account_exit_feedback.reason` carries a CHECK listing
 * exactly these (migration 20261012000000). Adding a reason therefore needs a migration
 * that widens the CHECK FIRST, and only then a client that offers it — an app that sends
 * an id the database does not know yet would have its answer rejected. Never rename or
 * remove an id: old app builds keep sending it.
 *
 * Shared because mobile writes these and the ops dashboard labels them; two copies is how
 * the dashboard ends up showing a raw id.
 */

export type ExitReasonId =
  | 'no_music'
  | 'no_friends'
  | 'bugs'
  | 'hard_to_use'
  | 'privacy'
  | 'break'
  | 'other';

export const EXIT_REASONS: { id: ExitReasonId; label: string }[] = [
  { id: 'no_music', label: 'Not enough music I like' },
  { id: 'no_friends', label: 'My friends aren’t here' },
  { id: 'bugs', label: 'Too many bugs' },
  { id: 'hard_to_use', label: 'Hard to use' },
  { id: 'privacy', label: 'Privacy worries' },
  { id: 'break', label: 'Just taking a break' },
  { id: 'other', label: 'Something else' },
];

/** Mirrors the `note` CHECK on `account_exit_feedback`. */
export const EXIT_NOTE_MAX = 1000;
