/**
 * The Supabase client seam.
 *
 * Shared services must work under two very different clients: the mobile one persists its
 * session in AsyncStorage and needs `react-native-url-polyfill`; the web one uses
 * `localStorage` and needs neither. Rather than have `shared/` know about either, each app
 * builds its own client and hands it over once at startup.
 *
 * This is why the seam is injection and not a shared factory: a factory would have to
 * import a storage adapter, which would drag React Native into the web bundle — and the
 * mobile client lives in `lib/supabase.ts`, which is closed to agents. Injection leaves
 * that file untouched. See ADR-0015.
 *
 *   // mobile, once at startup
 *   configureLivilClient(supabase);
 *
 *   // web, once at startup
 *   configureLivilClient(browserClient);
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';

/** A Supabase client typed against the Livil schema. */
export type LivilClient = SupabaseClient<Database>;

let client: LivilClient | null = null;

/**
 * Install the client for this process. Call once, before any shared service runs.
 *
 * Calling twice with different clients is a bug — it would silently repoint every
 * subsequent query mid-session — so it throws rather than swapping. Re-installing the
 * same instance is a no-op, which keeps hot reload from tripping over itself.
 */
export function configureLivilClient(next: LivilClient): void {
  if (client && client !== next) {
    throw new Error(
      'configureLivilClient: a different client is already installed. ' +
        'Shared services are process-wide; repointing them mid-session would move ' +
        'in-flight queries to another session.',
    );
  }
  client = next;
}

/**
 * The installed client.
 *
 * Throws rather than returning null: every caller would have to null-check, and a missed
 * check would surface as an unrelated `undefined` deep inside a query builder. Failing at
 * the seam names the actual problem.
 */
export function livil(): LivilClient {
  if (!client) {
    throw new Error(
      'configureLivilClient() has not been called. Each app must install its own ' +
        'Supabase client at startup before using any shared service.',
    );
  }
  return client;
}

/** Test-only: drop the installed client so a suite can install a stub. */
export function resetLivilClientForTests(): void {
  client = null;
}
