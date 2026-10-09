import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getRepostsPublic } from '../services/profileService';

/**
 * Who can see the signed-in user's reposts (profiles.reposts_public, ADR-0028), read once on
 * mount. null = unknown — loading, unreadable, or the backend change not applied — and every
 * caller hides what it would have said rather than guess about privacy.
 *
 * For one-shot surfaces (the first-run guide). A screen the user returns to after changing
 * the setting should re-read on focus instead (ProfileScreen does).
 */
export function useMyRepostsPublic(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data?.user?.id;
      if (!me) {return;}
      const found = await getRepostsPublic(me);
      if (!cancelled) {setValue(found);}
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return value;
}
