/**
 * A chat's vibe in the inbox (20261106000000): a number beside the friend's name, nothing
 * at 0, and a failed or missing read never surfaces as an error.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../Icon', () => ({ Icon: () => null }));

let mockRpc: { data: unknown; error: unknown } | Error = { data: [], error: null };
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: async () => {
      if (mockRpc instanceof Error) {throw mockRpc;}
      return mockRpc;
    },
  },
}));

import VibeTag from '../VibeTag';
import { getChatVibes } from '../../services/chatVibes';

it('shows the vibe grouped in thousands, and nothing at 0', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<VibeTag vibe={1240} />); });
  const texts = r.root.findAll(n => typeof n.type === 'string' && typeof n.props.children === 'string')
    .map(n => n.props.children);
  expect(texts).toEqual(['1,240']);
  act(() => { r.update(<VibeTag vibe={0} />); });
  expect(r.toJSON()).toBeNull();
});

it('reads each chat\'s vibe, and turns every failure into "nothing new"', async () => {
  mockRpc = { data: [{ conversation_id: 'c1', vibe: 31 }, { conversation_id: 'c2', vibe: 0 }], error: null };
  expect(await getChatVibes()).toEqual(new Map([['c1', 31]]));
  // The function is not there yet (store build ahead of the migration).
  mockRpc = { data: null, error: { code: 'PGRST202', message: 'not found' } };
  expect(await getChatVibes()).toBeNull();
  mockRpc = new Error('Network request failed');
  expect(await getChatVibes()).toBeNull();
});
