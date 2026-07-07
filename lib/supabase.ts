import AsyncStorage from '@react-native-async-storage/async-storage';
import {createClient} from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import type {Database} from './database.types';

export const SUPABASE_URL = 'https://fqzrmqnlgjeuxzinbqvs.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxenJtcW5sZ2pldXh6aW5icXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjQwNDYsImV4cCI6MjA5OTAwMDA0Nn0.lM3_oFmNmNL9vyjI1bAuBON_P1rAJolgocB0HWmDCmo';

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
