import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * The vibe of each of my one-to-one chats (my_chat_vibes, 20261106000000): a number that
 * grows with every message, shared song, reaction, Jam and like/comment between the two
 * people. Only the two of them see it; groups have none; it never reads anyone's listening.
 * Computed live on the server.
 *
 * Fail-safe: `null` on any failure — the function not there yet (this build ahead of the
 * migration), offline — so the caller keeps what it had (nothing, at first). Never throws.
 */
export async function getChatVibes(): Promise<Map<string, number> | null> {
  try {
    const { data, error } = await supabase.rpc('my_chat_vibes');
    if (error || !Array.isArray(data)) {return null;}
    const vibes = new Map<string, number>();
    for (const row of data) {
      const vibe = Number(row.vibe);
      if (row.conversation_id && Number.isFinite(vibe) && vibe > 0) {
        vibes.set(row.conversation_id, vibe);
      }
    }
    return vibes;
  } catch {
    return null;
  }
}

/** Quiet time before re-reading, so a burst of list changes is one call, not many. */
const VIBES_DEBOUNCE_MS = 800;

/**
 * Vibes for the inbox, re-read whenever `trigger` changes — pass the conversation list, so
 * a new message (which refreshes the list) moves the number too. Debounced: the inbox
 * changes twice on every focus (cache, then network) and once per incoming message or read.
 */
export function useChatVibes(trigger: unknown): Map<string, number> {
  const [vibes, setVibes] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      getChatVibes().then(v => { if (live && v) {setVibes(v);} });
    }, VIBES_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [trigger]);
  return vibes;
}
