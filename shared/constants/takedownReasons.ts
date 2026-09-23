/**
 * Why a track came down, as a fixed vocabulary plus an escape hatch.
 *
 * ── WHY PRESETS AND NOT JUST A TEXT BOX ────────────────────────────────────
 *
 * The reason is not an internal note. It is copied verbatim into `post_removals.reason`
 * and shown to the creator on their own profile, as the entire explanation of why their
 * upload disappeared. A free-text box under time pressure produces "copyright", "dup",
 * or an empty string — which reads, to the person on the other end, as no reason at all.
 *
 * Presets also make the queue comparable. "Takedowns for impersonation" is a question you
 * can only answer if the word was chosen from a list rather than typed.
 *
 * ── THE LABEL IS THE STORED VALUE, NOT A SLUG ──────────────────────────────
 *
 * `moderation_actions.reason` and `tracks.taken_down_reason` are free text, and the
 * removal notice renders them as-is on a phone that may be running an older build. A slug
 * would show the creator `hate_speech`. So the SENTENCE is what gets stored, written to
 * be read by the person it happened to — second person, no jargon, no accusation beyond
 * the finding itself.
 *
 * `other` carries no sentence of its own; it requires the operator to write one.
 */

export type TakedownReasonId =
  | 'copyright'
  | 'impersonation'
  | 'explicit'
  | 'hate'
  | 'violence'
  | 'spam'
  | 'illegal'
  | 'other';

export type TakedownReason = {
  id: TakedownReasonId;
  /** The operator-facing label on the option. Short. */
  label: string;
  /**
   * What the CREATOR reads. Empty for `other`, which is the point of `other`.
   * Deliberately explains what to do next where there is something to do.
   */
  sentence: string;
};

export const TAKEDOWN_REASONS: TakedownReason[] = [
  {
    id: 'copyright',
    label: 'Copyright — not the uploader’s to publish',
    sentence:
      'This upload matched a commercial recording and the rights declaration did not '
      + 'support publishing it on Livil. If you do hold the rights, reply to this notice '
      + 'with your licence or distribution paperwork and we will restore it.',
  },
  {
    id: 'impersonation',
    label: 'Impersonation — posted as someone else',
    sentence:
      'This upload was published under another artist’s name or likeness. Livil is built '
      + 'for original and cover work posted as your own — including covers, credited to '
      + 'the writer.',
  },
  {
    id: 'explicit',
    label: 'Sexual or graphic content',
    sentence:
      'This upload contains sexual or graphic material, which Livil does not host.',
  },
  {
    id: 'hate',
    label: 'Hate speech or harassment',
    sentence:
      'This upload targets a person or group with hateful or harassing content, which '
      + 'Livil does not host.',
  },
  {
    id: 'violence',
    label: 'Violence or dangerous content',
    sentence:
      'This upload depicts or encourages violence or serious harm, which Livil does not '
      + 'host.',
  },
  {
    id: 'spam',
    label: 'Spam or a misleading upload',
    sentence:
      'This upload was published to mislead listeners — wrong title, wrong artist, or '
      + 'repeated posting of the same file.',
  },
  {
    id: 'illegal',
    label: 'Illegal content',
    sentence: 'This upload is unlawful to distribute.',
  },
  {
    id: 'other',
    label: 'Something else (write it below)',
    sentence: '',
  },
];

/**
 * The text that actually gets stored and shown.
 *
 * A preset plus a note reads as the standard sentence followed by the operator's own —
 * so the specific thing ("the second verse, from 1:40") is never lost to the category,
 * and the category is never lost to a hurried note.
 */
export function composeTakedownReason(
  id: TakedownReasonId | null,
  note: string,
): string {
  const preset = TAKEDOWN_REASONS.find(r => r.id === id);
  const extra = note.trim();
  if (!preset || preset.id === 'other') return extra;
  return extra ? `${preset.sentence}\n\n${extra}` : preset.sentence;
}

/** `other` is only a reason once somebody has written one. */
export function isTakedownReasonComplete(
  id: TakedownReasonId | null,
  note: string,
): boolean {
  if (id === null) return false;
  if (id === 'other') return note.trim().length > 0;
  return true;
}
