import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { sendMessage, type ChatMessage } from './messages';
import { sendPush } from './pushDispatch';
import { getActiveConversation } from './activeConversation';
import { studioFiles } from './studioFiles';
import { uploadChatMediaObject } from './uploads';
import {
  chatMediaExpiresAt,
  chatMediaFrom,
  chatMediaLabel,
  chatMediaMetadata,
  randomUuid,
  type ChatMediaType,
} from '../utils/chatMedia';
import { noteServerTime, serverNow } from '../utils/serverClock';

/**
 * Disappearing photos and videos in chat (PROP-0011, kb/debt/proposals/0011-disappearing-media-in-chat.md).
 *
 *   send     — stream the file into the private `chat-media` bucket, then send the message.
 *   prefetch — the app fetches the file as soon as the message is seen and keeps it as a FILE
 *              in its private folder, so it opens instantly and offline. The link comes from
 *              the `chat-media` function and lives only for the time left.
 *   expiry   — every local copy is deleted at created_at + 20 min (server time), and ALL of
 *              them the moment the app is left (background); the ones still live are fetched
 *              again on return. Anything left behind (the app was killed) is swept on launch.
 *   saves    — "Saved to phone by": who saved which photo/video, and a push to the chat.
 *
 * Fail-safe throughout: a missing function, a failed link or download just means "not
 * ready"; nothing here throws into a render.
 */

const db = supabase as any;

async function call<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke('chat-media', { body });
    if (error) {
      // 410 (expired) and 404 (not visible) are ordinary answers, not failures worth a warning.
      return null;
    }
    return (data ?? null) as T | null;
  } catch (e) {
    console.warn('[chat-media] call failed', body.action, e);
    return null;
  }
}

// ── Availability ────────────────────────────────────────────────────────────
//
// "Is there a camera button?" = does the function answer `enabled: true`. Not deployed, or
// CHAT_MEDIA_ENABLED unset, is "no". Cached a few minutes and re-asked on foreground, so
// switching it on reaches open apps without a restart (useGifsEnabled's pattern).
//
// The last answer is also kept on the phone, so the button is there the moment a chat opens
// instead of popping in after the network round trip; the fresh answer then confirms it.

const AVAILABILITY_TTL_MS = 5 * 60 * 1000;
const ENABLED_KEY = 'livil.chatMedia.enabled';
let availability: { enabled: boolean; at: number } | null = null;
let availabilityInFlight: Promise<boolean> | null = null;
let lastKnown: boolean | null = null;
let lastKnownLoad: Promise<void> | null = null;
const availabilityListeners = new Set<(enabled: boolean) => void>();

/** Reads the answer kept from the last run. Started at app launch (startChatMediaHousekeeping). */
function loadLastKnown(): Promise<void> {
  return (lastKnownLoad ??= AsyncStorage.getItem(ENABLED_KEY)
    .then(raw => {
      if (raw === null || availability) { return; }
      lastKnown = raw === '1';
      availabilityListeners.forEach(l => l(lastKnown === true));
    })
    .catch(() => {}));
}

