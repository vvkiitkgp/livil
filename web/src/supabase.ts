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
    // PKCE, not the library default of implicit. Implicit returns the access AND refresh
    // token in the URL FRAGMENT, which lands in session-restore state, in-page scripts and
    // any extension with page access. PKCE keeps the exchange in a POST and the token never
    // enters a URL. Mobile uses implicit for a documented reason — PKCE did not work under
    // React Native — and that reason does not transfer to a browser. Found by security
    // review; decided now rather than retrofitted after tokens have been in URLs for months.
    flowType: 'pkce',
    // Browser defaults: localStorage-backed session, refreshed in the background.
    persistSession: true,
    autoRefreshToken: true,
    // The dashboard is sign-in only (ADR-0015 decision 3), but the OAuth redirect still
    // lands as a URL fragment that has to be consumed.
    detectSessionInUrl: true,
  },
});

configureLivilClient(supabase);
