import { supabase } from '../../lib/supabase';

export type PushKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'new_follower'
  | 'new_fan'
  | 'message'
  | 'reaction'
  | 'jam_invite_dm'
  | 'jam_started'
  | 'jam_join'
  | 'jam_ended';

export type PushArgs = {
  recipientUserId: string;
  kind: PushKind;
  title?: string;
  body?: string;
  data?: { route: string; params?: Record<string, string> };
};

export async function sendPush(args: PushArgs): Promise<void> {
  try {
    await supabase.functions.invoke('send-push', { body: args });
  } catch (e) {
    console.warn('[push] dispatch failed', e);
  }
}
