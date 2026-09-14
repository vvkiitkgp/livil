/**
 * The recent-searches list.
 *
 * Pure list arithmetic, kept out of the screen and out of storage so it can be tested. The
 * rules are small but every one of them is a decision somebody would otherwise make
 * differently in two places:
 *
 *   · newest first, because that is the order people scan;
 *   · at most four, so it never competes with the results below it;
 *   · de-duplicated case- and whitespace-insensitively — searching "Vvk" after "vvk " is the
 *     same search, and a list that shows it twice looks broken;
 *   · re-searching an old term MOVES it to the top rather than adding a second copy.
 *
 * The stored term keeps the casing it was typed with. Matching ignores case; displaying does
 * not, because "Pehle Bhi Main" is what the person typed and echoing it back lowercased reads
 * as the app correcting them.
 */

/** Four. Enough to be useful, few enough that it never pushes results off the screen. */
export const MAX_RECENT_SEARCHES = 4;

/** The comparison key. Trimmed and lowercased — never shown, only compared. */
const keyOf = (term: string) => term.trim().toLowerCase();

/**
 * Add a term, newest first, capped.
 *
 * Returns the list unchanged for anything blank, so a stray submit on an empty field cannot
 * push a real entry off the end of a four-item list.
 */
export function addRecentSearch(existing: readonly string[], term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return [...existing];

  const key = keyOf(trimmed);
  // The new spelling wins: if it was "vvk" and they now typed "VVK", show what they just
  // typed rather than resurrecting the older casing.
  const withoutDuplicate = existing.filter(item => keyOf(item) !== key);
  return [trimmed, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES);
}

/** Remove a term. No confirmation anywhere in the flow — deleting one is not destructive. */
export function removeRecentSearch(existing: readonly string[], term: string): string[] {
  const key = keyOf(term);
  return existing.filter(item => keyOf(item) !== key);
}

/**
 * Clean a list read from storage.
 *
 * Storage is the one input this module does not control: an older build, a half-written
 * value, or a hand-edited device could hold anything. Non-strings are dropped, blanks are
 * dropped, duplicates collapse, and the cap is re-applied — so a bad read degrades to a
 * shorter list rather than rendering `undefined` in a row.
 */
export function normalizeRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = keyOf(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length === MAX_RECENT_SEARCHES) break;
  }
  return out;
}
