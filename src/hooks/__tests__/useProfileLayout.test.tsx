/**
 * The profile's list ↔ grid choice: list until chosen (what the tabs always showed), then
 * remembered on the phone — and a storage failure never becomes an error on the screen.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfileLayout, type ProfileLayout } from '../useProfileLayout';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let current: [ProfileLayout, (next: ProfileLayout) => void];
function Probe() {
  current = useProfileLayout();
  return null;
}

async function mount() {
  await act(async () => { TestRenderer.create(<Probe />); });
}

beforeEach(async () => { await AsyncStorage.clear(); });

it('starts as the list', async () => {
  await mount();
  expect(current[0]).toBe('list');
});

it('remembers the grid once chosen', async () => {
  await mount();
  await act(async () => { current[1]('grid'); });
  expect(current[0]).toBe('grid');

  await mount(); // a later visit
  expect(current[0]).toBe('grid');
});

it('ignores a stored value it does not know', async () => {
  await AsyncStorage.setItem('livil.profile.layout.v1', 'mosaic');
  await mount();
  expect(current[0]).toBe('list');
});
