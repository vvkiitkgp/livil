import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS } from '../theme/colors';
import { avatarInitials, type AuthorDisplay } from '../utils/authorDisplay';

/** Small avatar circle used in collaborator rows. */
export default function CollabAvatar({
  uri,
  display,
  size = 36,
  pending = false,
}: {
  uri: string | null;
  display: AuthorDisplay;
  size?: number;
  /**
   * The named artist has not confirmed this credit yet.
   *
   * Marked rather than hidden, deliberately: hiding credits until they were answered would
   * leave most tracks looking uncredited, because most people do not answer quickly. The
   * amber ring is the same tone the credit chip uses on the upload screen and on the web.
   */
  pending?: boolean;
}) {
  return (
    <View
      style={[
        st.wrap,
        { width: size, height: size, borderRadius: size / 2 },
        pending && st.pending,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={st.img} />
      ) : (
        <Text style={[st.initials, { fontSize: size * 0.35 }]}>{avatarInitials(display)}</Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pending: { borderColor: COLORS.warningBorder, borderStyle: 'dashed' },
  img: { width: '100%', height: '100%' },
  initials: { color: COLORS.purpleLight, fontWeight: '700' },
});
