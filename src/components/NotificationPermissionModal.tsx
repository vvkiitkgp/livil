import React from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';

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
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <View style={styles.iconCircle}>
              <Text style={styles.iconGlyph}>!</Text>
            </View>
          </View>

          <Text style={styles.title}>Stay in the loop</Text>
          <Text style={styles.subtitle}>
            Turn on notifications so you don't miss a beat.
          </Text>

          <View style={styles.bullets}>
            <BulletRow text="New friend requests and accepts" />
            <BulletRow text="Messages from friends and groups" />
            <BulletRow text="Jam invites and when friends start listening" />
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={onEnable}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.btnPrimaryText}>Enable notifications</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dismiss}
            onPress={onMaybeLater}
            disabled={busy}
          >
            <Text style={styles.dismissText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
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
    marginBottom: 18,
  },
  bullets: {
    gap: 10,
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.purple,
  },
  bulletText: {
    color: COLORS.white,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  btn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  btnPrimaryText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  dismiss: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 8,
  },
  dismissText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
});
