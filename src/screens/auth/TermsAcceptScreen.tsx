/**
 * Terms acceptance — clickwrap.
 *
 * The full text is on screen and Accept is enabled from the start. It used to stay
 * disabled until the reader had scrolled to the end (scrollwrap); the owner dropped
 * that on 2026-10-26 to keep sign-up easy while the app is young, and because the gate
 * was flaky on Android (a throttled onScroll could miss the frames that reached the
 * bottom, so the button stayed off until the user scrolled again). ADR-0018 already
 * ruled that the recorded acceptance row is the improvement and the scroll only a
 * preference until counsel says otherwise. If counsel asks for scrollwrap back, gate on
 * onScrollEndDrag / onMomentumScrollEnd as well as onScroll, not on onScroll alone.
 *
 * These Terms take a LICENCE to the user's own music, so the tap must stay deliberate:
 * a full-width button under the text, never a pre-ticked box or an auto-accept.
 *
 * There is no "Decline". Declining is closing the app or deleting the account, both of
 * which are always available; a decline button here would land the user in a state
 * with no screen to show them. The account-deletion route is named in the footer so
 * the exit is visible rather than implied.
 *
 * Content comes from termsContent.ts, which is GENERATED from docs/terms.html. The two
 * cannot drift, which is what makes the recorded acceptance meaningful — it attests to
 * a version whose exact text is hashed in the database.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../theme/colors';
import { Button } from '../../components/Button';
import { TERMS_SECTIONS, TERMS_VERSION, TERMS_EFFECTIVE } from '../../constants/termsContent';
import { TERMS_URL } from '../../constants/links';
import { recordTermsAcceptance, type AcceptanceSource } from '../../services/terms';
import { useToast } from '../../contexts/ToastContext';

type Props = {
  userId: string;
  /** 'signup' for a first acceptance, 'reaccept' when the terms have changed. */
  source: AcceptanceSource;
  /** Called once the acceptance row has actually landed. */
  onAccepted: () => void;
};

export default function TermsAcceptScreen({ userId, source, onAccepted }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleAccept = useCallback(async () => {
    setBusy(true);
    try {
      await recordTermsAcceptance(userId, source);
      onAccepted();
    } catch (e) {
      // Deliberately does NOT let the user through. No record means no evidence, which
      // is the entire state this screen exists to prevent.
      showToast(
        (e as Error)?.message || 'Could not save your acceptance. Please try again.',
        { kind: 'error' },
      );
      setBusy(false);
    }
  }, [userId, source, onAccepted, showToast]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.kicker}>
          {source === 'reaccept' ? 'UPDATED TERMS' : 'BEFORE YOU START'}
        </Text>
        <Text style={styles.title}>Terms of Service</Text>
        <Text style={styles.meta}>
          Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {TERMS_SECTIONS.map((section, i) => (
          <View key={i} style={styles.section}>
            {section.heading ? (
              <Text style={styles.heading}>{section.heading}</Text>
            ) : null}
            {section.paragraphs.map((para, j) => (
              <Text key={j} style={styles.body}>{para}</Text>
            ))}
          </View>
        ))}

        <Text style={styles.webLink} onPress={() => Linking.openURL(TERMS_URL)}>
          Read this on the web
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={source === 'reaccept' ? 'Accept updated terms' : 'Accept and continue'}
          onPress={handleAccept}
          variant="primary"
          size="lg"
          fullWidth
          busy={busy}
        />

        <Text style={styles.exit}>
          Not comfortable? You can delete your account at any time — see{' '}
          <Text
            style={styles.exitLink}
            onPress={() => Linking.openURL('https://livil-music.com/delete-account.html')}
          >
            livil-music.com/delete-account
          </Text>
          .
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  kicker: {
    fontSize: 11,
    letterSpacing: 2,
    color: COLORS.purpleLight,
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  meta: { fontSize: 12, color: COLORS.textMuted, marginTop: 6 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 28 },
  section: { marginBottom: 22 },
  heading: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  webLink: {
    fontSize: 13,
    color: COLORS.purpleLight,
    textDecorationLine: 'underline',
    marginTop: 4,
  },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  exit: {
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },
  exitLink: { color: COLORS.textSecondary, textDecorationLine: 'underline' },
});
