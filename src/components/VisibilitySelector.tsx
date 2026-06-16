import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import type { PlaylistVisibility } from '../services/playlists';

type Option = {
  value: PlaylistVisibility;
  label: string;
  icon: 'public' | 'friends' | 'lock';
  helper: string;
};

const OPTIONS: Option[] = [
  { value: 'public', label: 'Public', icon: 'public', helper: 'Anyone on Livil can see this playlist on your profile.' },
  { value: 'friends', label: 'Friends', icon: 'friends', helper: 'Only people you\'ve added as friends can see this playlist.' },
  { value: 'private', label: 'Private', icon: 'lock', helper: 'Only you can see this playlist.' },
];

export default function VisibilitySelector({
  value,
  onChange,
}: {
  value: PlaylistVisibility;
  onChange: (next: PlaylistVisibility) => void;
}) {
  const active = OPTIONS.find(o => o.value === value)!;
  return (
    <View>
      <View style={styles.row}>
        {OPTIONS.map(opt => {
          const selected = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.pill, selected && styles.pillActive]}
              onPress={() => onChange(opt.value)}
              activeOpacity={0.8}
            >
              <Icon name={opt.icon} size={14} color={selected ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.pillText, selected && styles.pillTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.helper}>{active.helper}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 6,
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  pillActive: {
    backgroundColor: COLORS.purple,
    borderColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pillText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  pillTextActive: { color: COLORS.white },
  helper: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
