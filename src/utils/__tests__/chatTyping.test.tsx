import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  applyTypingEvent,
  clearAllTyping,
  clearPersonTyping,
  parseTypingEvent,
  TYPING_IDLE_MS,
  TYPING_SEND_EVERY_MS,
  TYPING_SHOWN_FOR_MS,
  typingLabel,
  useChatTyping,
  useTypingSignal,
  type TypingEvent,
  type TypingPerson,
} from '../chatTyping';

const riya = { userId: 'riya', name: 'Riya', avatarUrl: null };
const sam = { userId: 'sam', name: 'Sam', avatarUrl: null };
const event = (person: TypingPerson, conversationId = 'c1', typing = true): TypingEvent =>
  ({ ...person, conversationId, typing });

/** What a screen showing this chat sees, and how often it redraws. */
function watch(conversationId = 'c1') {
  const seen: { people: readonly TypingPerson[]; renders: number } = { people: [], renders: 0 };
  function Probe() {
    seen.people = useChatTyping(conversationId);
    seen.renders += 1;
    return null;
  }
  act(() => { TestRenderer.create(<Probe />); });
  return seen;
}

const ids = (people: readonly TypingPerson[]) => people.map(p => p.userId);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  act(() => { clearAllTyping(); });
  jest.useRealTimers();
});

