import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * The vibe of each of my one-to-one chats (my_chat_vibes, 20261106000000): a number that
 * grows with every message, shared song, reaction, Jam and like/comment between the two
 * people. Only the two of them see it; groups have none. Computed live on the server.
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

/**
 * Vibes for the inbox, re-read whenever `trigger` changes — pass the conversation list, so
 * a new message (which refreshes the list) moves the number too.
 */
export function useChatVibes(trigger: unknown): Map<string, number> {
  const [vibes, setVibes] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let live = true;
    getChatVibes().then(v => { if (live && v) {setVibes(v);} });
    return () => { live = false; };
  }, [trigger]);
  return vibes;
}
