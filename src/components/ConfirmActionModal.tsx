import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';

export type ConfirmTone = 'destructive' | 'primary';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  bullets?: string[];
  glyph?: string;
  tone?: ConfirmTone;
  confirmLabel: string;
  /** Pass null to hide the secondary button (one-button mode). */
  cancelLabel?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The app's standard confirmation modal. Use this for any "Are you sure?"
 * prompt instead of Alert.alert. Errors should use the toast (useToast)
 * instead — see CLAUDE.md.
 */
export default function ConfirmActionModal({
  visible,
  title,
  message,
  bullets,
  glyph,
  tone = 'destructive',
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  // Paint for the icon circle only — the buttons carry their own variant styling.
  const accent = tone === 'destructive'
    ? { ring: COLORS.errorBorder, bg: COLORS.errorBg, glyph: COLORS.error }
    : { ring: COLORS.purple, bg: COLORS.purpleDim, glyph: COLORS.purpleLight };

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
              <Text style={[styles.iconGlyph, { color: accent.glyph }]}>{glyph ?? '!'}</Text>
            </View>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{message}</Text>

          {bullets && bullets.length > 0 ? (
            <View style={styles.bullets}>
              {bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.spacer} />
          )}

          <Button
            label={confirmLabel}
            onPress={onConfirm}
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            size="md"
            busy={busy}
            fullWidth
          />

          {cancelLabel === null ? null : (
            <Button
              label={cancelLabel}
              onPress={onCancel}
              variant="ghost"
              size="md"
              disabled={busy}
              fullWidth
              style={styles.dismiss}
            />
          )}
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 26,
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
    paddingHorizontal: 4,
  },
  bullets: {
    gap: 10,
    marginTop: 18,
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  spacer: {
    height: 18,
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
  dismiss: {
    marginTop: 10,
  },
});
