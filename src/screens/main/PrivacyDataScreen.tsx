import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { SettingsRow } from '../../components/SettingsRow';
import {
  SettingsSection,
  SETTINGS_PAGE_INSET,
} from '../../components/SettingsSection';
import { SettingsHeader } from '../../components/SettingsHeader';
import { FLOATING_PLAYER_HEIGHT } from '../../constants/layout';
import { useToast } from '../../contexts/ToastContext';
import {
  getCommentsFriendsOnly,
  getShowActivity,
  updateCommentsFriendsOnly,
  updateShowActivity,
} from '../../services/profileService';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '../../constants/links';
import { supabase } from '../../../lib/supabase';

export default function PrivacyDataScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(true);
  const [commentsFriendsOnly, setCommentsFriendsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id ?? null;
        if (!uid) {
          return;
        }
        // Set the id BEFORE the reads, and settle the reads independently.
        // Both matter: the toggles are gated on `userId`, so awaiting the reads
        // first meant one failing column left every switch permanently
        // disabled — and one shared Promise.all meant a failure in either read
        // discarded the other's value too.
        if (mounted.current) {
          setUserId(uid);
        }

        const [activity, friendsOnly] = await Promise.allSettled([
          getShowActivity(uid),
          getCommentsFriendsOnly(uid),
        ]);
        if (!mounted.current) {
          return;
        }
        // A failed read keeps the permissive default (visible / everyone) — it
        // must never present the user as opted out of something they did not
        // choose.
        if (activity.status === 'fulfilled') {
          setShowActivity(activity.value);
        }
        if (friendsOnly.status === 'fulfilled') {
          setCommentsFriendsOnly(friendsOnly.value);
        }
      } finally {
        if (mounted.current) {
          setLoading(false);
        }
      }
    })();
  }, []);

  /**
   * Optimistic write shared by both switches: move under the finger, roll back
   * and explain if the write loses.
   */
  const persistToggle = useCallback(
    async (
      next: boolean,
      apply: (value: boolean) => void,
      write: (uid: string, value: boolean) => Promise<void>,
      failureMessage: string,
    ) => {
      if (busy || !userId) {
        return;
      }
      setBusy(true);
      apply(next);
      try {
        await write(userId, next);
      } catch {
        if (mounted.current) {
          apply(!next);
          showToast(failureMessage, { kind: 'error' });
        }
      } finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    },
    [busy, showToast, userId],
  );

  const onToggleActivity = useCallback(
    (next: boolean) =>
      persistToggle(
        next,
        setShowActivity,
        updateShowActivity,
        'Could not update your activity status.',
      ),
    [persistToggle],
  );

  const onToggleCommentsAudience = useCallback(
    (next: boolean) =>
      persistToggle(
        next,
        setCommentsFriendsOnly,
        updateCommentsFriendsOnly,
        'Could not update who can comment.',
      ),
    [persistToggle],
  );

  const openPrivacyPolicy = useCallback(async () => {
    try {
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch {
      showToast('Could not open the privacy policy.', { kind: 'error' });
    }
  }, [showToast]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SettingsHeader title="Privacy & data" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: FLOATING_PLAYER_HEIGHT + insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Your data</Text>
          <Text style={styles.introBody}>
            You control what you share with other people on Livil, and you can
            delete your account and everything in it at any time.
          </Text>
        </View>

        <SettingsSection title="Visibility">
          <SettingsRow
            icon="broadcast"
            label="Activity status"
            subtitle="Let friends see when you were last active and what you're playing"
            toggle={{
              value: showActivity,
              onValueChange: onToggleActivity,
              disabled: busy || loading || !userId,
            }}
          />
        </SettingsSection>

        {/* Likes stay open to everyone by design and have no toggle — comments
            are the only audience control, and blocking is deliberately not a
            feature (reporting is the moderation path). */}
        <SettingsSection title="Comments">
          <SettingsRow
            icon="comment"
            label="Comments from friends only"
            subtitle="Off means anyone on Livil can comment on your posts"
            toggle={{
              value: commentsFriendsOnly,
              onValueChange: onToggleCommentsAudience,
              disabled: busy || loading || !userId,
            }}
          />
        </SettingsSection>

        <SettingsSection title="Data">
          <SettingsRow
            icon="document"
            label="Privacy policy"
            subtitle="How we collect and use your data"
            external
            onPress={openPrivacyPolicy}
          />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            icon="trash"
            label="Delete account"
            subtitle="Permanently delete your account and all your data"
            destructive
            onPress={() => navigation.navigate('DeleteAccount')}
          />
        </SettingsSection>

        <Text style={styles.footer}>
          For data protection enquiries, contact{'\n'}
          <Text style={styles.footerEmail}>{SUPPORT_EMAIL}</Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body: { paddingTop: 8 },
  intro: {
    paddingHorizontal: SETTINGS_PAGE_INSET + 4,
    marginBottom: 22,
    gap: 6,
  },
  introTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  introBody: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
  },
  footer: {
    color: COLORS.textMuted,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: SETTINGS_PAGE_INSET,
  },
  footerEmail: {
    color: COLORS.textSecondary,
  },
});
