import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { parseTypingEvent, type TypingEvent } from '../utils/chatTyping';
import { isMissingFunction } from './conversations';

/**
 * The typing indicator's network side (20261120000000, kb/architecture/realtime.md). Signals
 * go out through send_typing, which decides who hears them, and come in on one private
 * channel per signed-in person, `typing:<their id>`.
 *
 * All of it is fail-safe: a lost signal clears itself on the other phone, and a backend
 * without the migration just means no indicator.
 */

const db = supabase as any;

let typingMissing = false;
let sending = false;
let nextSignal: { conversationId: string; typing: boolean } | null = null;

/**
 * One call at a time, newest wins. Two calls crossing on a slow network could otherwise land
 * "stopped" before "typing", and the dots would stay up after the message arrived.
 */
export function sendTyping(conversationId: string, typing: boolean): void {
  if (typingMissing) { return; }
  nextSignal = { conversationId, typing };
  void flushTyping();
}

async function flushTyping(): Promise<void> {
  if (sending || !nextSignal) { return; }
  const signal = nextSignal;
  nextSignal = null;
  sending = true;
  try {
    const { error } = await db.rpc('send_typing', {
      p_conversation_id: signal.conversationId,
      p_typing: signal.typing,
    });
    if (isMissingFunction(error)) { typingMissing = true; }
  } catch {
    // No network: the other phone clears it by itself.
  }
  sending = false;
  void flushTyping();
}

/** The previous channel finishing its leave. */
let leaving: Promise<unknown> = Promise.resolve();

/**
 * Starts listening; returns how to stop.
 *
 * The server addresses this exact topic and the policy allows only this topic, so it cannot
 * carry the realtime epoch the way other subscribers' topics do. That leaves two ways for the
 * library to break a rebuild on the same topic, both pinned in chatTyping.test.ts:
 *   - a channel still leaving: its late close drops whatever is listed under that topic, which
 *     would be the new channel. So a new join waits for the old leave.
 *   - after the gate's disconnect(): the old channel stays listed with its listeners wiped, and
 *     supabase.channel() would hand that dead one back. Whatever is left once the leave has
 *     finished is that one, so it is dropped before joining.
 */
export function listenForTyping(userId: string, onEvent: (event: TypingEvent) => void): () => void {
  const topic = `typing:${userId}`;
  let stopped = false;
  let channel: RealtimeChannel | null = null;

  const join = () => {
    if (stopped) { return; }
    supabase.realtime.channels = supabase.realtime.channels.filter(c => c.topic !== `realtime:${topic}`);
    channel = supabase
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const event = parseTypingEvent(payload);
        if (event) { onEvent(event); }
      })
      .subscribe(status => {
        console.log('[realtime] typing status', status);
      });
  };
  void leaving.then(join, join);

  return () => {
    stopped = true;
    if (channel) { leaving = supabase.removeChannel(channel); }
  };
}

/** Test-only. */
export function __resetTypingForTest(): void {
  typingMissing = false;
  sending = false;
  nextSignal = null;
  leaving = Promise.resolve();
}
