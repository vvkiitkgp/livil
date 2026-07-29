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

function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) { return trimmed; }
  }
  return null;
}
