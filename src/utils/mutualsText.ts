/**
 * The "Friends with riya, sam and 3 others" line on someone else's profile.
 *
 * Returned as parts rather than a string so the screen can bold the names (Instagram's
 * "Followed by" shape) without parsing its own sentence back apart. Pure, so the grammar —
 * which is easy to get subtly wrong at 1, 2 and 3 — is pinned by tests.
 *
 *   1 → "Friends with riya"
 *   2 → "Friends with riya and sam"
 *   3 → "Friends with riya, sam and 1 other"
 *   9 → "Friends with riya, sam and 7 others"
 *
 * At most two names: a third would usually wrap the line on a phone, and the count says the
 * rest. `otherNoun` lets the starred-by line say "other friend(s)" where "others" alone would
 * be ambiguous.
 */
export type MutualsPart = { text: string; bold: boolean };

export function mutualsParts(
  lead: string,
  names: readonly string[],
  otherNoun: { one: string; many: string } = { one: 'other', many: 'others' },
): MutualsPart[] | null {
  const total = names.length;
  if (total === 0) return null;

  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  const parts: MutualsPart[] = [{ text: `${lead} `, bold: false }, { text: shown[0]!, bold: true }];

  if (shown.length === 2 && rest === 0) {
    parts.push({ text: ' and ', bold: false }, { text: shown[1]!, bold: true });
  } else if (shown.length === 2) {
    parts.push(
      { text: ', ', bold: false },
      { text: shown[1]!, bold: true },
      { text: ' and ', bold: false },
      { text: `${rest} ${rest === 1 ? otherNoun.one : otherNoun.many}`, bold: true },
    );
  }
  return parts;
}

/** The plain sentence, for accessibility labels. */
export function mutualsSentence(parts: readonly MutualsPart[]): string {
  return parts.map(p => p.text).join('');
}
