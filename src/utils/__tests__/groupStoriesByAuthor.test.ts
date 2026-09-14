/**
 * Tests for the story tray grouping.
 *
 * Pure logic, no native deps. Fixed ISO timestamps so ordering assertions cannot
 * drift with the wall clock. These are the tests that let the util live in a
 * `writable` path (autonomy-config.yml) — they fail if grouping, ordering, or the
 * flat-index math breaks.
 */

import {
  groupStoriesByAuthor,
  flattenClusters,
  flatStartIndex,
} from '../groupStoriesByAuthor';
import type { Story } from '../../services/stories';

function mk(
  id: string,
  authorId: string,
  createdAt: string,
  viewedAt: string | null,
): Story {
  return {
    id,
    author: {
      id: authorId,
      username: authorId,
      displayName: null,
      avatarUrl: null,
    },
    track: {
      id: `track_${id}`,
      title: id,
      mediaKind: 'audio',
      audioUrl: 'a',
      videoUrl: null,
      coverArtUrl: null,
      thumbnailUrl: null,
      durationSeconds: null,
    },
    originalPostId: `post_${id}`,
    comment: null,
    clipStartSec: 0,
    clipEndSec: 5,
    createdAt,
    expiresAt: createdAt,
    viewedAt,
  };
}

describe('groupStoriesByAuthor', () => {
  it('collapses each author into a single cluster', () => {
    const clusters = groupStoriesByAuthor([
      mk('a1', 'maya', '2026-07-24T10:00:00Z', null),
      mk('a2', 'maya', '2026-07-24T11:00:00Z', null),
      mk('a3', 'maya', '2026-07-24T12:00:00Z', null),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.authorId).toBe('maya');
    expect(clusters[0]!.storyIds).toEqual(['a1', 'a2', 'a3']);
  });

  it('orders a cluster oldest → newest regardless of input order', () => {
    const clusters = groupStoriesByAuthor([
      mk('late', 'kb', '2026-07-24T15:00:00Z', null),
      mk('early', 'kb', '2026-07-24T09:00:00Z', null),
      mk('mid', 'kb', '2026-07-24T12:00:00Z', null),
    ]);
    expect(clusters[0]!.storyIds).toEqual(['early', 'mid', 'late']);
  });

  it('marks a cluster unseen if ANY story is unseen', () => {
    const clusters = groupStoriesByAuthor([
      mk('s1', 'kb', '2026-07-24T09:00:00Z', '2026-07-24T09:30:00Z'),
      mk('s2', 'kb', '2026-07-24T10:00:00Z', null),
    ]);
    expect(clusters[0]!.hasUnseen).toBe(true);
  });

  it('marks a cluster seen only when every story is seen', () => {
    const clusters = groupStoriesByAuthor([
      mk('s1', 'kb', '2026-07-24T09:00:00Z', '2026-07-24T09:30:00Z'),
      mk('s2', 'kb', '2026-07-24T10:00:00Z', '2026-07-24T10:30:00Z'),
    ]);
    expect(clusters[0]!.hasUnseen).toBe(false);
  });

  it('puts unseen authors before fully-seen authors', () => {
    const clusters = groupStoriesByAuthor([
      mk('seen', 'jonah', '2026-07-24T14:00:00Z', '2026-07-24T14:30:00Z'),
      mk('unseen', 'maya', '2026-07-24T09:00:00Z', null),
    ]);
    expect(clusters.map(c => c.authorId)).toEqual(['maya', 'jonah']);
  });

  it('orders same-seen-state authors by most recent story, newest first', () => {
    const clusters = groupStoriesByAuthor([
      mk('older', 'maya', '2026-07-24T09:00:00Z', null),
      mk('newer', 'kb', '2026-07-24T18:00:00Z', null),
    ]);
    expect(clusters.map(c => c.authorId)).toEqual(['kb', 'maya']);
  });

  it('returns an empty array for no stories', () => {
    expect(groupStoriesByAuthor([])).toEqual([]);
  });

  it('points firstUnseenIndex at the first unwatched clip', () => {
    // Watched the first two of three → should open at index 2 (the third).
    const clusters = groupStoriesByAuthor([
      mk('s1', 'maya', '2026-07-24T09:00:00Z', '2026-07-24T09:30:00Z'),
      mk('s2', 'maya', '2026-07-24T10:00:00Z', '2026-07-24T10:30:00Z'),
      mk('s3', 'maya', '2026-07-24T11:00:00Z', null),
    ]);
    expect(clusters[0]!.storyIds).toEqual(['s1', 's2', 's3']);
    expect(clusters[0]!.firstUnseenIndex).toBe(2);
  });

  it('firstUnseenIndex is 0 when every clip is already seen', () => {
    const clusters = groupStoriesByAuthor([
      mk('s1', 'kb', '2026-07-24T09:00:00Z', '2026-07-24T09:30:00Z'),
      mk('s2', 'kb', '2026-07-24T10:00:00Z', '2026-07-24T10:30:00Z'),
    ]);
    expect(clusters[0]!.firstUnseenIndex).toBe(0);
  });
});

describe('flattenClusters', () => {
  it('concatenates cluster story ids in order and tags each with its author index', () => {
    const flat = flattenClusters([
      { storyIds: ['a1', 'a2'] },
      { storyIds: ['b1'] },
      { storyIds: ['c1', 'c2'] },
    ]);
    expect(flat.orderedStoryIds).toEqual(['a1', 'a2', 'b1', 'c1', 'c2']);
    expect(flat.authorIndexByStory).toEqual([0, 0, 1, 2, 2]);
    expect(flat.clusterStartFlatIndex).toEqual([0, 2, 3]);
  });

  it('handles empty clusters', () => {
    const flat = flattenClusters([]);
    expect(flat.orderedStoryIds).toEqual([]);
    expect(flat.clusterStartFlatIndex).toEqual([]);
  });
});

describe('flatStartIndex', () => {
  const clusters = [
    { storyIds: ['a1', 'a2'] },
    { storyIds: ['b1'] },
    { storyIds: ['c1', 'c2', 'c3'] },
  ];

  it('is 0 for the first story of the first author', () => {
    expect(flatStartIndex(clusters, 0, 0)).toBe(0);
  });

  it('accounts for earlier clusters when starting mid-tray', () => {
    expect(flatStartIndex(clusters, 2, 0)).toBe(3);
    expect(flatStartIndex(clusters, 2, 2)).toBe(5);
  });

  it('defaults to the first story within the author', () => {
    expect(flatStartIndex(clusters, 1)).toBe(2);
  });
});
