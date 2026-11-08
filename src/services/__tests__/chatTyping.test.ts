/**
 * The typing indicator's network side. Sending is fire-and-forget and keeps its order. The
 * listening half runs against the real realtime library, because the channel it rebuilds is
 * the one thing here a library detail can silently kill.
 */
const mockRpc = jest.fn();

jest.mock('../../../lib/supabase', () => {
  const { RealtimeClient } = jest.requireActual('@supabase/realtime-js');
  const realtime = new RealtimeClient('wss://example.supabase.co/realtime/v1', {
    params: { apikey: 'anon' },
    transport: class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      onclose: ((e: unknown) => void) | null = null;
      binaryType = 'arraybuffer';
      send() {}
      close() {
        this.readyState = 3;
        this.onclose?.({ code: 1000 });
      }
    },
  });
  return {
    supabase: {
      rpc: (...a: unknown[]) => mockRpc(...a),
      realtime,
      channel: (topic: string, params: unknown) => realtime.channel(topic, params),
      removeChannel: (channel: unknown) => realtime.removeChannel(channel),
    },
  };
});

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { __resetTypingForTest, listenForTyping, sendTyping } from '../chatTyping';

const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  __resetTypingForTest();
  mockRpc.mockReset();
});

describe('sendTyping', () => {
  it('asks the server, naming the chat', async () => {
    mockRpc.mockResolvedValue({ error: null });
    sendTyping('c1', true);
    await settle();
    expect(mockRpc).toHaveBeenCalledWith('send_typing', { p_conversation_id: 'c1', p_typing: true });
  });

  it('one call at a time, and only the newest waits: "stopped" can never land before "typing"', async () => {
    let finishFirst: (v: { error: null }) => void = () => {};
    mockRpc.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    mockRpc.mockResolvedValue({ error: null });

    sendTyping('c1', true);
    sendTyping('c1', true);
    sendTyping('c1', false);
    expect(mockRpc).toHaveBeenCalledTimes(1);

    finishFirst({ error: null });
    await settle();
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenLastCalledWith('send_typing', { p_conversation_id: 'c1', p_typing: false });
  });

  it('migration not applied: one try, then quiet, never an error', async () => {
    mockRpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'Could not find the function' } });
    sendTyping('c1', true);
    await settle();
    sendTyping('c1', true);
    await settle();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('no network: nothing escapes, and the next signal still goes', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));
    sendTyping('c1', true);
    await settle();
    mockRpc.mockResolvedValue({ error: null });
    sendTyping('c1', true);
    await settle();
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});

describe('listenForTyping (the real library)', () => {
  const topic = 'realtime:typing:me';
  const channelNow = (): RealtimeChannel | undefined =>
    supabase.realtime.getChannels().find(c => c.topic === topic);

  afterEach(() => {
    // In this order: disconnect() is what clears the channels' timers, and only for those listed.
    supabase.realtime.disconnect();
    supabase.realtime.channels = [];
  });

  it('joins my own topic as a private channel, listening for typing', async () => {
    listenForTyping('me', () => {});
    await settle();
    const channel = channelNow();
    expect(channel?.private).toBe(true);
    expect(channel?.state).toBe('joining');
    expect(channel?.bindings.broadcast?.[0]?.filter).toEqual({ event: 'typing' });
  });

  it('hands every typing broadcast to the listener, and ignores a malformed one', async () => {
    const events: unknown[] = [];
    listenForTyping('me', e => events.push(e));
    await settle();
    // What the library does with a broadcast from the socket. Not in its public types.
    const channel = channelNow() as unknown as { _trigger(type: string, payload: unknown): void };

    channel._trigger('broadcast', {
      type: 'broadcast',
      event: 'typing',
      payload: { conversation_id: 'c1', user_id: 'riya', typing: true, name: 'Riya' },
    });
    channel._trigger('broadcast', { type: 'broadcast', event: 'typing', payload: { nope: true } });

    expect(events).toEqual([
      { conversationId: 'c1', userId: 'riya', typing: true, name: 'Riya', avatarUrl: null },
    ]);
  });

  it('rebuilds on the SAME topic after the gate closes the socket, with a live channel', async () => {
    // The server addresses this exact topic, so this cannot do what other subscribers do and
    // move to a new one. What the gate does across an app switch on iPhone:
    const stop = listenForTyping('me', () => {});
    await settle();
    const dead = channelNow()!;
    supabase.realtime.disconnect();
    supabase.realtime.connect();
    expect(dead.state).toBe('closed');
    expect(Object.keys(dead.bindings)).toEqual([]);

    // ...then what useRealtimeEpoch makes ChatTypingListener do.
    stop();
    listenForTyping('me', () => {});
    await settle();

    const fresh = channelNow()!;
    expect(fresh).not.toBe(dead);
    expect(fresh.state).toBe('joining');
    expect(Object.keys(fresh.bindings)).toContain('broadcast');
    expect(supabase.realtime.getChannels().filter(c => c.topic === topic)).toHaveLength(1);
  });

  it('a new join waits for the old channel to finish leaving', async () => {
    const stop = listenForTyping('me', () => {});
    await settle();
    const old = channelNow()!;

    let finishLeaving: (status: 'ok') => void = () => {};
    const removeChannel = jest.spyOn(supabase, 'removeChannel')
      .mockReturnValueOnce(new Promise(resolve => { finishLeaving = resolve; }));
    stop();
    listenForTyping('me', () => {});
    await settle();
    expect(channelNow()).toBe(old);

    // The old channel's close drops whatever is listed under this topic. Had the new one
    // already joined, this is what would have silently killed it.
    finishLeaving('ok');
    await settle();
    const fresh = channelNow()!;
    expect(fresh).not.toBe(old);
    expect(fresh.state).toBe('joining');
    removeChannel.mockRestore();
    old.teardown(); // the mocked leave never stopped its timers
  });

  it('stopped before it joined: it never joins', async () => {
    const stop = listenForTyping('me', () => {});
    stop();
    await settle();
    expect(channelNow()).toBeUndefined();
  });

  it('stopping leaves the channel', async () => {
    const stop = listenForTyping('me', () => {});
    await settle();
    stop();
    await settle();
    expect(channelNow()).toBeUndefined();
  });
});
