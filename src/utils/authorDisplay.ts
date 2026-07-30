export type AuthorIdentity = {
  displayName?: string | null;
  username?: string | null;
};

export type AuthorDisplay = {
  name: string;
  /** Never derived from `name` — the placeholder would render '[' in an avatar circle. */
  initial: string;
  isDeleted: boolean;
};

export const DELETED_AUTHOR_NAME = '[deleted]';
export const AUTHOR_INITIAL_FALLBACK = '?';

/**
 * Resolves what to render for an author whose profile may be gone.
 *
 * Returns the name and its initial together so a caller can never hold one
 * without the other and reach for `name.slice(0, 1)`.
 */
export function resolveAuthorDisplay(identity: AuthorIdentity): AuthorDisplay {
  const source = firstNonBlank(identity.displayName, identity.username);
  if (source === null) {
    return {
      name: DELETED_AUTHOR_NAME,
      initial: AUTHOR_INITIAL_FALLBACK,
      isDeleted: true,
    };
  }
  return {
    name: source,
    initial: source.slice(0, 1).toUpperCase(),
    isDeleted: false,
  };
}

/**
 * Resolves an author whose id column is the deletion signal. A missing profile means
 * the join missed — every service that batch-fetches these profiles discards that
 * query's error — so a live author is left nameless rather than called deleted.
 */
export function resolveAuthorById(
  authorId: string | null | undefined,
  identity: AuthorIdentity,
): AuthorDisplay {
  if (!authorId) { return resolveAuthorDisplay({}); }
  const resolved = resolveAuthorDisplay(identity);
  return resolved.isDeleted
    ? { name: '', initial: AUTHOR_INITIAL_FALLBACK, isDeleted: false }
    : resolved;
}

/**
 * Two-letter avatar initials. Falls back to `initial` for a deleted author, so the
 * placeholder can never be sliced into an avatar circle as '[D'.
 */
export function avatarInitials(display: AuthorDisplay): string {
  const parts = display.isDeleted ? [] : display.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) { return display.initial; }
  if (parts.length === 1) { return parts[0]!.slice(0, 2).toUpperCase(); }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) { return trimmed; }
  }
  return null;
}
