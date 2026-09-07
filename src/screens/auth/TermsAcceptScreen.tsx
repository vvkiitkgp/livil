/**
 * Terms acceptance — scrollwrap.
 *
 * The Accept button stays disabled until the user has scrolled to the end. That is the
 * strongest consumer-facing consent pattern there is: nobody can claim they never saw
 * a term when the button was physically unreachable until the text had been passed.
 *
 * It matters here more than it would elsewhere, because these Terms do not merely set
 * rules — they take a LICENCE to the user's own music. A deliberate scroll and tap is
 * much better evidence of a deliberate grant than a line of small print beside a
 * button.
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
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Linking,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../theme/colors';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
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

/**
 * How close to the bottom counts as "read it".
 *
 * Not zero: momentum scrolling routinely stops a pixel or two short, and a button that
 * refuses to enable when the user is visibly at the end reads as broken. 24 is small
 * enough that nothing meaningful is still hidden.
 */
const BOTTOM_THRESHOLD = 24;

export default function TermsAcceptScreen({ userId, source, onAccepted }: Props) {
  const { showToast } = useToast();
  const [reachedEnd, setReachedEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  // Once reached, stays reached. Scrolling back up to re-read must not re-disable the
  // button — that would punish exactly the careful reader this screen is for.
  const reachedRef = useRef(false);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (reachedRef.current) { return; }
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceToEnd = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    if (distanceToEnd <= BOTTOM_THRESHOLD) {
      reachedRef.current = true;
      setReachedEnd(true);
    }
  }, []);

  /**
   * If the whole document fits without scrolling there is nothing to scroll TO, and
   * waiting for a scroll event that will never arrive would strand the user on a
   * permanently disabled button. Unlikely with terms this long, but a short future
   * revision or a very large display would hit it.
   */
  const handleContentSizeChange = useCallback((_w: number, h: number) => {
    if (reachedRef.current) { return; }
    if (h <= viewportRef.current + BOTTOM_THRESHOLD) {
      reachedRef.current = true;
      setReachedEnd(true);
    }
  }, []);

  const viewportRef = useRef(0);

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
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onLayout={e => { viewportRef.current = e.nativeEvent.layout.height; }}
        // 16ms would fire on every frame for a value we compare against a threshold;
        // 100ms is four times more often than a finger can reach the end.
        scrollEventThrottle={100}
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
        {!reachedEnd ? (
          <View style={styles.hintRow}>
            <Icon name="arrowDown" size={14} color={COLORS.textMuted} />
            <Text style={styles.hint}>Scroll to the end to continue</Text>
          </View>
        ) : null}

        <Button
          label={source === 'reaccept' ? 'Accept updated terms' : 'Accept and continue'}
          onPress={handleAccept}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!reachedEnd}
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
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
  },
  hint: { fontSize: 12, color: COLORS.textMuted },
  exit: {
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },
  exitLink: { color: COLORS.textSecondary, textDecorationLine: 'underline' },
});
