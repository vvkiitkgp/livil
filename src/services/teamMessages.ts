/**
 * Messages from this device to the Livil team.
 *
 * Mirrors `web/src/data/teamMessages.ts::sendTeamMessage` — one INSERT, same table, same
 * rules — because both clients write into one `team_messages` and a divergence here would
 * produce rows the ops dashboard reads differently depending on where they came from.
 *
 * NOT in `shared/`, unlike publishTrack: shared services resolve their client through
 * `configureLivilClient()`, which this app has never called at runtime. Wiring that seam in
 * for a single insert would mean installing a process-wide client on startup — a much
 * larger change than the thing it would save. The shared piece is the bound, which is data
 * rather than behaviour: `shared/constants/teamMessages.ts`.
 *
 * ACCESS IS THE DATABASE'S DECISION. `team_messages_insert_own` (migration
 * 20260806000000) is `TO authenticated WITH CHECK (sender_id = auth.uid())`, so a signed-in
 * listener may write exactly as a studio artist may, and neither may write as anyone else.
 * No new migration was needed to open this to the app.
 *
 * There is no read path here on purpose: the SELECT policy is ops-only, so a sender cannot
 * fetch their own message back. The screen confirms the send and keeps no history.
 */
import { supabase } from '../../lib/supabase';
import { MESSAGE_MAX } from '../../shared/constants/teamMessages';

/**
 * Send a message. `sender_id` comes from the session rather than a parameter: the policy
 * would reject any other value, and taking it as an argument would invite a caller to think
 * it was theirs to choose.
 *
 * Throws with a message meant for a toast — this screen exists because the `mailto:` it
 * replaces lost messages silently, so a send that failed quietly would reproduce the exact
 * fault it was built to fix.
 */
export async function sendTeamMessage(body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Write something first.');
  }
  if (trimmed.length > MESSAGE_MAX) {
    throw new Error(`That is longer than ${MESSAGE_MAX} characters.`);
  }

  const { data } = await supabase.auth.getSession();
  const senderId = data.session?.user.id;
  if (!senderId) {
    throw new Error('You need to be signed in to send a message.');
  }

  const { error } = await supabase
    .from('team_messages')
    .insert({ sender_id: senderId, body: trimmed });

  if (error) {
    throw new Error(error.message);
  }
}
