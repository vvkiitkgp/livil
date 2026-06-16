import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { Icon, type IconName } from './Icon';

/**
 * Single-purpose action sheet for the album/playlist DetailView overflow.
 * Today we expose just "Edit"; future-additions (Share, Delete) plug into the
 * same `actions` array. Owner-gating happens at the parent — non-owners don't
 * see the overflow button at all, so this sheet is never opened for them.
 */
export type DetailAction = {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
};

export default function DetailActionSheet({
  visible,
  onClose,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  actions: DetailAction[];
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
              <View style={styles.handle} />
              {actions.map(a => (
                <TouchableOpacity
                  key={a.key}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => {
                    onClose();
                    // Defer to next tick so the modal animation begins before
                    // the parent navigates — avoids a visual stutter where the
                    // edit screen mounts behind a fading-out sheet.
                    setTimeout(() => a.onPress(), 0);
                  }}
                >
                  <View style={styles.iconBox}>
                    <Icon name={a.icon} size={18} color={a.destructive ? COLORS.error : COLORS.white} />
                  </View>
                  <Text style={[styles.label, a.destructive && styles.labelDestructive]}>
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  iconBox: { width: 24, alignItems: 'center' },
  label: { color: COLORS.white, fontSize: 15, fontWeight: '500' },
  labelDestructive: { color: COLORS.error },
});
