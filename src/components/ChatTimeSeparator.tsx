import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';

// Centred grey label that sits between message groups separated by a
// meaningful time gap (see utils/chatTime). Mirrors Instagram's DM
// timestamps — small, muted, no divider lines, gets a touch of vertical
// padding so adjacent bubbles breathe around it.
export default function ChatTimeSeparator({ label }: { label: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
