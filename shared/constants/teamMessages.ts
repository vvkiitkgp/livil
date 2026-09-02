/**
 * The bound on a message to the Livil team, mirrored by both clients.
 *
 * `team_messages.body` carries `CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000)`
 * (migration 20260806000000). That check is the one that holds — a client is not the only
 * thing that can POST to PostgREST. The clients mirror it so a too-long message is refused
 * by a counter the writer can see, rather than by a round trip that fails after they hit
 * send.
 *
 * Shared rather than declared once per client: web and mobile write the same column, and
 * two copies of one bound is how they drift apart.
 */
export const MESSAGE_MAX = 4000;
