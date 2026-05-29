import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
