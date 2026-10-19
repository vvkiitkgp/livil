import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useToast } from '../contexts/ToastContext';
import { fetchSharedProfile } from '../services/share';

/** Tap an @username in a caption → that person's profile. */
export function useOpenMention(): (username: string) => void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();
  return useCallback((username: string) => {
    void (async () => {
      try {
        const profile = await fetchSharedProfile(username);
        if (!profile) {
          showToast(`Couldn't find @${username}.`, { kind: 'info' });
          return;
        }
        navigation.navigate('UserProfile', { userId: profile.userId });
      } catch {
        showToast(`Couldn't open @${username}.`, { kind: 'error' });
      }
    })();
  }, [navigation, showToast]);
}
