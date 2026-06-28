import AsyncStorage from '@react-native-async-storage/async-storage';
import {createClient} from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import type {Database} from './database.types';

export const SUPABASE_URL = 'https://itmtmeobsclhyczidjct.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0bXRtZW9ic2NsaHljemlkamN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMDU4MTEsImV4cCI6MjA4OTU4MTgxMX0.TXJqg1j4wq5YXaQGi3vbWKRzhxISd-AGmvrLfrwbE3s';

export const SUPABASE_ANON_KEY = supabaseAnonKey;

export const supabase = createClient<Database>(SUPABASE_URL, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});
