/**
 * CollabAvatar is the only render path in LIV-72 that can be unit-tested, and the
 * defect it exists to prevent is visual: slicing an initial out of the '[deleted]'
 * placeholder puts a '[' in an avatar circle.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, Image } from 'react-native';
import CollabAvatar from '../CollabAvatar';
import { resolveAuthorById, resolveAuthorDisplay } from '../../utils/authorDisplay';

function render(props: React.ComponentProps<typeof CollabAvatar>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<CollabAvatar {...props} />);
  });
  return tree;
}

function initialsOf(props: React.ComponentProps<typeof CollabAvatar>): string | null {
  const texts = render(props).root.findAllByType(Text);
  return texts.length === 0 ? null : (texts[0]!.props.children as string);
}

describe('CollabAvatar', () => {
  it('renders the image and no initials when an avatar url is present', () => {
    const tree = render({
      uri: 'https://cdn/a.png',
      display: resolveAuthorDisplay({ displayName: 'Vamsi' }),
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
  });

  it('renders initials from the display name when there is no avatar', () => {
    expect(initialsOf({ uri: null, display: resolveAuthorDisplay({ displayName: 'Vamsi Bosara' }) }))
      .toBe('VB');
  });

  it('renders ? for a deleted collaborator, not a slice of [deleted]', () => {
    const rendered = initialsOf({
      uri: null,
      display: resolveAuthorDisplay({ displayName: null, username: null }),
    });
    expect(rendered).toBe('?');
    expect(rendered).not.toBe('[D');
  });

  it('renders ? for a live collaborator whose profile join missed', () => {
    expect(initialsOf({ uri: null, display: resolveAuthorById('u1', {}) })).toBe('?');
  });

  it('still shows a custom-name credit as its own initials', () => {
    expect(initialsOf({ uri: null, display: resolveAuthorDisplay({ displayName: 'DJ Snake' }) }))
      .toBe('DS');
  });

  it('scales the initials with the requested size', () => {
    const texts = render({
      uri: null,
      display: resolveAuthorDisplay({ displayName: 'Vamsi' }),
      size: 52,
    }).root.findAllByType(Text);
    expect(texts[0]!.props.style).toContainEqual({ fontSize: 52 * 0.35 });
  });
});
