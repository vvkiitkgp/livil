import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

/**
 * The typing indicator's logic on the phone: who is typing in which chat, and when to tell
 * the server that I am. The network side is services/chatTyping.ts.
 *
 * The store is per chat so a signal redraws only what shows that chat (one chat-list line,
 * one bubble), never the list around it. A repeat signal from someone already shown only
 * pushes their expiry back and redraws nothing.
 */

/** While I keep typing, one signal this often. */
export const TYPING_SEND_EVERY_MS = 3000;
/** This long without a key and I have paused: the dots go, even with text left in the box. */
export const TYPING_IDLE_MS = 5000;
/**
 * How long a signal is shown without another. Two send intervals, so one late signal does
 * not make the dots blink, and a phone that goes quiet (app closed, no network) clears itself.
 */
export const TYPING_SHOWN_FOR_MS = 7000;

export type TypingPerson = { userId: string; name: string | null; avatarUrl: string | null };
export type TypingEvent = TypingPerson & { conversationId: string; typing: boolean };

const NOBODY: readonly TypingPerson[] = Object.freeze([]);
const typingIn = new Map<string, readonly TypingPerson[]>();
const expiries = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<() => void>>();

const expiryKey = (conversationId: string, userId: string) => `${conversationId}:${userId}`;

function notify(conversationId: string): void {
  listeners.get(conversationId)?.forEach(listener => listener());
}

/** They stopped, ran out, or their message just arrived, which beats any signal still on its way. */
export function clearPersonTyping(conversationId: string, userId: string): void {
  const key = expiryKey(conversationId, userId);
  const timer = expiries.get(key);
  if (timer) { clearTimeout(timer); }
  expiries.delete(key);

  const people = typingIn.get(conversationId);
  if (!people?.some(p => p.userId === userId)) { return; }
  const rest = people.filter(p => p.userId !== userId);
  if (rest.length > 0) { typingIn.set(conversationId, rest); } else { typingIn.delete(conversationId); }
  notify(conversationId);
}

export function applyTypingEvent(event: TypingEvent): void {
  const { conversationId, userId, name, avatarUrl } = event;
  if (!event.typing) {
    clearPersonTyping(conversationId, userId);
    return;
  }
  const key = expiryKey(conversationId, userId);
  const timer = expiries.get(key);
  if (timer) { clearTimeout(timer); }
  expiries.set(key, setTimeout(() => clearPersonTyping(conversationId, userId), TYPING_SHOWN_FOR_MS));

  const people = typingIn.get(conversationId) ?? NOBODY;
  if (people.some(p => p.userId === userId)) { return; }
  typingIn.set(conversationId, [...people, { userId, name, avatarUrl }]);
  notify(conversationId);
}

/** Signed out, or the connection is being rebuilt: nothing shown can be trusted to clear. */
export function clearAllTyping(): void {
  expiries.forEach(timer => clearTimeout(timer));
  expiries.clear();
  const chats = [...typingIn.keys()];
  typingIn.clear();
  chats.forEach(notify);
}

/** A broadcast's payload as a typing event; anything else is ignored. */
export function parseTypingEvent(payload: unknown): TypingEvent | null {
  const p = payload as {
    conversation_id?: unknown;
    user_id?: unknown;
    typing?: unknown;
    name?: unknown;
    avatar_url?: unknown;
  } | null;
  if (typeof p?.conversation_id !== 'string' || typeof p.user_id !== 'string') { return null; }
  return {
    conversationId: p.conversation_id,
    userId: p.user_id,
    typing: p.typing === true,
    name: typeof p.name === 'string' ? p.name : null,
    avatarUrl: typeof p.avatar_url === 'string' ? p.avatar_url : null,
  };
}

/** Who is typing in this chat right now, oldest signal first. */
export function useChatTyping(conversationId: string): readonly TypingPerson[] {
  return useSyncExternalStore(
    listener => {
      const set = listeners.get(conversationId) ?? new Set<() => void>();
      listeners.set(conversationId, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) { listeners.delete(conversationId); }
      };
    },
    () => typingIn.get(conversationId) ?? NOBODY,
  );
}

/** The chat list's line: one-to-one chats already say who, a group has to. */
export function typingLabel(people: readonly TypingPerson[], isGroup: boolean): string {
  if (!isGroup) { return 'typing…'; }
  const nameOf = (p: TypingPerson | undefined) => p?.name || 'Someone';
  if (people.length <= 1) { return `${nameOf(people[0])} is typing…`; }
  if (people.length === 2) { return `${nameOf(people[0])} and ${nameOf(people[1])} are typing…`; }
  return `${people.length} people are typing…`;
}

/**
 * Tells the chat I am typing while I actually am: a signal on the first key, one every
 * TYPING_SEND_EVERY_MS while keys keep coming, and one stop when I pause for TYPING_IDLE_MS,
 * empty the box, send, leave or cover the chat (`canType` turns false), or put the app away.
 * The owner's rule: the dots follow keystrokes; a draft sitting in the box is not typing.
 *
 * Call the returned function on every key. `send` must keep its identity (useCallback): a new
 * one restarts the signal.
 */
export function useTypingSignal(canType: boolean, send: (typing: boolean) => void): () => void {
  const [typing, setTyping] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paused = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); }
    idleTimer.current = null;
    setTyping(false);
  }, []);

  const typed = useCallback(() => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); }
    idleTimer.current = setTimeout(paused, TYPING_IDLE_MS);
    setTyping(true);
  }, [paused]);

  // Android keeps JS running in the background, so without this a draft would keep saying
  // "typing…" until the idle timer ran out. Coming back takes a new key.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') { paused(); }
    });
    return () => {
      sub.remove();
      if (idleTimer.current) { clearTimeout(idleTimer.current); }
    };
  }, [paused]);

  const on = canType && typing;
  useEffect(() => {
    if (!on) { return; }
    send(true);
    const timer = setInterval(() => send(true), TYPING_SEND_EVERY_MS);
    return () => {
      clearInterval(timer);
      send(false);
    };
  }, [on, send]);

  return typed;
}
