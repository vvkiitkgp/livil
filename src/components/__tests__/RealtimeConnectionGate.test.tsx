/**
 * On iOS the gate closes the realtime socket in the background to stop it polling
 * through a whole background listening session. The risk it carries is the
 * mirror image: a socket that closes and never reopens looks like "chat just
 * stopped working", silently and only after the user has switched apps once.
 *
 * So these pin both directions, plus the jam exemption — dropping the socket
 * mid-jam would desync every participant.
 *
 * On Android it must never close it: `disconnect()` destroys every channel's
 * listeners (pinned against the real library at the bottom), and Android reports
 * 'background' on every pause — a notification tap, the share sheet, a permission
 * dialog. These tests mock the client, which is how that went unnoticed.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';

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
import { getRealtimeEpoch } from '../../utils/realtimeEpoch';

function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<RealtimeConnectionGate />); });
  return tree!;
}

function send(state: string) {
  act(() => { appStateListener?.(state); });
}

const realOS = Platform.OS;

beforeEach(() => {
  mockConnect.mockClear();
  mockDisconnect.mockClear();
  mockActiveJam = null;
  Platform.OS = 'ios';
});

afterAll(() => {
  Platform.OS = realOS;
});

describe('RealtimeConnectionGate', () => {
  it('closes the socket on background and reopens it on return', () => {
    mount();

    send('background');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    send('active');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('tells subscribers to rebuild once it has reopened the socket', () => {
    mount();
    const before = getRealtimeEpoch();

    send('background');
    expect(getRealtimeEpoch()).toBe(before); // nothing to rebuild onto yet

    send('active');
    expect(getRealtimeEpoch()).toBe(before + 1);
  });

  it('does not make anything rebuild when it never closed the socket', () => {
    mockActiveJam = { jamRoomId: 'jam-1' };
    mount();
    const before = getRealtimeEpoch();

    send('background');
    send('active');
    expect(getRealtimeEpoch()).toBe(before);
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

describe('RealtimeConnectionGate on Android', () => {
  beforeEach(() => { Platform.OS = 'android'; });

  it('never closes the socket — a pause would kill every live subscription', () => {
    mount();
    send('background'); // e.g. the notification-tap trampoline, the share sheet
    send('active');
    send('background');
    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('never makes anything rebuild, since nothing was torn down', () => {
    mount();
    const before = getRealtimeEpoch();
    send('background');
    send('active');
    expect(getRealtimeEpoch()).toBe(before);
  });
});

describe('realtime-js disconnect() (the real library, why Android must not call it)', () => {
  // jest.mock above replaces lib/supabase, not the library itself.
  const { RealtimeClient } = jest.requireActual('@supabase/realtime-js');

  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    binaryType = 'arraybuffer';
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }

  it('wipes every channel listener, so connect() alone brings back nothing', () => {
    const client = new RealtimeClient('wss://example.supabase.co/realtime/v1', {
      params: { apikey: 'anon' },
      transport: FakeSocket,
    });
    const channel = client
      .channel('home:unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {});
    channel.subscribe();
    expect(Object.keys(channel.bindings)).toContain('postgres_changes');

    client.disconnect();

    // If this starts failing, the library stopped tearing channels down on
    // disconnect() and RealtimeConnectionGate's Android exemption can be revisited.
    expect(channel.state).toBe('closed');
    expect(channel.bindings).toEqual({});
  });

  it('a subscriber rebuilding needs a NEW topic: the same one hands back the dead channel', () => {
    const client = new RealtimeClient('wss://example.supabase.co/realtime/v1', {
      params: { apikey: 'anon' },
      transport: FakeSocket,
    });
    const dead = client
      .channel('inbox:me:0')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {});
    dead.subscribe();

    // What the gate does across an app switch...
    client.disconnect();
    client.connect();
    expect(dead.state).toBe('closed');

    // ...then what useRealtimeEpoch makes the subscriber's effect do. Teardown wiped the hook
    // that would have dropped this channel from the client, so it stays listed.
    void client.removeChannel(dead);
    expect(client.channel('inbox:me:0')).toBe(dead);

    const fresh = client
      .channel('inbox:me:1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {});
    fresh.subscribe();

    expect(fresh).not.toBe(dead);
    expect(fresh.state).toBe('joining');
    expect(Object.keys(fresh.bindings)).toContain('postgres_changes');
    client.disconnect(); // stop the library's reconnect timers
  });

  it('keeps them through an unplanned drop, which it rejoins by itself', () => {
    const client = new RealtimeClient('wss://example.supabase.co/realtime/v1', {
      params: { apikey: 'anon' },
      transport: FakeSocket,
    });
    const channel = client
      .channel('home:unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {});
    channel.subscribe();

    // What Android now relies on: the socket dying under us (radio off, server
    // timeout) leaves the channel errored-with-listeners, queued to rejoin.
    client.conn.close();

    expect(channel.state).toBe('errored');
    expect(Object.keys(channel.bindings)).toContain('postgres_changes');
    client.disconnect(); // stop the library's reconnect timers
  });
});