export function getChatMediaEnabled(): Promise<boolean> {
  if (availability && Date.now() - availability.at < AVAILABILITY_TTL_MS) {
    return Promise.resolve(availability.enabled);
  }
  if (!availabilityInFlight) {
    availabilityInFlight = call<{ enabled?: boolean }>({ action: 'status' })
      .then(res => {
        const enabled = res?.enabled === true;
        availability = { enabled, at: Date.now() };
        // Only a real answer is kept: a failed call (offline) must not hide the button next time.
        if (res) { void AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0').catch(() => {}); }
        return enabled;
      })
      .finally(() => { availabilityInFlight = null; });
  }
  return availabilityInFlight;
}

export function useChatMediaEnabled(): boolean {
  const [enabled, setEnabled] = useState(availability?.enabled ?? lastKnown ?? false);
  useEffect(() => {
    let cancelled = false;
    // The kept answer, if it arrives before the fresh one.
    const onLastKnown = (v: boolean) => { if (!cancelled && !availability) { setEnabled(v); } };
    availabilityListeners.add(onLastKnown);
    void loadLastKnown();
    const refresh = () => {
      getChatMediaEnabled().then(v => { if (!cancelled) { setEnabled(v); } });
    };
    refresh();
    const sub = AppState.addEventListener('change', next => { if (next === 'active') { refresh(); } });
    return () => {
      cancelled = true;
      availabilityListeners.delete(onLastKnown);
      sub.remove();
    };
  }, []);
  return enabled;
}

// ── Local copies ────────────────────────────────────────────────────────────
//
// messageId → a URI the viewer can show without the network. Received photos are written as
// FILES under the app's private folder (`<root>/chat-media/<messageId>/`, via the app's own
// file module — src/services/studioFiles.ts; never backed up), so the picture is decoded
// natively and never travels through JS as text again. A build without that module holds the
// photo in memory instead. Either way the copy is deleted at expiry by a timer while the app
// is open, and EVERY copy is deleted as soon as the app is left (wipe()): a phone does not
// reliably run an app's timers once it is in the background, so a timed delete there would be
// a promise we cannot keep (the owner chose this over a native timed delete, 2026-11-02). The
// photos still in their window are fetched again on return (restore()), so they keep opening
// instantly while the app is in use. sweepPhone() on launch catches a run that was killed.

const DIR = 'chat-media';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type LocalCopy = {
  uri: string;
  expiresAt: number;
  /** Lives in `<root>/chat-media/<messageId>/` — delete the folder on drop. */
  onDisk: boolean;
  /** Extra clean-up on drop (the sender's picker file). */
  onDrop?: () => void;
};
const copies = new Map<string, LocalCopy>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<string | null>>();
/** Every live photo the app has asked for — what restore() fetches again on return. */
const wanted = new Map<string, ChatMessage>();
/**
 * After a return, the open chat first reloads its own messages (ConversationScreen's resume
 * refresh); photos wait this long, so they never compete with it for the network.
 */
const RESTORE_DELAY_MS = 1500;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
/** queueChatMediaPrefetch's line: one quiet download at a time. */
let quietLine: Promise<unknown> = Promise.resolve();
/** Copies wipe() leaves alone for now (pinChatMedia). */
const pinned = new Set<string>();
const listeners = new Set<() => void>();

/** Left the app. Android also reports this under its own dialogs, e.g. a permission prompt. */
function away(): boolean {
  return AppState.currentState === 'background';
}

function notify(): void {
  listeners.forEach(l => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let filesRoot: Promise<string> | null = null;
/** The private folder's absolute path, or null on a build without the file module. */
function phoneRoot(): Promise<string> | null {
  if (!studioFiles.available) { return null; }
  return (filesRoot ??= studioFiles.root());
}

function fileUri(root: string, messageId: string): string {
  return `file://${root}/${DIR}/${messageId}/media.jpg`;
}

/** Deletes a copy: the file (if any), the picker's file (sender), the timer, the entry. */
function drop(messageId: string): void {
  const timer = timers.get(messageId);
  if (timer) { clearTimeout(timer); timers.delete(messageId); }
  const copy = copies.get(messageId);
  if (!copy) { return; }
  copies.delete(messageId);
  if (copy.onDisk) { void studioFiles.remove(`${DIR}/${messageId}`).catch(() => false); }
  copy.onDrop?.();
  notify();
}

/**
 * Holds a copy until it expires. One already expired is deleted at once — and so is one that
 * arrives while the app is in the background (a download that finished after wipe()).
 */
function keep(messageId: string, copy: LocalCopy): void {
  const left = copy.expiresAt - serverNow();
  if (left <= 0 || away()) {
    if (copy.onDisk) { void studioFiles.remove(`${DIR}/${messageId}`).catch(() => false); }
    copy.onDrop?.();
    return;
  }
  const timer = timers.get(messageId);
  if (timer) { clearTimeout(timer); }
  copies.set(messageId, copy);
  timers.set(messageId, setTimeout(() => {
    wanted.delete(messageId);
    drop(messageId);
  }, left));
  notify();
}

/** The app was left: every copy is deleted now, except a pinned one (until it is released). */
function wipe(): void {
  if (restoreTimer) {
    clearTimeout(restoreTimer);
    restoreTimer = null;
  }
  for (const id of [...copies.keys()]) {
    if (!pinned.has(id)) { drop(id); }
  }
}

/**
 * Back in the app: fetch again the OPEN chat's photos still in their window — a moment after
 * the return and one at a time (queueChatMediaPrefetch), so the chat's new messages and the
 * chat list catch up first. Another chat's photos are fetched when that chat opens
 * (ConversationScreen), the viewer fetches its own photo, and a tap fetches at once.
 */
function restore(): void {
  if (restoreTimer) { clearTimeout(restoreTimer); }
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    const open = getActiveConversation();
    for (const [id, msg] of [...wanted]) {
      if (serverNow() >= chatMediaExpiresAt(msg.createdAt)) {
        wanted.delete(id);
      } else if (msg.conversationId === open) {
        queueChatMediaPrefetch(msg);
      }
    }
  }, RESTORE_DELAY_MS);
}

/**
 * prefetchChatMedia for photos nobody is waiting on yet — a chat's photos as it opens, the
 * open chat's after a return — ONE AT A TIME, so a burst of downloads never competes with the
 * chat's own messages for the network. A tap or the viewer calls prefetchChatMedia directly
 * and goes first; a queued photo that is already here by its turn costs nothing.
 */
export function queueChatMediaPrefetch(msg: ChatMessage): void {
  quietLine = quietLine.then(() => settleWithin(prefetchChatMedia(msg), QUIET_STEP_MAX_MS));
}

/** A stalled download must not hold up the line behind it. */
const QUIET_STEP_MAX_MS = 20_000;

function settleWithin<T>(job: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    job.then(
      v => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

/**
 * Keeps one copy through a wipe until the returned release() — for Save, whose Android 7–9
 * permission dialog puts the app in the background for a moment. Released while the app is
 * still in the background → deleted then.
 */
export function pinChatMedia(messageId: string): () => void {
  pinned.add(messageId);
  return () => {
    pinned.delete(messageId);
    if (away()) { drop(messageId); }
  };
}

/**
 * The local copy of a message's photo/video, or null when there is none or it has expired.
 * A pure read — nothing is deleted here (that is drop()'s job), so it is safe during render.
 */
export function localChatMedia(messageId: string): string | null {
  const copy = copies.get(messageId);
  return copy && serverNow() < copy.expiresAt ? copy.uri : null;
}

/**
 * localChatMedia for a render. Re-renders only when THIS message's copy changes — not when
 * any other photo arrives — and answers a new `messageId` in the same render (a copy held in
 * state lagged one frame and flashed the previous photo).
 */
export function useLocalChatMedia(messageId: string): string | null {
  return useSyncExternalStore(subscribe, () => localChatMedia(messageId));
}

async function blobToDataUri(blob: Blob): Promise<string | null> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads a photo and keeps it: as a file in the private folder when the build can, else in
 * memory. The bytes pass through JS once, here, and never again.
 */
async function savePhoto(messageId: string, url: string, expiresAt: number): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) { return null; }
  const dataUri = await blobToDataUri(await res.blob());
  if (!dataUri) { return null; }
  const root = phoneRoot();
  if (root) {
    try {
      const base = await root;
      const folder = `${DIR}/${messageId}`;
      await studioFiles.writeBase64(`${folder}/media.jpg`, dataUri.slice(dataUri.indexOf(',') + 1));
      // The expiry is written LAST: a folder without it (the app died mid-write) is deleted by
      // the next sweep instead of being shown.
      await studioFiles.writeText(`${folder}/meta.json`, JSON.stringify({ expiresAt }));
      keep(messageId, { uri: fileUri(base, messageId), expiresAt, onDisk: true });
      return localChatMedia(messageId);
    } catch (e) {
      console.warn('[chat-media] could not write the photo to the phone; keeping it in memory', e);
      void studioFiles.remove(`${DIR}/${messageId}`).catch(() => false);
    }
  }
  keep(messageId, { uri: dataUri, expiresAt, onDisk: false });
  return localChatMedia(messageId);
}

/**
 * Deletes every expired copy: the ones held now (their timers may not have run while the app
 * slept), and any folder left on the phone by an earlier run. Copies still in their window are
 * picked back up, so a photo fetched before a restart still opens offline. Never throws.
 */
async function sweepPhone(): Promise<void> {
  for (const [id, copy] of [...copies]) {
    if (serverNow() >= copy.expiresAt) { drop(id); }
  }
  const root = phoneRoot();
  if (!root) { return; }
  try {
    const base = await root;
    const ids = await studioFiles.listDirs(DIR).catch(() => [] as string[]);
    for (const id of ids) {
      if (!UUID_RE.test(id)) { continue; }
      if (copies.has(id)) { continue; }
      let expiresAt = NaN;
      try {
        const meta = JSON.parse(await studioFiles.readText(`${DIR}/${id}/meta.json`)) as { expiresAt?: unknown };
        expiresAt = typeof meta.expiresAt === 'number' ? meta.expiresAt : NaN;
      } catch {
        // No expiry written: an interrupted download. Deleted below.
      }
      if (Number.isFinite(expiresAt) && serverNow() < expiresAt) {
        keep(id, { uri: fileUri(base, id), expiresAt, onDisk: true });
      } else {
        await studioFiles.remove(`${DIR}/${id}`).catch(() => false);
      }
    }
  } catch (e) {
    console.warn('[chat-media] sweep failed', e);
  }
}

let housekeeping = false;
/**
 * Starts the clean-up: a sweep now; every copy deleted when the app is left; a sweep and the
 * live photos fetched again on every return. Called once at app start (App.tsx); repeat calls
 * do nothing.
 */
export function startChatMediaHousekeeping(): void {
  if (housekeeping) { return; }
  housekeeping = true;
  void loadLastKnown();
  void sweepPhone();
  AppState.addEventListener('change', next => {
    if (next === 'background') {
      wipe();
    } else if (next === 'active') {
      void sweepPhone().then(restore);
    }
  });
}

/**
 * Fetch a photo/video now, while it exists, so it opens instantly — and offline — later.
 * Sender and recipients alike: the `link` function serves any member of the chat. Idempotent
 * and quiet: already held, in flight, expired, deleted, or not media → nothing happens.
 * In the background nothing is fetched (it would only be wiped); the photo is remembered and
 * fetched on return. Resolves to the local URI or null.
 */
export function prefetchChatMedia(msg: ChatMessage): Promise<string | null> {
  const media = chatMediaFrom(msg.metadata);
  if (!media || msg.deletedAt || msg.id.startsWith('opt-')) { return Promise.resolve(null); }
  const held = localChatMedia(msg.id);
  if (held) { return Promise.resolve(held); }
  if (serverNow() >= chatMediaExpiresAt(msg.createdAt)) { return Promise.resolve(null); }
  // Videos wait for a native download: their bytes are too big to pass through JS.
  if (media.type !== 'photo') { return Promise.resolve(null); }
  wanted.set(msg.id, msg);
  if (away()) { return Promise.resolve(null); }
  const running = inflight.get(msg.id);
  if (running) { return running; }

  const job = (async () => {
    const askedAt = Date.now();
    const res = await call<{ url?: string; expires_at?: string; now?: string }>({
      action: 'link',
      message_id: msg.id,
    });
    if (!res?.url || !res.expires_at) { return null; }
    if (res.now) { noteServerTime(res.now, askedAt, Date.now()); }
    return savePhoto(msg.id, res.url, Date.parse(res.expires_at)).catch(() => null);
  })().finally(() => { inflight.delete(msg.id); });
  inflight.set(msg.id, job);
  return job;
}

// ── Sending ─────────────────────────────────────────────────────────────────

export type PickedChatMedia = {
  type: ChatMediaType;
  /** A local file URI (picker or camera output). */
  uri: string;
  mime: string;
  w: number;
  h: number;
  bytes: number;
  durationMs?: number;
};

function extensionFor(picked: PickedChatMedia): 'jpg' | 'mp4' | 'mov' {
  if (picked.type === 'photo') { return 'jpg'; }
  return picked.mime === 'video/quicktime' ? 'mov' : 'mp4';
}

/**
 * Upload the file, then send the message that names it. The upload goes first so a
 * recipient never sees a bubble whose file is not there yet. Throws on failure — the caller
 * owns the toast and the optimistic bubble.
 */
export async function sendChatMedia(
  conversationId: string,
  picked: PickedChatMedia,
  senderInfo?: { username: string | null; displayName: string | null; avatarUrl: string | null },
  /** Runs when the sender's copy (the picker's file) is dropped at expiry — delete that file. */
  onExpire?: () => void,
): Promise<ChatMessage> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) { throw new Error('Not signed in'); }
  const ext = extensionFor(picked);
  const object = `${conversationId}/${randomUuid()}.${ext}`;
  await uploadChatMediaObject(object, picked.uri, `media.${ext}`, picked.mime, token);
  const metadata = chatMediaMetadata({
    type: picked.type,
    object,
    mime: picked.mime,
    w: picked.w,
    h: picked.h,
    bytes: picked.bytes,
    ...(picked.durationMs != null ? { durationMs: picked.durationMs } : {}),
  });
  const message = await sendMessage(
    conversationId,
    { kind: 'text', body: chatMediaLabel(picked.type), metadata },
    senderInfo,
  );
  // The sender keeps the file it just sent, for the same 20 minutes.
  wanted.set(message.id, message);
  keep(message.id, { uri: picked.uri, expiresAt: chatMediaExpiresAt(message.createdAt), onDisk: false, onDrop: onExpire });
  return message;
}

