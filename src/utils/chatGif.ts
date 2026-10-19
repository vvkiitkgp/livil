import { GIF_ID_RE } from './gifIds';

/**
 * A GIF in chat (owner, 2026-10-19: "GIFs in chats, same as comments").
 *
 * It travels as a plain TEXT message — body `GIF_LABEL` ('🎞 GIF', the comments' fixed label),
 * `metadata.gif` the GIF — not as a new `messages.kind`. So nothing changes on the server:
 * every installed build reads "🎞 GIF" as text, the inbox line and the push say the same
 * (message_preview / dispatchMessagePush use the body), and this build draws the GIF. Same
 * idea as Spotify songs in chat (ADR-0027).
 *
 * Like a comment, only the id and size are stored; the media URL comes fresh from the `gifs`
 * function, which refuses anything above PG-13 (GIPHY's terms forbid storing URLs).
 */
export type ChatGif = { provider: 'giphy'; id: string; width: number; height: number };

/** Matches the gifs function's MAX_SIDE and post_comments_gif_size. */
const MAX_SIDE = 4096;

function side(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE ? value : null;
}

/**
 * The GIF a message carries, or null. `metadata` is written by the SENDER's app and the
 * database does not check it, so it is validated here, never trusted: a bad id, provider or
 * size is simply not a GIF (the message then shows its text, '🎞 GIF').
 */
export function chatGifFrom(metadata: unknown): ChatGif | null {
  if (!metadata || typeof metadata !== 'object') { return null; }
  const gif = (metadata as { gif?: unknown }).gif;
  if (!gif || typeof gif !== 'object') { return null; }
  const { provider, id, width, height } = gif as Record<string, unknown>;
  if (provider !== 'giphy' || typeof id !== 'string' || !GIF_ID_RE.test(id)) { return null; }
  const w = side(width);
  const h = side(height);
  return w && h ? { provider: 'giphy', id, width: w, height: h } : null;
}

/** The metadata a GIF message is sent with. */
export function chatGifMetadata(gif: { id: string; width: number; height: number }): { gif: ChatGif } {
  return { gif: { provider: 'giphy', id: gif.id, width: gif.width, height: gif.height } };
}
