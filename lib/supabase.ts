import AsyncStorage from '@react-native-async-storage/async-storage';
import {createClient} from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const supabaseUrl = 'https://itmtmeobsclhyczidjct.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0bXRtZW9ic2NsaHljemlkamN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMDU4MTEsImV4cCI6MjA4OTU4MTgxMX0.TXJqg1j4wq5YXaQGi3vbWKRzhxISd-AGmvrLfrwbE3s';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
