/**
 * Disappearing photos and videos in chat (PROP-0011, kb/debt/proposals/0011-disappearing-media-in-chat.md).
 *
 * A photo or video travels as a plain TEXT message — body the upgrade line below, the media
 * in `metadata.media` — not as a new `messages.kind`, exactly like GIFs (chatGif.ts). Every
 * installed build shows the upgrade line as text; this build draws the countdown bubble.
 *
 * The FILE exists for exactly CHAT_MEDIA_LIFETIME_MS from the message's `created_at`, which
 * the server stamps — then the server deletes it and every app drops its copy. The metadata
 * (type, size, dimensions, duration) stays for good. Pure helpers only: no Supabase import.
 */

/** How long a sent photo or video exists, from the message's created_at. */
export const CHAT_MEDIA_LIFETIME_MS = 20 * 60 * 1000;
/** The longest video that can be sent. */
export const CHAT_MEDIA_MAX_VIDEO_MS = 10_000;

/**
 * The text older builds show, and what the inbox line maps to "📷 Sent a photo" /
 * "🎬 Sent a video" (message_preview, 20261118000000). Change one, change the other.
 */
export const CHAT_PHOTO_LABEL = '📷 Photo · Update Livil to view';
export const CHAT_VIDEO_LABEL = '🎬 Video · Update Livil to view';

export type ChatMediaType = 'photo' | 'video';

export type ChatMedia = {
  v: 1;
  type: ChatMediaType;
  /** `<conversation_id>/<uuid>.<ext>` in the private `chat-media` bucket. */
  object: string;
  mime: string;
  /** Pixels; 0 when unknown. */
  w: number;
  h: number;
  bytes: number;
  /** Video only. */
  durationMs?: number;
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Mirrors chat_media_can_upload() in the database and OBJECT_RE in the edge function. */
const OBJECT_RE = new RegExp(`^${UUID}/${UUID}\\.(jpg|mp4|mov)$`);
const MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'video/mp4', 'video/quicktime']);

function count(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : 0;
}

/**
 * The photo or video a message carries, or null. `metadata` is written by the SENDER's app
 * and the database does not check its shape, so it is validated here: a bad object path,
 * type or MIME is simply not media (the message then shows its text).
 */
export function chatMediaFrom(metadata: unknown): ChatMedia | null {
  if (!metadata || typeof metadata !== 'object') { return null; }
  const media = (metadata as { media?: unknown }).media;
  if (!media || typeof media !== 'object') { return null; }
  const m = media as Record<string, unknown>;
  if (m.type !== 'photo' && m.type !== 'video') { return null; }
  if (typeof m.object !== 'string' || !OBJECT_RE.test(m.object)) { return null; }
  if (typeof m.mime !== 'string' || !MIMES.has(m.mime)) { return null; }
  const durationMs = count(m.duration_ms, 60 * 60 * 1000);
  return {
    v: 1,
    type: m.type,
    object: m.object,
    mime: m.mime,
    w: count(m.w, 20_000),
    h: count(m.h, 20_000),
    bytes: count(m.bytes, 1024 * 1024 * 1024),
    ...(m.type === 'video' ? { durationMs } : {}),
  };
}

/** The metadata a photo/video message is sent with (snake_case, as stored). */
export function chatMediaMetadata(media: Omit<ChatMedia, 'v'>): { media: Record<string, unknown> } {
  return {
    media: {
      v: 1,
      type: media.type,
      object: media.object,
      mime: media.mime,
      w: media.w,
      h: media.h,
      bytes: media.bytes,
      ...(media.type === 'video' && media.durationMs != null ? { duration_ms: media.durationMs } : {}),
    },
  };
}

export function chatMediaLabel(type: ChatMediaType): string {
  return type === 'video' ? CHAT_VIDEO_LABEL : CHAT_PHOTO_LABEL;
}

/** What the push says (the inbox line says the same, via message_preview). */
export function chatMediaPushText(type: ChatMediaType): string {
  return type === 'video' ? '🎬 Sent a video' : '📷 Sent a photo';
}

/** When the file is gone, in ms since the epoch (server time). */
export function chatMediaExpiresAt(createdAt: string): number {
  const sent = Date.parse(createdAt);
  return Number.isFinite(sent) ? sent + CHAT_MEDIA_LIFETIME_MS : 0;
}

/** Time left, never negative. `nowMs` is SERVER time (serverClock.serverNow()). */
export function chatMediaLeftMs(createdAt: string, nowMs: number): number {
  return Math.max(0, chatMediaExpiresAt(createdAt) - nowMs);
}

/** "4:58" — rounded UP, so the last half-second still reads 0:01 rather than 0:00. */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** "0:08" for a video's length. */
export function formatDuration(ms: number): string {
  return formatLeft(ms);
}

/**
 * A random v4 UUID for an object name. Not a secret — the bucket is unreadable by path —
 * only unique, so Math.random is enough (Hermes has no crypto.randomUUID).
 */
export function randomUuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
