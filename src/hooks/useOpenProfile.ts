import { useCallback } from 'react';
import { StackActions, useNavigation, useRoute } from '@react-navigation/native';

/**
 * Opens a person's profile from a post card — including from INSIDE someone's profile.
 *
 * `navigate('UserProfile', …)` does not open a new screen when a UserProfile is already
 * showing: React Navigation 7 swaps the params of the screen on top instead, and that
 * screen keeps the state it loaded for the previous person (owner bug, 2026-11-08: a
 * repost's "↻ from @name" tag, tapped on someone's profile, glitched instead of opening the
 * creator; from the feed it worked). So this PUSHES, as the people lists and the player
 * already do — except for the profile already on screen, which would only stack a copy of
 * itself (the header of a post on @riya's profile is @riya).
 */
export function useOpenProfile() {
  const navigation = useNavigation();
  const route = useRoute();
  const shownUserId = route.name === 'UserProfile'
    ? (route.params as { userId?: string } | undefined)?.userId
    : undefined;
  return useCallback((userId: string) => {
    if (userId === shownUserId) { return; }
    navigation.dispatch(StackActions.push('UserProfile', { userId }));
  }, [navigation, shownUserId]);
}
