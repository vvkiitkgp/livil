import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SheetModal, { SheetScrollView } from './SheetModal';
import Icon, { type IconName } from './Icon';
import { COLORS } from '../theme/colors';
import { CHAT_MEDIA_LIFETIME_MS } from '../utils/chatMedia';

export type ChatMediaSource = 'camera' | 'gallery';

/**
 * "Camera" or "Choose from gallery" for a disappearing photo/video (PROP-0011). Titles only;
 * the one line under the title says what is special, the bubble's timer says the rest.
 *
 * `onDismiss` must reach the caller's useRunAfterDismiss: the camera and the gallery are
 * native screens, and on iOS they open into nothing if presented while this sheet is closing.
 */
export default function ChatMediaSourceSheet({
  visible,
  onClose,
  onDismiss,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onPick: (source: ChatMediaSource) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      fit
      style={styles.sheet}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>Send a photo or video</Text>
          <View style={styles.ruleRow}>
            <Icon name="timer" size={15} color={COLORS.purpleLight} />
            <Text style={styles.rule}>Disappears {CHAT_MEDIA_LIFETIME_MS / 60_000} minutes after you send it</Text>
          </View>
        </View>
      }
    >
      {/* In the sheet's scroll body, so a drag down anywhere on it closes the sheet. */}
      <SheetScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: 20 + insets.bottom }]}
      >
        <Row icon="camera" label="Camera" onPress={() => onPick('camera')} />
        <View style={styles.divider} />
        <Row icon="gallery" label="Choose from gallery" onPress={() => onPick('gallery')} />
      </SheetScrollView>
    </SheetModal>
  );
}

function Row({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={22} color={COLORS.purpleLight} weight="regular" />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: COLORS.surface },
  header: { paddingHorizontal: 20, paddingBottom: 6, gap: 6 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rule: { color: COLORS.purpleLight, fontSize: 13 },
  body: { flexShrink: 1 },
  bodyContent: { paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, paddingHorizontal: 4 },
  rowPressed: { opacity: 0.6 },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { color: COLORS.white, fontSize: 16, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginLeft: 62 },
});