// ── Saves ───────────────────────────────────────────────────────────────────

export type ChatMediaSaver = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type SaveRow = {
  message_id: string;
  user_id: string;
  profiles: { username: string | null; display_name: string | null; avatar_url: string | null } | null;
};

function toSaver(row: SaveRow): ChatMediaSaver {
  return {
    userId: row.user_id,
    username: row.profiles?.username ?? null,
    displayName: row.profiles?.display_name ?? null,
    avatarUrl: row.profiles?.avatar_url ?? null,
  };
}

/** Who saved each of these messages' photo/video, oldest save first. Empty on failure. */
export async function fetchChatMediaSavers(messageIds: string[]): Promise<Record<string, ChatMediaSaver[]>> {
  const out: Record<string, ChatMediaSaver[]> = {};
  if (messageIds.length === 0) { return out; }
  try {
    const { data, error } = await db
      .from('chat_media_saves')
      .select('message_id, user_id, profiles(username, display_name, avatar_url)')
      .in('message_id', messageIds)
      .order('saved_at', { ascending: true });
    if (error) { return out; }
    for (const row of (data ?? []) as SaveRow[]) {
      (out[row.message_id] ??= []).push(toSaver(row));
    }
  } catch {
    // Table not there yet (backend not applied): no markers.
  }
  return out;
}

