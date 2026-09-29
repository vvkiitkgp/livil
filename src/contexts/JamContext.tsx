import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { findMyActiveJam } from '../services/jamRooms';

export type ActiveJam = {
  jamRoomId: string;
  conversationId: string;
  conversationTitle: string;
};

type JamContextValue = {
  activeJam: ActiveJam | null;
  setActiveJam: (jam: ActiveJam) => void;
  clearActiveJam: () => void;
};

const JamContext = createContext<JamContextValue | null>(null);

export function JamProvider({ children }: { children: React.ReactNode }) {
  const [activeJam, setActiveJamState] = useState<ActiveJam | null>(null);

  const setActiveJam = useCallback((jam: ActiveJam) => {
    setActiveJamState(jam);
  }, []);

  const clearActiveJam = useCallback(() => {
    setActiveJamState(null);
  }, []);

  // Re-link to a jam you are still in after the app restarts (or you sign in again):
  // the membership survives in the database, this pointer does not. Host or listener,
  // the Jam pill and the live sync come back on their own.
  useEffect(() => {
    let cancelled = false;
    const restore = () => {
      findMyActiveJam()
        .then(found => {
          if (cancelled || !found) { return; }
          // Never override a jam started or joined while this was in flight.
          setActiveJamState(prev => prev ?? { ...found, conversationTitle: 'Jam Room' });
        })
        .catch(e => console.warn('[jam] restore failed', e));
    };
    restore();
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN') { restore(); }
      if (event === 'SIGNED_OUT') { setActiveJamState(null); }
    });
    return () => {
      cancelled = true;
      auth.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<JamContextValue>(
    () => ({ activeJam, setActiveJam, clearActiveJam }),
    [activeJam, setActiveJam, clearActiveJam],
  );

  return <JamContext.Provider value={value}>{children}</JamContext.Provider>;
}

export function useJam(): JamContextValue {
  const ctx = useContext(JamContext);
  if (!ctx) { throw new Error('useJam must be used inside <JamProvider>'); }
  return ctx;
}
