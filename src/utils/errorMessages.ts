/**
 * Translate a thrown error into copy that's safe to show to a user.
 *
 * Goals:
 *  - Never surface raw Postgres jargon ("violates check constraint", "duplicate
 *    key", "relation ... does not exist", "row-level security policy", etc.) —
 *    these confuse users and reveal schema internals.
 *  - Pass through deliberately user-friendly messages thrown from our own
 *    service layer ("You must be signed in to comment.").
 *  - Catch common transient failures (network, auth) with action-suggesting
 *    copy so the user knows what to do next.
 *  - Fall back to the caller's action-specific copy when the error is opaque.
 *
 * Pass `fallback` as the action-specific message ("Couldn't post comment.",
 * "Couldn't delete the post.", etc.) — it's used when no better mapping applies
 * and as the prefix for "try again" hints on transient DB errors.
 */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (!err) { return fallback; }

  const message = err instanceof Error ? err.message : String(err);

  // No message at all — nothing more useful to say than the action-specific copy.
  if (!message) { return fallback; }

  // ── Network / fetch failures ─────────────────────────────────────────────
  // RN surfaces these as "Network request failed" or generic "TypeError:
  // Failed to fetch". The fix is always the same — check connectivity.
  if (/network request failed|failed to fetch|networkerror/i.test(message)) {
    return 'Check your connection and try again.';
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  // Either supabase-js auth errors, expired JWT, or a service that explicitly
  // wrote "You must be signed in to …" — the latter is already user-friendly
  // and we let it through via the deliberate-message branch below.
  if (/jwt expired|invalid jwt|invalid api key|not authenticated/i.test(message)) {
    return 'Please sign in again.';
  }

  // ── Permission / RLS ─────────────────────────────────────────────────────
  // The viewer tried something the database refused (RLS policy mismatch).
  // The action button shouldn't have been visible — but if we got here, give
  // an honest "not allowed" rather than a technical one.
  if (/row.level security|policy|permission denied/i.test(message)) {
    return "You don't have permission to do that.";
  }

  // ── Raw Postgres errors ──────────────────────────────────────────────────
  // Anything that mentions "violates", "constraint", "duplicate key", "relation
  // ... does not exist", or "syntax error" is schema-level jargon — the user
  // can't act on it. Surface the action-specific fallback and a retry hint.
  if (/violates|constraint|duplicate key|relation .* does not exist|syntax error|operator does not exist/i.test(message)) {
    return `${fallback} Please try again.`;
  }

  // ── Deliberate, already-friendly service messages ────────────────────────
  // Our services throw short sentences meant for users
  // ("You must be signed in to comment.", "Comment cannot be empty.", etc.).
  // Use them as-is, with a length sanity cap so we don't accidentally surface
  // a multi-line stack trace.
  if (message.length > 0 && message.length < 140) {
    return message;
  }

  return fallback;
}
