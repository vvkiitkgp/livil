/**
 * The player's Star button appears only when starring is the next step, and a failed
 * star says so rather than silently doing nothing.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockStatus = jest.fn();
let mockReady = true;
const mockAddStar = jest.fn();
const mockToast = jest.fn();
jest.mock('../../contexts/RelationshipContext', () => ({
  useRelationships: () => ({ status: mockStatus, addStar: mockAddStar, ready: mockReady }),
}));
jest.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockToast }),
}));
jest.mock('../Button', () => ({
  Button: (props: { label: string }) => {
    const { Text } = require('react-native');
    return <Text {...props}>{props.label}</Text>;
  },
}));

import { StarArtistButton } from '../StarArtistButton';

function render(authorId: string) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<StarArtistButton authorId={authorId} artistName="Arjun" />); });
  return tree;
}
const button = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => typeof n.props.label === 'string' && typeof n.props.onPress === 'function')[0];

beforeEach(() => { jest.clearAllMocks(); mockReady = true; });

it('shows nothing until relationships are loaded (everyone reads as a stranger before)', () => {
  mockReady = false;
  mockStatus.mockReturnValue('none');
  expect(render('u1').toJSON()).toBeNull();
});

it('never says "try again" when the artist turns out to be a friend', async () => {
  mockStatus.mockReturnValue('none');
  mockAddStar.mockRejectedValue(new Error('already_friends'));
  const tree = render('u1');
  await act(async () => { button(tree).props.onPress(); });
  expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/friends/), { kind: 'info' });
});

it.each(['me', 'friend', 'blocked', 'pending_outgoing', 'pending_incoming'])(
  'shows nothing for a %s', status => {
    mockStatus.mockReturnValue(status);
    expect(render('u1').toJSON()).toBeNull();
  },
);

it('shows nothing when there is no real person behind the song (a Jam item)', () => {
  mockStatus.mockReturnValue('none');
  expect(render('').toJSON()).toBeNull();
});

it('offers Star, and stars the artist when tapped', async () => {
  mockStatus.mockReturnValue('none');
  mockAddStar.mockResolvedValue(undefined);
  const tree = render('u1');
  expect(button(tree).props.label).toBe('Star');
  await act(async () => { button(tree).props.onPress(); });
  expect(mockAddStar).toHaveBeenCalledWith('u1');
  expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/Starred/), { kind: 'success' });
});

it('says so when starring fails', async () => {
  mockStatus.mockReturnValue('none');
  mockAddStar.mockRejectedValue(new Error('offline'));
  const tree = render('u1');
  await act(async () => { button(tree).props.onPress(); });
  expect(mockToast).toHaveBeenCalledWith("Couldn't star Arjun. Try again.", { kind: 'error' });
});

it('reads Starred once starred', () => {
  mockStatus.mockReturnValue('star');
  expect(button(render('u1')).props.label).toBe('Starred');
});
