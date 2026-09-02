import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { COLORS } from '../../theme/colors';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import FormInput from '../../components/FormInput';
import { SettingsHeader } from '../../components/SettingsHeader';
import { SETTINGS_PAGE_INSET } from '../../components/SettingsSection';
import { FLOATING_PLAYER_HEIGHT } from '../../constants/layout';
import { useToast } from '../../contexts/ToastContext';
import { APP_VERSION_LABEL } from '../../constants/appVersion';
import { sendTeamMessage } from '../../services/teamMessages';
import { MESSAGE_MAX } from '../../../shared/constants/teamMessages';

/**
 * Write to the Livil team, from the phone.
 *
 * REPLACES Settings → Contact support's `mailto:`, and that is the point — the same reason
 * the studio's Contact screen replaced it there (see the migration comment on
 * `team_messages`). Handing off to the OS mail client dropped everything on the way: who is
 * writing, what version they are on, whether they ever finished, or whether they gave up
 * when a compose window covered the app mid-thought. A row in Postgres costs nothing and is
 * readable in /studio/ops next to the messages artists send from the web.
 *
 * NO HISTORY, and no reply thread. The SELECT policy on `team_messages` is ops-only, so a
 * sender cannot read their own message back — deliberately: a "your messages" list would
 * need a policy that exists purely to serve it, and every unanswered message would then be
 * visible to its sender as silence. Replies happen by email, from the operator's own client.
 */

/**
 * Appended to what the writer types, and shown to them verbatim before they send — the
 * `mailto:` carried the version in its subject line and it is the single most useful thing
 * on a bug report. `Platform.Version` on Android is the API level, not the marketing
 * version, so it is labelled as one rather than passed off as "Android 15".
 */
const SIGNATURE =
  Platform.OS === 'ios'
    ? `${APP_VERSION_LABEL} · iOS ${Platform.Version}`
    : `${APP_VERSION_LABEL} · Android API ${Platform.Version}`;

const SUFFIX = `\n\n— Sent from ${SIGNATURE}`;

/** What the writer may type. The signature rides in the same column, so it comes out of the
 *  same budget — a full-length message plus a suffix would fail the database's CHECK. */
const BODY_MAX = MESSAGE_MAX - SUFFIX.length;

/**
 * A speed bump, not a rate limit. The studio's version of this screen is reachable by a
 * handful of artists; this one is reachable by everyone with the app, and the table has no
 * limit of its own. Refusing a second send inside this window costs a real person nothing —
 * but it is a courtesy check in a client, so it stops accidents and impatience, NOT abuse:
 * anyone willing to talk to PostgREST directly never sees it. A real limit belongs in the
 * database, and is worth adding the day this is actually abused rather than in advance.
 */
const COOLDOWN_MS = 30_000;

export default function ContactTeamScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const lastSentAt = useRef<number | null>(null);

  const trimmed = useMemo(() => body.trim(), [body]);
  const canSend = trimmed.length > 0 && !busy;

  const onSend = useCallback(async () => {
    if (!canSend) {
      return;
    }

    const since = lastSentAt.current === null ? Infinity : Date.now() - lastSentAt.current;
    if (since < COOLDOWN_MS) {
      showToast('Give it a moment before sending another.', { kind: 'info' });
      return;
    }

    setBusy(true);
    try {
      await sendTeamMessage(`${trimmed}${SUFFIX}`);
      lastSentAt.current = Date.now();
      setBody('');
      setSent(true);
    } catch (e) {
      // Surfaced, never swallowed — losing a message quietly is the exact fault this screen
      // was built to remove.
      showToast(e instanceof Error ? e.message : 'Could not send that. Try again.', {
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [canSend, showToast, trimmed]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SettingsHeader title="Message the team" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: FLOATING_PLAYER_HEIGHT + insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {sent ? (
            <View style={styles.doneBlock}>
              <Icon name="checkCircle" size={36} color={COLORS.purpleLight} />
              <Text style={styles.doneTitle}>Sent — thank you</Text>
              <Text style={[styles.introBody, styles.doneBody]}>
                It goes straight to the founder, not a queue. If it needs a reply you&apos;ll
                get one by email, at the address on your account.
              </Text>
              <Button
                label="Write another"
                variant="secondary"
                size="md"
                onPress={() => setSent(false)}
                style={styles.doneBtn}
              />
              <Button
                label="Done"
                variant="ghost"
                size="md"
                onPress={() => navigation.goBack()}
              />
            </View>
          ) : (
            <>
              <View style={styles.intro}>
                <Text style={styles.introTitle}>Tell us anything</Text>
                <Text style={styles.introBody}>
                  Bugs, things that feel wrong, features you wish existed, or what nearly
                  made you give up. Livil is built by one person and read by the same person.
                </Text>
              </View>

              <View style={styles.labelRow}>
                <Text style={styles.label}>Your message</Text>
                <Text style={styles.labelCount}>
                  {trimmed.length}/{BODY_MAX}
                </Text>
              </View>
              <FormInput
                value={body}
                onChangeText={setBody}
                placeholder="What's on your mind?"
                multiline
                maxLength={BODY_MAX}
                editable={!busy}
                accessibilityLabel="Your message to the Livil team"
                wrapperStyle={styles.inputWrapper}
                style={styles.input}
                textAlignVertical="top"
              />

              {/* Shown rather than attached silently: it is appended to what they wrote, so
                  they get to see it before it is sent on their behalf. */}
              <Text style={styles.signature}>Sent with {SIGNATURE}</Text>

              <Button
                label="Send"
                size="lg"
                fullWidth
                disabled={!canSend}
                busy={busy}
                onPress={onSend}
                style={styles.sendBtn}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  body: {
    paddingTop: 8,
    paddingHorizontal: SETTINGS_PAGE_INSET,
  },
  intro: {
    marginBottom: 22,
    gap: 6,
    paddingHorizontal: 4,
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  label: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  labelCount: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  inputWrapper: {
    alignItems: 'flex-start',
    minHeight: 180,
  },
  input: {
    minHeight: 164,
  },
  signature: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  sendBtn: {
    marginTop: 20,
  },
  doneBlock: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 28,
    paddingHorizontal: 4,
  },
  doneTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  doneBody: {
    textAlign: 'center',
  },
  doneBtn: {
    marginTop: 12,
  },
});
