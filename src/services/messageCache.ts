/**
 * Stale-while-revalidate cache for chat data.
 *
 * Strategy:
 *  1. On screen mount, read from AsyncStorage (< 10ms) → render immediately
 *  2. Kick off the network fetch in parallel
 *  3. When network responds, update state + write-through to cache
 *
 * Cache is per-user-agnostic (keys are by conversationId / "inbox"). If you
 * need to invalidate on sign-out, call `messageCache.clearAll()`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatMessage } from './messages';
import type { ConversationSummary } from './conversations';

// ─── Key schema ───────────────────────────────────────────────────────────────
const K_INBOX = '@livil:inbox_v1';
const K_MSGS = (id: string) => `@livil:msgs_v1_${id}`;

// Max messages kept in cache per conversation (oldest are dropped)
const MAX_MSGS = 60;

// ─── Internal helpers ─────────────────────────────────────────────────────────
async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Disk full / serialization error — silently ignore; cache is best-effort
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const messageCache = {
  // ── Inbox ──────────────────────────────────────────────────────────────────
  getInbox(): Promise<ConversationSummary[] | null> {
    return readJson<ConversationSummary[]>(K_INBOX);
  },

  /** Full replacement — call after a successful listConversations() */
  setInbox(data: ConversationSummary[]): Promise<void> {
    return writeJson(K_INBOX, data);
  },

  // ── Per-conversation messages ───────────────────────────────────────────────
  getMessages(conversationId: string): Promise<ChatMessage[] | null> {
    return readJson<ChatMessage[]>(K_MSGS(conversationId));
  },

  /** Full replacement — call after a successful fetchMessages() on first page */
  setMessages(conversationId: string, msgs: ChatMessage[]): Promise<void> {
    return writeJson(K_MSGS(conversationId), msgs.slice(0, MAX_MSGS));
  },

  /**
   * Prepend new messages without rewriting the whole cache.
   * Used when a message arrives via realtime or optimistic send is confirmed.
   */
  async prependMessages(conversationId: string, newMsgs: ChatMessage[]): Promise<void> {
    const existing = (await readJson<ChatMessage[]>(K_MSGS(conversationId))) ?? [];
    const existingIds = new Set(existing.map(m => m.id));
    const toAdd = newMsgs.filter(m => !existingIds.has(m.id) && !m.id.startsWith('opt-'));
    if (toAdd.length === 0) { return; }
    await writeJson(K_MSGS(conversationId), [...toAdd, ...existing].slice(0, MAX_MSGS));
  },

  /**
   * Replace a single cached message (e.g. optimistic → confirmed,
   * or reaction update). No-op if the message isn't in cache.
   */
  async patchMessage(conversationId: string, updated: ChatMessage): Promise<void> {
    const existing = await readJson<ChatMessage[]>(K_MSGS(conversationId));
    if (!existing) { return; }
    const idx = existing.findIndex(m => m.id === updated.id);
    if (idx === -1) { return; }
    existing[idx] = updated;
    await writeJson(K_MSGS(conversationId), existing);
  },

  // ── Housekeeping ───────────────────────────────────────────────────────────
  async clearConversation(conversationId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(K_MSGS(conversationId));
    } catch {
      // ignore
    }
  },

  async clearAll(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const livil = keys.filter(k => k.startsWith('@livil:'));
      if (livil.length > 0) {
        await AsyncStorage.multiRemove(livil);
      }
    } catch {
      // ignore
    }
  },
};