describe('the typing store', () => {
  it('shows someone from their signal until it runs out', () => {
    const seen = watch();
    expect(seen.people).toEqual([]);

    act(() => { applyTypingEvent(event(riya)); });
    expect(ids(seen.people)).toEqual(['riya']);

    act(() => { jest.advanceTimersByTime(TYPING_SHOWN_FOR_MS - 1); });
    expect(seen.people).toHaveLength(1);
    act(() => { jest.advanceTimersByTime(1); });
    expect(seen.people).toEqual([]);
  });

  it('each new signal pushes the expiry back', () => {
    const seen = watch();
    act(() => { applyTypingEvent(event(riya)); });
    act(() => { jest.advanceTimersByTime(TYPING_SHOWN_FOR_MS - 1000); });
    act(() => { applyTypingEvent(event(riya)); });
    act(() => { jest.advanceTimersByTime(TYPING_SHOWN_FOR_MS - 1000); });
    expect(seen.people).toHaveLength(1);
  });

  it('a stop signal clears at once', () => {
    const seen = watch();
    act(() => { applyTypingEvent(event(riya)); });
    act(() => { applyTypingEvent(event(riya, 'c1', false)); });
    expect(seen.people).toEqual([]);
  });

  it('their message arriving clears them straight away, and no timer is left behind', () => {
    const seen = watch();
    act(() => { applyTypingEvent(event(riya)); });
    act(() => { clearPersonTyping('c1', 'riya'); });
    expect(seen.people).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a repeat signal redraws nothing, and neither does another chat', () => {
    const seen = watch();
    expect(seen.renders).toBe(1);

    act(() => { applyTypingEvent(event(riya)); });
    expect(seen.renders).toBe(2);

    act(() => { applyTypingEvent(event(riya)); });
    act(() => { applyTypingEvent(event(sam, 'c2')); });
    act(() => { applyTypingEvent(event(sam, 'c2', false)); });
    expect(seen.renders).toBe(2);
  });

  it('holds several people in one chat, and clears one without the other', () => {
    const seen = watch();
    act(() => { applyTypingEvent(event(riya)); });
    act(() => { jest.advanceTimersByTime(2000); });
    act(() => { applyTypingEvent(event(sam)); });
    expect(ids(seen.people)).toEqual(['riya', 'sam']);

    act(() => { jest.advanceTimersByTime(TYPING_SHOWN_FOR_MS - 2000); });
    expect(ids(seen.people)).toEqual(['sam']);
  });

  it('clearAllTyping empties everything, and no old timer fires later', () => {
    const seen = watch();
    act(() => { applyTypingEvent(event(riya)); });
    act(() => { clearAllTyping(); });
    expect(seen.people).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('parseTypingEvent', () => {
  it('reads what send_typing sends', () => {
    expect(parseTypingEvent({
      conversation_id: 'c1',
      user_id: 'riya',
      typing: true,
      name: 'Riya',
      avatar_url: 'https://example.com/r.jpg',
      id: 'added-by-realtime',
    })).toEqual({
      conversationId: 'c1',
      userId: 'riya',
      typing: true,
      name: 'Riya',
      avatarUrl: 'https://example.com/r.jpg',
    });
  });

  it('a missing name or picture is fine; anything without a chat or a person is ignored', () => {
    expect(parseTypingEvent({ conversation_id: 'c1', user_id: 'riya', typing: false }))
      .toEqual({ conversationId: 'c1', userId: 'riya', typing: false, name: null, avatarUrl: null });
    expect(parseTypingEvent({ user_id: 'riya' })).toBeNull();
    expect(parseTypingEvent({ conversation_id: 'c1' })).toBeNull();
    expect(parseTypingEvent(null)).toBeNull();
  });
});

describe('typingLabel', () => {
  it('a one-to-one chat already says who', () => {
    expect(typingLabel([riya], false)).toBe('typing…');
  });

  it('a group names them, then counts them', () => {
    expect(typingLabel([riya], true)).toBe('Riya is typing…');
    expect(typingLabel([riya, sam], true)).toBe('Riya and Sam are typing…');
    expect(typingLabel([riya, sam, { ...sam, userId: 'cal' }], true)).toBe('3 people are typing…');
    expect(typingLabel([{ ...riya, name: null }], true)).toBe('Someone is typing…');
  });
});

describe('useTypingSignal', () => {
  let appStateChange: (state: string) => void = () => {};
  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateChange = handler as (state: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => { jest.restoreAllMocks(); });

  /** `canType`: the box has text and the chat is on screen. */
  function mount(canType = true) {
    const sent: boolean[] = [];
    const send = (typing: boolean) => { sent.push(typing); };
    let typed!: () => void;
    function Composer({ on }: { on: boolean }) {
      typed = useTypingSignal(on, send);
      return null;
    }
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Composer on={canType} />); });
    return {
      sent,
      key: () => act(() => { typed(); }),
      set: (on: boolean) => act(() => { tree.update(<Composer on={on} />); }),
      wait: (ms: number) => act(() => { jest.advanceTimersByTime(ms); }),
      unmount: () => act(() => { tree.unmount(); }),
    };
  }

  it('a draft sitting in the box says nothing until a key', () => {
    const { sent, wait } = mount();
    wait(TYPING_IDLE_MS * 3);
    expect(sent).toEqual([]);
  });

  it('the first key says typing at once', () => {
    const { sent, key } = mount();
    key();
    expect(sent).toEqual([true]);
  });

  it('keeps saying it while keys keep coming, never letting the dots blink off', () => {
    const { sent, key, wait } = mount();
    for (let i = 0; i < 20; i++) { key(); wait(1000); }
    expect(sent).not.toContain(false);
    expect(sent.length).toBeGreaterThanOrEqual(20000 / TYPING_SEND_EVERY_MS);
    // Each signal lands well inside the other phone's window.
    expect(TYPING_SEND_EVERY_MS * 2).toBeLessThan(TYPING_SHOWN_FOR_MS);
  });

  it('a pause says stop, even with text left in the box, and then goes quiet', () => {
    const { sent, key, wait } = mount();
    key();
    wait(TYPING_IDLE_MS - 1);
    expect(sent).not.toContain(false);
    wait(1);
    expect(sent[sent.length - 1]).toBe(false);
    const count = sent.length;
    wait(TYPING_IDLE_MS * 4);
    expect(sent).toHaveLength(count);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a key after the pause says typing again at once', () => {
    const { sent, key, wait } = mount();
    key();
    wait(TYPING_IDLE_MS);
    key();
    expect(sent[sent.length - 1]).toBe(true);
  });

  it('emptying the box (or sending) says stop once, and the signals end', () => {
    const { sent, key, set, wait } = mount();
    key();
    set(false);
    wait(TYPING_IDLE_MS * 3);
    expect(sent).toEqual([true, false]);
  });

  it('a key with the box empty (the last letter deleted) says nothing', () => {
    const { sent, key } = mount(false);
    key();
    expect(sent).toEqual([]);
  });

  it('leaving the chat says stop, and leaves no timer behind', () => {
    const { sent, key, unmount } = mount();
    key();
    unmount();
    expect(sent).toEqual([true, false]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('putting the app away says stop; coming back takes a new key', () => {
    const { sent, key, wait } = mount();
    key();
    act(() => { appStateChange('background'); });
    expect(sent).toEqual([true, false]);
    act(() => { appStateChange('active'); });
    wait(TYPING_IDLE_MS);
    expect(sent).toEqual([true, false]);
    key();
    expect(sent).toEqual([true, false, true]);
  });

  it('a glance at the app switcher or a banner does not count as away', () => {
    const { sent, key } = mount();
    key();
    act(() => { appStateChange('inactive'); });
    expect(sent).toEqual([true]);
  });
});
