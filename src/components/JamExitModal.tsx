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
  isHost: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function JamExitModal({
  visible,
  isHost,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const title = isHost ? 'End Jam Room?' : 'Leave Jam Room?';
  const subtitle = isHost
    ? "Ending the session will disconnect everyone in the room. They won't be able to rejoin."
    : 'You can rejoin anytime while the jam is still active.';
  const confirmLabel = isHost ? 'End for everyone' : 'Leave room';
  const cancelLabel = isHost ? 'Keep jamming' : 'Stay in room';

  const accent = isHost
    ? { ring: COLORS.errorBorder, bg: COLORS.errorBg, glyph: COLORS.error, primary: COLORS.error }
    : { ring: COLORS.purple, bg: COLORS.purpleDim, glyph: COLORS.purpleLight, primary: COLORS.purple };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <View style={[styles.iconCircle, { backgroundColor: accent.bg, borderColor: accent.ring }]}>
              {isHost ? (
                <View style={[styles.stopSquare, { backgroundColor: accent.glyph }]} />
              ) : (
                <Text style={[styles.iconGlyph, { color: accent.glyph }]}>→</Text>
              )}
            </View>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.bullets}>
            {isHost ? (
              <>
                <BulletRow text="Playback stops for every listener" />
                <BulletRow text="The room is closed and can't be reopened" />
                <BulletRow text="A new jam can be started anytime" />
              </>
            ) : (
              <>
                <BulletRow text="You'll stop hearing what the host is playing" />
                <BulletRow text="The jam keeps going for everyone else" />
                <BulletRow text="Tap the jam banner to rejoin" />
              </>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnPrimary,
              { backgroundColor: accent.primary, shadowColor: accent.primary },
            ]}
            onPress={onConfirm}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dismiss}
            onPress={onCancel}
            disabled={busy}
          >
            <Text style={styles.dismissText}>{cancelLabel}</Text>
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 26,
    fontWeight: '700',
  },
  stopSquare: {
    width: 18,
    height: 18,
    borderRadius: 3,
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
    paddingHorizontal: 4,
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
