import { Linking } from 'react-native';
import { supabase } from '../../lib/supabase';

export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // After Google auth, Supabase redirects here with ?code=…
      // RootNavigator's Linking listener picks it up and calls exchangeCodeForSession.
      redirectTo: 'livil://auth',
      // Prevent Supabase from calling window.location (N/A in RN); returns the URL instead.
      skipBrowserRedirect: true,
    },
  });
  if (error) { throw error; }
  if (!data.url) { throw new Error('No OAuth URL returned from Supabase.'); }
  await Linking.openURL(data.url);
}
