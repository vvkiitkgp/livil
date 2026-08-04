/**
 * The browser Supabase client.
 *
 * Deliberately separate from `lib/supabase.ts`, which is the mobile client (AsyncStorage
 * session storage, `react-native-url-polyfill`) and is closed to agents. Both clients point
 * at the same project; only session persistence differs. See ADR-0015.
 */
import { createClient } from '@supabase/supabase-js';
import { configureLivilClient, type LivilClient } from '@shared/client';
import type { Database } from '@shared/types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly at startup rather than at the first query, where a missing key surfaces
  // as an opaque "Invalid API key" from PostgREST.
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy web/.env.example to ' +
      'web/.env.local and fill it in.',
  );
}

export const supabase: LivilClient = createClient<Database>(url, anonKey, {
  auth: {
    // Browser defaults: localStorage-backed session, refreshed in the background.
    persistSession: true,
    autoRefreshToken: true,
    // The dashboard is sign-in only (ADR-0015 decision 3), but the OAuth redirect still
    // lands as a URL fragment that has to be consumed.
    detectSessionInUrl: true,
  },
});

configureLivilClient(supabase);

/**
 * Escape hatch for schema that exists in the database but not in the generated types.
 *
 * `lib/database.types.ts` is stale: it is missing `profiles.username_set` (migration
 * 20260628000000) and the `waitlist` table (20260718000000) entirely. The mobile app
 * already works around this with `supabase as any` in three places in
 * `src/services/profileService.ts`; this mirrors that precedent rather than inventing a
 * second one.
 *
 * The real fix is to regenerate the types, which would also delete those three mobile
 * casts. Until then, keep uses of this narrow and always alongside a hand-written result
 * type, so the value is still checked at the call site.
 */
export const dbUntyped = supabase as unknown as {
  from: (table: string) => any;
};
