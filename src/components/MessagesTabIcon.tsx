import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useUnreadBadgeCount } from '../contexts/UnreadBadgeContext';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';

/** The Messages tab's icon, with the unread total on its corner. */
export default function MessagesTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const count = useUnreadBadgeCount();
  return (
    <View>
      <Icon name="messages" size={26} color={color} weight={focused ? 'fill' : 'regular'} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    left: 16,
    backgroundColor: COLORS.purple,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: COLORS.bg,
  },
  badgeText: { color: COLORS.white, fontSize: 9, fontWeight: '800' },
});
