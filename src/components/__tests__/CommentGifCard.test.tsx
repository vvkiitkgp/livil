/**
 * The GIF in a comment. Its box is reserved at the GIF's own aspect ratio before the lookup
 * answers (so the comment never jumps), the media URL is the one the lookup returned, and a
 * GIF that is gone or refused keeps its box and says so.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Image, Text, View } from 'react-native';

const mockGifState = { current: { status: 'loading', gif: null } as { status: string; gif: unknown } };
jest.mock('../../services/gifs', () => ({ useGif: () => mockGifState.current }));

import CommentGifCard, { gifBox } from '../CommentGifCard';

const gif = { provider: 'giphy' as const, id: '3o7TKSjRrfIPjeiVyM', width: 200, height: 150 };
const ready = {
  status: 'ready',
  gif: {
    ...gif,
    title: 'Happy Dance',
    url: 'https://media2.giphy.com/media/3o7TKSjRrfIPjeiVyM/200w.gif?cid=1&ct=g',
    previewUrl: 'https://media2.giphy.com/media/3o7TKSjRrfIPjeiVyM/200w_d.gif?cid=1',
  },
};

function render(): TestRenderer.ReactTestRenderer {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(<CommentGifCard gif={gif} />); });
  return r;
}

function boxStyle(r: TestRenderer.ReactTestRenderer) {
  const box = r.root.findAll(n => n.type === View && n.props.testID === 'comment-gif')[0];
  return Object.assign({}, ...[box.props.style].flat(2));
}

describe('gifBox', () => {
  it('keeps the aspect ratio at 180 wide', () => {
    expect(gifBox(200, 150)).toEqual({ width: 180, height: 135 });
    expect(gifBox(200, 200)).toEqual({ width: 180, height: 180 });
  });

  it('a tall GIF is capped at 220 high and narrowed to match', () => {
    expect(gifBox(200, 400)).toEqual({ width: 110, height: 220 });
  });

  it('a very wide or very tall GIF never collapses to a sliver', () => {
    expect(gifBox(2000, 100).height).toBe(48);
    expect(gifBox(100, 4000).width).toBe(48);
  });

  it('a nonsense size still gets a sensible box', () => {
    expect(gifBox(0, 0)).toEqual({ width: 180, height: 135 });
    expect(gifBox(NaN, 10)).toEqual({ width: 180, height: 135 });
  });
});

describe('CommentGifCard', () => {
  it('reserves the box while the lookup is in flight, with nothing drawn in it', () => {
    mockGifState.current = { status: 'loading', gif: null };
    const r = render();
    expect(boxStyle(r)).toMatchObject({ width: 180, height: 135 });
    expect(r.root.findAllByType(Image)).toHaveLength(0);
  });

  it('draws the URL the lookup returned, untouched', () => {
    mockGifState.current = ready;
    const r = render();
    const image = r.root.findByType(Image);
    expect(image.props.source).toEqual({ uri: ready.gif.url });
    expect(boxStyle(r)).toMatchObject({ width: 180, height: 135 });
    const box = r.root.findAll(n => n.type === View && n.props.testID === 'comment-gif')[0];
    expect(box.props.accessibilityLabel).toBe('GIF: Happy Dance');
  });

  it('a GIF that is gone or refused keeps its box and says so', () => {
    mockGifState.current = { status: 'unavailable', gif: null };
    const r = render();
    expect(r.root.findAllByType(Image)).toHaveLength(0);
    expect(r.root.findByType(Text).props.children).toBe('GIF unavailable');
    expect(boxStyle(r)).toMatchObject({ width: 180, height: 135 });
  });

  it('a lookup that could not be made keeps the box empty — the GIF is not gone', () => {
    mockGifState.current = { status: 'failed', gif: null };
    const r = render();
    expect(r.root.findAllByType(Image)).toHaveLength(0);
    expect(r.root.findAllByType(Text)).toHaveLength(0);
    expect(boxStyle(r)).toMatchObject({ width: 180, height: 135 });
  });

  it('a GIF that fails to load says so too', () => {
    mockGifState.current = ready;
    const r = render();
    act(() => { r.root.findByType(Image).props.onError(); });
    expect(r.root.findAllByType(Image)).toHaveLength(0);
    expect(r.root.findByType(Text).props.children).toBe('GIF unavailable');
  });
});