/**
 * Record that I saved this photo/video to my phone. A repeat save is fine. False when it was
 * refused (my own photo, or past its window — chat_media_saves' insert policy) or failed.
 */
export async function recordChatMediaSave(messageId: string, myId: string): Promise<boolean> {
  try {
    const { error } = await db
      .from('chat_media_saves')
      .upsert({ message_id: messageId, user_id: myId }, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
    if (error) { console.warn('[chat-media] could not record save', error.message); }
    return !error;
  } catch (e) {
    console.warn('[chat-media] could not record save', e);
    return false;
  }
}

/**
 * Tells the chat I saved this photo/video: every other member gets a push — the sender
 * "📸 Saved your photo", anyone else in a group "📸 Saved @arjun's photo".
 *
 * Sent as a chat `message` push, which every shipped app already shows and opens to the chat
 * (and which needs no new send-push kind). send-push titles it — the saver in a DM, the
 * group's name with an "@saver: " prefix in a group — checks that both people are members of
 * the conversation, and honours each recipient's chat-notification switch. Call it only for a
 * save that was recorded. Fire-and-forget; never throws.
 */
export async function notifyChatMediaSaved(
  message: ChatMessage,
  myId: string,
  /** My display name or handle: the title of the DM the notification opens. */
  myName: string,
): Promise<void> {
  const media = chatMediaFrom(message.metadata);
  if (!media || !myId) { return; }
  try {
    const [convRes, membersRes] = await Promise.all([
      db.from('conversations').select('kind, name').eq('id', message.conversationId).maybeSingle(),
      db
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', message.conversationId)
        .neq('user_id', myId),
    ]);
    const conv = convRes.data as { kind: 'dm' | 'group'; name: string | null } | null;
    const members = (membersRes.data ?? []) as Array<{ user_id: string }>;
    if (!conv || members.length === 0) { return; }
    const isGroup = conv.kind === 'group';
    const noun = media.type === 'video' ? 'video' : 'photo';
    const theirs = message.senderUsername ? `@${message.senderUsername}'s ${noun}` : `a ${noun}`;
    await Promise.all(
      members.map(m =>
        sendPush({
          recipientUserId: m.user_id,
          kind: 'message',
          body: m.user_id === message.senderId ? `📸 Saved your ${noun}` : `📸 Saved ${theirs}`,
          data: {
            route: 'Conversation',
            // No `kind` here, as in dispatchMessagePush (messages.ts).
            params: {
              conversationId: message.conversationId,
              title: isGroup ? (conv.name ?? 'Group chat') : myName,
            },
          },
        }),
      ),
    );
  } catch (e) {
    console.warn('[chat-media] save notification failed', e);
  }
}

/** New saves as they happen (RLS limits delivery to chats I am in). Returns unsubscribe. */
export function subscribeChatMediaSaves(onSave: (messageId: string, userId: string) => void): () => void {
  const channel = supabase
    .channel(`chat-media-saves:${Math.random().toString(36).slice(2, 10)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_media_saves' },
      (payload: { new?: Record<string, unknown> }) => {
        const row = payload.new;
        if (row && typeof row.message_id === 'string' && typeof row.user_id === 'string') {
          onSave(row.message_id, row.user_id);
        }
      },
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
