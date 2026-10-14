/**
 * Tests for the relationship cache — that a change actually reaches the screen.
 *
 * WHY
 *
 * The profile's friend button reads `status()` from this context. The bug these pin:
 * someone accepts your friend request while your phone is locked, and their profile keeps
 * saying "Requested" — even after pull-to-refresh — until the app restarts. Two defects
 * combined, and each one alone is invisible in the data (the server row was correct):
 *
 *   1. A refetch that flipped pending → friend did not re-render consumers. `status` read
 *      a ref and never changed identity, so the context value stayed the same object.
 *   2. Nothing refetched on return from the background. RealtimeConnectionGate closes the
 *      socket while backgrounded and realtime does not replay missed changes.
 *
 * And the guard that makes fix 1 safe: a refetch returning the SAME relationships must keep
 * the value's identity. InboxScreen refreshes on focus; if every refresh produced a new
 * value, any screen with the context in an effect's deps would refetch forever.
 */

const mockLoad = jest.fn();
jest.mock('../../services/relationships', () => ({
  loadViewerRelationships: () => mockLoad(),
}));

jest.mock('../../../lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'me' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      channel: () => channel,
      removeChannel: () => Promise.resolve(),
    },
  };
});

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { RelationshipProvider, useRelationships } from '../RelationshipContext';

function rels(over: Partial<Record<'friends' | 'pendingOutgoing', string[]>> = {}) {
  return { friends: [], stars: [], pendingOutgoing: [], pendingIncoming: [], blocked: [], ...over };
}

let renders = 0;
let ctx!: ReturnType<typeof useRelationships>;

/** Prints the status the friend button would render for `u2`. */
function Button() {
  ctx = useRelationships();
  renders += 1;
  return <Text>{ctx.status('u2')}</Text>;
}

async function mount() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RelationshipProvider>
        <Button />
      </RelationshipProvider>,
    );
  });
  return tree;
}

const shown = (tree: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

let appStateListener: ((s: AppStateStatus) => void) | null = null;

beforeEach(() => {
  renders = 0;
  appStateListener = null;
  mockLoad.mockReset();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: AppStateStatus) => void) => {
    appStateListener = fn;
    return { remove: () => {} };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => jest.restoreAllMocks());

describe('RelationshipContext', () => {
  it('re-renders the button when a refresh turns "Requested" into a friend', async () => {
    mockLoad.mockResolvedValueOnce(rels({ pendingOutgoing: ['u2'] }));
    const tree = await mount();
    expect(shown(tree)).toContain('pending_outgoing');

    mockLoad.mockResolvedValueOnce(rels({ friends: ['u2'] }));
    await ReactTestRenderer.act(() => ctx.refresh());

    expect(shown(tree)).toContain('friend');
    expect(shown(tree)).not.toContain('pending_outgoing');
  });

  it('refetches when the app comes back from the background', async () => {
    mockLoad.mockResolvedValueOnce(rels({ pendingOutgoing: ['u2'] }));
    const tree = await mount();
    expect(appStateListener).not.toBeNull();

    // The friend accepted while the phone was locked: only a refetch can learn it.
    mockLoad.mockResolvedValueOnce(rels({ friends: ['u2'] }));
    await ReactTestRenderer.act(async () => {
      appStateListener!('background');
      appStateListener!('active');
    });

    expect(shown(tree)).toContain('friend');
    expect(shown(tree)).not.toContain('pending_outgoing');
  });

  it('does not refetch for the app switcher or notification shade (inactive → active)', async () => {
    mockLoad.mockResolvedValue(rels());
    await mount();
    const calls = mockLoad.mock.calls.length;

    await ReactTestRenderer.act(async () => {
      appStateListener!('inactive');
      appStateListener!('active');
    });

    expect(mockLoad.mock.calls.length).toBe(calls);
  });

  it('keeps the same value when a refetch returns the same relationships', async () => {
    mockLoad.mockResolvedValue(rels({ friends: ['u2'] }));
    await mount();
    const before = ctx;
    const rendersBefore = renders;

    await ReactTestRenderer.act(() => ctx.refresh());

    // A new identity here re-runs every effect keyed on the context — InboxScreen's
    // focus refresh among them, which would then refetch in a loop.
    expect(ctx).toBe(before);
    expect(renders).toBe(rendersBefore);
  });
});
