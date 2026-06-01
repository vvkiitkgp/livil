import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useJam } from '../contexts/JamContext';
import { COLORS } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function JamBanner() {
  const { activeJam } = useJam();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();

  if (!activeJam) { return null; }

  return (
    <View style={[styles.banner, { top: insets.top + 8 }]}>
      <Text style={styles.label} numberOfLines={1}>
        🎵  {activeJam.conversationTitle}
      </Text>
      <TouchableOpacity
        style={styles.returnBtn}
        activeOpacity={0.8}
        onPress={() =>
          navigation.navigate('JamRoom', {
            jamRoomId: activeJam.jamRoomId,
            conversationId: activeJam.conversationId,
          })
        }
      >
        <Text style={styles.returnText}>Return</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 38,
    backgroundColor: COLORS.purple,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
    // Lift it above everything
    zIndex: 9999,
    elevation: 20,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },
  label: {
    flex: 1,
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  returnBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  returnText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
});
