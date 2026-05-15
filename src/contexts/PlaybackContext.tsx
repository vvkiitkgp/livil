import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Global coordinator: exactly one post may be playing at a time.
 *
 * Each post that wants to play calls `requestPlay(postId)`. The context flips
 * `activePostId` to that id; any other post observing the context will see its
 * id is no longer active and pause itself.
 *
 * We also expose a per-id "request to pause" event count so a card that is
 * currently rendering a player can react when something else snatches the lock
 * (or when a parent screen calls `pauseAll()` on blur/scroll).
 */
type PlaybackContextValue = {
  activePostId: string | null;
  requestPlay: (postId: string) => void;
  reportPaused: (postId: string) => void;
  pauseAll: () => void;
  isActive: (postId: string) => boolean;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [activePostId, setActivePostId] = useState<string | null>(null);
  // Track the latest active id in a ref so callbacks don't depend on the state value
  // (avoids unnecessary re-renders of subscribers).
  const activeRef = useRef<string | null>(null);

  const requestPlay = useCallback((postId: string) => {
    if (activeRef.current === postId) {return;}
    activeRef.current = postId;
    setActivePostId(postId);
  }, []);

  const reportPaused = useCallback((postId: string) => {
    if (activeRef.current === postId) {
      activeRef.current = null;
      setActivePostId(null);
    }
  }, []);

  const pauseAll = useCallback(() => {
    activeRef.current = null;
    setActivePostId(null);
  }, []);

  const isActive = useCallback(
    (postId: string) => activeRef.current === postId,
    [],
  );

  const value = useMemo<PlaybackContextValue>(
    () => ({ activePostId, requestPlay, reportPaused, pauseAll, isActive }),
    [activePostId, requestPlay, reportPaused, pauseAll, isActive],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) {
    throw new Error('usePlayback must be used inside <PlaybackProvider>');
  }
  return ctx;
}
