/**
 * The music score tag (ADR-0032): a number beside the @name and nothing else. It hides
 * when there is no score to show, and a failed or missing read never surfaces as an error.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../Icon', () => ({ Icon: () => null }));

let mockResult: { data: unknown; error: unknown } | Error = { data: { score: 1284 }, error: null };
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (mockResult instanceof Error) {throw mockResult;}
            return mockResult;
          },
        }),
      }),
    }),
  },
}));

import MusicScoreTag from '../MusicScoreTag';
import { formatMusicScore, getMusicScore } from '../../services/musicScore';

function texts(r: TestRenderer.ReactTestRenderer): string[] {
  // Host nodes only: a composite <Text> and the host text it renders carry the same string.
  return r.root.findAll(n => typeof n.type === 'string' && typeof n.props.children === 'string')
    .map(n => n.props.children as string);
}

it('shows the score, grouped in thousands, with no label', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<MusicScoreTag score={1284} />); });
  expect(texts(r)).toEqual(['1,284']);
});

it('shows nothing while loading, or at 0', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<MusicScoreTag score={null} />); });
  expect(r.toJSON()).toBeNull();
  act(() => { r.update(<MusicScoreTag score={0} />); });
  expect(r.toJSON()).toBeNull();
});

it('formats big and odd numbers safely', () => {
  expect(formatMusicScore(7)).toBe('7');
  expect(formatMusicScore(1234567)).toBe('1,234,567');
  expect(formatMusicScore(12.9)).toBe('12');
  expect(formatMusicScore(-5)).toBe('0');
});

it('reads the score, and turns every failure into "no score"', async () => {
  mockResult = { data: { score: 1284 }, error: null };
  await expect(getMusicScore('u1')).resolves.toBe(1284);
  // The table is not there yet (store build ahead of the migration).
  mockResult = { data: null, error: { code: 'PGRST205', message: 'not found' } };
  await expect(getMusicScore('u1')).resolves.toBeNull();
  // No row yet.
  mockResult = { data: null, error: null };
  await expect(getMusicScore('u1')).resolves.toBeNull();
  // Offline.
  mockResult = new Error('Network request failed');
  await expect(getMusicScore('u1')).resolves.toBeNull();
});
