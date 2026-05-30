import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Story } from '../services/stories';

type StoriesContextValue = {
  stories: Story[];
  setStories: (stories: Story[]) => void;
  markSeenLocal: (storyId: string) => void;
};

const StoriesContext = createContext<StoriesContextValue | null>(null);

export function StoriesProvider({ children }: { children: React.ReactNode }) {
  const [stories, setStoriesState] = useState<Story[]>([]);

  const setStories = useCallback((next: Story[]) => {
    setStoriesState(next);
  }, []);

  const markSeenLocal = useCallback((storyId: string) => {
    setStoriesState(prev =>
      prev.map(s =>
        s.id === storyId && s.viewedAt === null
          ? { ...s, viewedAt: new Date().toISOString() }
          : s,
      ),
    );
  }, []);

  const value = useMemo<StoriesContextValue>(
    () => ({ stories, setStories, markSeenLocal }),
    [stories, setStories, markSeenLocal],
  );

  return <StoriesContext.Provider value={value}>{children}</StoriesContext.Provider>;
}

export function useStories(): StoriesContextValue {
  const ctx = useContext(StoriesContext);
  if (!ctx) {throw new Error('useStories must be used inside <StoriesProvider>');}
  return ctx;
}
