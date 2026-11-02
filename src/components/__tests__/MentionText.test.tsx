/**
 * A feed caption: 4 lines, then "… See more" — only when it really is longer — and a tap
 * opens the rest in place. Tags stay tappable collapsed and open. The phone's own text layout
 * is played here by firing `onTextLayout` on the invisible measuring copy.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';
import { __resetCaptionExpansionForTest } from '../../utils/captionFit';

const mockOpenMention = jest.fn();
jest.mock('../../hooks/useOpenMention', () => ({ useOpenMention: () => mockOpenMention }));

import MentionText from '../MentionText';

/** Every character 7pt, `COLS` characters to a line, breaking at "\n" or the last space. */
const COLS = 30;
function lines(text: string) {
  const out: { text: string; width: number }[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    const hardEnd = nl === -1 ? text.length : nl;
    if (hardEnd - start <= COLS) {
      const end = nl === -1 ? text.length : nl + 1;
      out.push({ text: text.slice(start, end), width: (hardEnd - start) * 7 });
      start = end;
      continue;
    }
    const space = text.lastIndexOf(' ', start + COLS);
    const end = space > start ? space + 1 : start + COLS;
    out.push({ text: text.slice(start, end), width: text.slice(start, end).trimEnd().length * 7 });
    start = end;
  }
  return out;
}

/** The plain string a Text draws: its children flattened. */
function shown(node: ReactTestInstance): string {
  return node.children
    .map(c => (typeof c === 'string' ? c : shown(c)))
    .join('');
}

const byId = (r: TestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.type === Text && n.props.testID === id);

/** Play the phone: lay out whatever the measuring copy holds until it stops asking. */
function settleLayout(r: TestRenderer.ReactTestRenderer) {
  for (let i = 0; i < 10; i++) {
    const [measure] = byId(r, 'caption-measure');
    if (!measure) { return; }
    const text = shown(measure);
    act(() => { measure.props.onTextLayout({ nativeEvent: { lines: lines(text) } }); });
  }
  throw new Error('measuring never settled');
}

function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(el); });
  const [caption] = byId(r, 'caption');
  act(() => { caption?.props.onLayout?.({ nativeEvent: { layout: { width: COLS * 7, height: 80, x: 0, y: 0 } } }); });
  return r;
}

const LONG =
  'Recorded this at 3am after @riya_s sent me the chords. ' +
  'Second verse is about the drive home, third one about nothing at all. ' +
  'Headphones on for the bass. Thank you @sam for the mix and everyone who came to the show. '.repeat(3);

beforeEach(() => {
  __resetCaptionExpansionForTest();
  mockOpenMention.mockClear();
});

it('a caption that fits shows as it is: no "See more", no tap', () => {
  const r = render(<MentionText text="for @riya_s" numberOfLines={4} expandId="p1" />);
  settleLayout(r);
  const [caption] = byId(r, 'caption');
  expect(shown(caption!)).toBe('for @riya_s');
  expect(caption!.props.onPress).toBeUndefined();
  expect(byId(r, 'caption-measure')).toHaveLength(0);
});

it('a long caption ends its 4th line with "… See more", and a tap opens all of it', () => {
  const r = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  settleLayout(r);
  let [caption] = byId(r, 'caption');
  const collapsed = shown(caption!);
  expect(collapsed.endsWith('… See more')).toBe(true);
  expect(lines(collapsed)).toHaveLength(4);
  expect(caption!.props.numberOfLines).toBe(4);

  act(() => { caption!.props.onPress(); });
  [caption] = byId(r, 'caption');
  expect(shown(caption!)).toBe(LONG);
  expect(caption!.props.numberOfLines).toBeUndefined();
  expect(caption!.props.onPress).toBeUndefined();
});

it('before the measuring settles, the caption is the plain 4-line text and already tappable', () => {
  const r = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  const [caption] = byId(r, 'caption');
  expect(shown(caption!)).toBe(LONG);
  expect(caption!.props.numberOfLines).toBe(4);
  expect(typeof caption!.props.onPress).toBe('function');
});

it('tags open their profile when collapsed and when open', () => {
  const r = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  settleLayout(r);
  const tag = () => r.root.findAll(n => n.type === Text && shown(n) === '@riya_s' && !!n.props.onPress)[0]!;
  act(() => { tag().props.onPress(); });
  expect(mockOpenMention).toHaveBeenLastCalledWith('riya_s');

  act(() => { byId(r, 'caption')[0]!.props.onPress(); });
  act(() => { tag().props.onPress(); });
  expect(mockOpenMention).toHaveBeenCalledTimes(2);
  // @sam is past the 4th line: only reachable once open.
  const sam = r.root.findAll(n => n.type === Text && shown(n) === '@sam' && !!n.props.onPress);
  expect(sam.length).toBeGreaterThan(0);
});

it('the invisible measuring copy never takes a tap', () => {
  const r = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  const [measure] = byId(r, 'caption-measure');
  const pressable = [measure!, ...measure!.findAll(n => n.type === Text)].filter(n => n.props.onPress);
  expect(pressable).toHaveLength(0);
});

it('an opened caption comes back open when the list remounts the card', () => {
  const first = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  settleLayout(first);
  act(() => { byId(first, 'caption')[0]!.props.onPress(); });
  act(() => { first.unmount(); });

  const again = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  expect(shown(byId(again, 'caption')[0]!)).toBe(LONG);
  expect(byId(again, 'caption-measure')).toHaveLength(0);

  // A different post is not affected.
  const other = render(<MentionText text={LONG} numberOfLines={4} expandId="p2" />);
  expect(byId(other, 'caption')[0]!.props.numberOfLines).toBe(4);
});

it('a late layout from an earlier pass is ignored', () => {
  const r = render(<MentionText text={LONG} numberOfLines={4} expandId="p1" />);
  const [measure] = byId(r, 'caption-measure');
  const stale = measure!.props.onTextLayout;
  act(() => { stale({ nativeEvent: { lines: lines(LONG) } }); }); // → checking a cut
  const before = shown(byId(r, 'caption-measure')[0]!);
  act(() => { stale({ nativeEvent: { lines: lines('x') } }); }); // the full-text pass again
  expect(shown(byId(r, 'caption-measure')[0]!)).toBe(before);
});

it('without numberOfLines (the post page) the whole caption shows, nothing measured', () => {
  const r = render(<MentionText text={LONG} expandId="p1" />);
  const [caption] = byId(r, 'caption');
  expect(shown(caption!)).toBe(LONG);
  expect(caption!.props.numberOfLines).toBeUndefined();
  expect(caption!.props.onPress).toBeUndefined();
  expect(byId(r, 'caption-measure')).toHaveLength(0);
});
