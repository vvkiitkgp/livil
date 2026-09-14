import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Story } from '../services/stories';
import { groupStoriesByAuthor, type StoryCluster } from '../utils/groupStoriesByAuthor';

type StoriesContextValue = {
  stories: Story[];
  /** One entry per author (Instagram-style tray), derived from `stories`. */
  clusters: StoryCluster[];
  setStories: (stories: Story[]) => void;
  markSeenLocal: (storyId: string) => void;
  /** Remove a story locally after the author deletes it, so the ring/viewer
   *  update immediately without a refetch. */
  removeLocal: (storyId: string) => void;
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

  const removeLocal = useCallback((storyId: string) => {
    setStoriesState(prev => prev.filter(s => s.id !== storyId));
  }, []);

  const clusters = useMemo(() => groupStoriesByAuthor(stories), [stories]);

  const value = useMemo<StoriesContextValue>(
    () => ({ stories, clusters, setStories, markSeenLocal, removeLocal }),
    [stories, clusters, setStories, markSeenLocal, removeLocal],
  );

  return <StoriesContext.Provider value={value}>{children}</StoriesContext.Provider>;
}

export function useStories(): StoriesContextValue {
  const ctx = useContext(StoriesContext);
  if (!ctx) {throw new Error('useStories must be used inside <StoriesProvider>');}
  return ctx;
}
