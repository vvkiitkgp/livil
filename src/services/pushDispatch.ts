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
  | 'jam_ended'
  | 'activity_like'
  | 'activity_comment'
  | 'activity_repost'
  | 'activity_milestone';

export type PushArgs = {
  recipientUserId: string;
  kind: PushKind;
  title?: string;
  body?: string;
  data?: { route: string; params?: Record<string, string> };
};

export type PushResult = { ok: boolean; error?: string };

// LIV-9: the failure must be LOUD. Previously this swallowed everything three times over
// — `functions.invoke` returns `{ error }` instead of throwing, that error was discarded,
// and callers use `void sendPush(...)`. Net result: send-push did not exist in production
// for months and nothing logged. Now the returned error is surfaced and logged, and the
// result is returned so a caller CAN act on it. Still non-throwing by design (dispatch is
// fire-and-forget and must never break the action that triggered it), but no longer silent.
export async function sendPush(args: PushArgs): Promise<PushResult> {
  try {
    const { error } = await supabase.functions.invoke('send-push', { body: args });
    if (error) {
      console.warn('[push] send-push returned an error', args.kind, error);
      return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[push] dispatch threw', args.kind, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
