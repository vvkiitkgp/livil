import type { Story } from '../services/stories';
import type { AuthorRef } from '../services/posts';

/**
 * Story tray grouping.
 *
 * The feed hands us a FLAT list of stories, sorted unseen-first then newest-first,
 * where a single author's stories are NOT contiguous. The Instagram-style tray
 * shows one ring per PERSON, and opening it plays that person's clips as the
 * segmented progress bar. Both need the flat list collapsed into per-author
 * clusters — and the viewer additionally needs those clusters flattened back into
 * a single ordered index space (so its existing single-index playback machinery,
 * and cross-author tap/swipe, work unchanged).
 *
 * Pure functions, no React / Supabase imports — unit-testable, and the one piece
 * of this feature that lives in a `writable` tested path (autonomy-config.yml).
 */

export type StoryCluster = {
  /** The author, taken from that author's stories. */
  author: AuthorRef;
  authorId: string;
  /** This author's story ids, oldest → newest (chronological play order). */
  storyIds: string[];
  /** True if ANY of this author's stories is still unseen by the viewer. */
  hasUnseen: boolean;
  /** Index into `storyIds` of the first UNSEEN story — where the viewer should
   *  open (Instagram opens at the first unwatched clip, not the start). 0 when
   *  every story is already seen. */
  firstUnseenIndex: number;
};

/**
 * Collapse a flat story list into one cluster per author.
 *
 * - Within a cluster, stories are ordered **oldest → newest** so a person's
 *   stories play in the order they posted them (the Instagram convention).
 * - Clusters are ordered **unseen authors first**, then by the author's most
 *   recent story (newest first) — mirroring the flat list's unseen-first intent
 *   at the person level, so the first unwatched ring is left-most.
 */
export function groupStoriesByAuthor(stories: Story[]): StoryCluster[] {
  const byAuthor = new Map<string, Story[]>();
  const order: string[] = [];
  for (const s of stories) {
    let bucket = byAuthor.get(s.author.id);
    if (!bucket) {
      bucket = [];
      byAuthor.set(s.author.id, bucket);
      order.push(s.author.id);
    }
    bucket.push(s);
  }

  const latestOf = (items: Story[]): string =>
    items.reduce((max, s) => (s.createdAt > max ? s.createdAt : max), items[0]!.createdAt);

  const clusters: StoryCluster[] = order.map(authorId => {
    const items = byAuthor.get(authorId)!;
    const chronological = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const firstUnseen = chronological.findIndex(s => s.viewedAt === null);
    return {
      author: chronological[0]!.author,
      authorId,
      storyIds: chronological.map(s => s.id),
      hasUnseen: firstUnseen >= 0,
      firstUnseenIndex: firstUnseen >= 0 ? firstUnseen : 0,
    };
  });

  return clusters.sort((a, b) => {
    if (a.hasUnseen !== b.hasUnseen) {
      return a.hasUnseen ? -1 : 1;
    }
    return latestOf(byAuthor.get(b.authorId)!).localeCompare(latestOf(byAuthor.get(a.authorId)!));
  });
}

export type FlatClusters = {
  /** Every cluster's story ids, concatenated in cluster order (contiguous per author). */
  orderedStoryIds: string[];
  /** Parallel to `orderedStoryIds`: the cluster (author) index each flat story belongs to. */
  authorIndexByStory: number[];
  /** For each cluster, the flat index where it begins. */
  clusterStartFlatIndex: number[];
};

/**
 * Flatten clusters into a single ordered index space for the viewer. This keeps
 * the viewer on ONE `index` state (preserving the load-bearing per-story playback
 * effect) while still knowing author boundaries: `authorIndexByStory[index]` gives
 * the current author, and `clusterStartFlatIndex[ci]` is where a swipe-to-author
 * jump lands.
 */
export function flattenClusters(clusters: { storyIds: string[] }[]): FlatClusters {
  const orderedStoryIds: string[] = [];
  const authorIndexByStory: number[] = [];
  const clusterStartFlatIndex: number[] = [];
  clusters.forEach((cluster, clusterIndex) => {
    clusterStartFlatIndex.push(orderedStoryIds.length);
    for (const id of cluster.storyIds) {
      orderedStoryIds.push(id);
      authorIndexByStory.push(clusterIndex);
    }
  });
  return { orderedStoryIds, authorIndexByStory, clusterStartFlatIndex };
}

/**
 * The flat index of a given (author, story-within-author) start position — used
 * to translate the tray tap (which knows which ring + which story) into the
 * viewer's single start index.
 */
export function flatStartIndex(
  clusters: { storyIds: string[] }[],
  startAuthorIndex: number,
  startStoryIndex = 0,
): number {
  let flat = 0;
  for (let i = 0; i < startAuthorIndex && i < clusters.length; i++) {
    flat += clusters[i]!.storyIds.length;
  }
  return flat + startStoryIndex;
}
