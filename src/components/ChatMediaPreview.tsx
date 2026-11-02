import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from './Button';
import Icon from './Icon';
import { COLORS } from '../theme/colors';
import type { PickedChatMedia } from '../services/chatMedia';

/**
 * The step between picking (or taking) a photo and sending it (PROP-0011, design screen 6).
 * Close throws it away; Retake picks again from the same place; Send sends. No copy about
 * the 20 minutes — the bubble's running timer says it (owner, 2026-11-02).
 */
export default function ChatMediaPreview({
  media,
  recipientName,
  onClose,
  onRetake,
  onSend,
}: {
  media: PickedChatMedia | null;
  recipientName: string;
  onClose: () => void;
  onRetake: () => void;
  onSend: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={media !== null}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Discard"
            hitSlop={6}
            style={({ pressed }) => [styles.round, pressed && styles.pressed]}
          >
            <Icon name="close" size={20} color={COLORS.white} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{recipientName ? `To ${recipientName}` : ''}</Text>
          <Button label="Retake" variant="secondary" size="sm" onPress={onRetake} onMedia />
        </View>

        <View style={styles.stage}>
          {media ? (
            <Image
              source={{ uri: media.uri }}
              style={styles.photo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </View>

        <View style={styles.footer}>
          <Button label="Send" icon="send" variant="primary" size="lg" fullWidth onPress={onSend} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  title: { flex: 1, color: COLORS.white, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  stage: { flex: 1, justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
});
