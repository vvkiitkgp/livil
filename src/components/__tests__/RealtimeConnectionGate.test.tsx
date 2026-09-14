/**
 * The gate closes the realtime socket in the background to stop it polling
 * through a whole background listening session. The risk it carries is the
 * mirror image: a socket that closes and never reopens looks like "chat just
 * stopped working", silently and only after the user has switched apps once.
 *
 * So these pin both directions, plus the jam exemption — dropping the socket
 * mid-jam would desync every participant.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';

let appStateListener: ((state: string) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  _event: string,
  handler: (state: string) => void,
) => {
  appStateListener = handler;
  return { remove: () => { appStateListener = undefined; } };
}) as unknown as typeof AppState.addEventListener);

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    realtime: {
      connect: (...a: unknown[]) => mockConnect(...(a as [])),
      disconnect: (...a: unknown[]) => mockDisconnect(...(a as [])),
    },
  },
}));

let mockActiveJam: { jamRoomId: string } | null = null;
jest.mock('../../contexts/JamContext', () => ({
  useJam: () => ({ activeJam: mockActiveJam }),
}));

import RealtimeConnectionGate from '../RealtimeConnectionGate';

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<RealtimeConnectionGate />); });
  return tree!;
}

function send(state: string) {
  act(() => { appStateListener?.(state); });
}

beforeEach(() => {
  mockConnect.mockClear();
  mockDisconnect.mockClear();
  mockActiveJam = null;
});

describe('RealtimeConnectionGate', () => {
  it('closes the socket on background and reopens it on return', () => {
    mount();

    send('background');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    send('active');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('ignores "inactive" — iOS reports it for the app switcher and call banners', () => {
    mount();
    send('inactive');
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('keeps the socket open in the background during a jam', () => {
    mockActiveJam = { jamRoomId: 'jam-1' };
    mount();

    send('background');
    expect(mockDisconnect).not.toHaveBeenCalled();

    // ...and having skipped the disconnect, it must not "reconnect" a socket it
    // never closed — that would fire connect() on a live jam socket.
    send('active');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('does not reconnect a socket it did not close', () => {
    mount();
    send('active');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('does not disconnect twice without an intervening foreground', () => {
    mount();
    send('background');
    send('background');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('picks up a jam that started after mount', () => {
    const tree = mount();
    mockActiveJam = { jamRoomId: 'jam-2' };
    act(() => { tree.update(<RealtimeConnectionGate />); });

    send('background');
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
