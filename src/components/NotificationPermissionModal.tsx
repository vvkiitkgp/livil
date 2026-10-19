import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';

type Props = {
  visible: boolean;
  busy: boolean;
  onEnable: () => void;
  onMaybeLater: () => void;
};

/**
 * Pre-prompt modal shown once per install before the OS notification
 * permission dialog. Explains the value first so users see context and
 * are more likely to grant — Android 13+ only shows the OS prompt once,
 * so a tossed-off "deny" is hard to recover from.
 */
export default function NotificationPermissionModal({
  visible,
  busy,
  onEnable,
  onMaybeLater,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onMaybeLater}
    >
      <View style={styles.backdrop}>
        {/* A tap outside the card is the "Maybe later" button, exactly. A sibling BEHIND the
            card, not its parent, so taps on the card never reach it. Hidden from screen
            readers: the button itself is the accessible way out. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onMaybeLater}
          disabled={busy}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <View style={styles.iconCircle}>
              <Text style={styles.iconGlyph}>!</Text>
            </View>
          </View>

          <Text style={styles.title}>Stay in the loop</Text>
          <Text style={styles.subtitle}>Get friend requests, messages, likes and comments.</Text>

          <Button
            label="Enable notifications"
            onPress={onEnable}
            variant="primary"
            size="md"
            busy={busy}
            fullWidth
          />

          <Button
            label="Maybe later"
            onPress={onMaybeLater}
            variant="ghost"
            size="md"
            disabled={busy}
            fullWidth
            style={styles.dismiss}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: 14,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    color: COLORS.purpleLight,
    fontSize: 28,
    fontWeight: '700',
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  dismiss: {
    marginTop: 10,
  },
});
