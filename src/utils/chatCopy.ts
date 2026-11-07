import { chatGifFrom } from './chatGif';
import { chatMediaFrom } from './chatMedia';

/** What a chat bubble needs for "Copy" — a subset of ChatMessage, so this stays pure. */
export type CopyableMessage = {
  kind: string;
  body: string | null;
  metadata: unknown;
  deletedAt: string | null;
};

/**
 * The text "Copy" puts on the clipboard for this message, or null when it has none to offer.
 *
 * Only a text message's own words (a link included — a Spotify song message is its link).
 * Not a GIF or a disappearing photo/video: their body is the label older apps show
 * ('🎞 GIF', '📷 Photo · Update Livil to view'), not something the sender wrote. Not a
 * deleted message. Not a shared song, sticker, jam invite or system line: they have no text.
 */
export function copyableText(msg: CopyableMessage): string | null {
  if (msg.kind !== 'text' || msg.deletedAt) { return null; }
  if (chatGifFrom(msg.metadata) || chatMediaFrom(msg.metadata)) { return null; }
  const body = msg.body ?? '';
  return body.trim() ? body : null;
}
