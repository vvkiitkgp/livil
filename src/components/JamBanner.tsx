import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useJam } from '../contexts/JamContext';
import { COLORS } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function JamBanner() {
  const { activeJam } = useJam();
  const navigation = useNavigation<Nav>();

  if (!activeJam) { return null; }

  return (
    <View style={styles.banner}>
      <Text style={styles.label} numberOfLines={1}>
        🎵  Jam Room · {activeJam.conversationTitle}
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
    height: 44,
    backgroundColor: COLORS.purple,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  label: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  returnBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  returnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
  },
});
