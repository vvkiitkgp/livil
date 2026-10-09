import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableWithoutFeedback, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { artistLine, type SpotifyTrack } from '../services/spotify';
import { Button } from './Button';
import { Icon } from './Icon';
import { SpotifyLogo } from './SpotifyLogo';

/**
 * What tapping a Spotify search result offers (ADR-0027): play it in Spotify, or repost it
 * to Livil. A sheet rather than an immediate action because a Spotify row does something
 * different from every other search row — it leaves the app — and that should be a choice,
 * not a surprise.
 */
export default function SpotifyTrackSheet({
  track,
  canRepost,
  onPlay,
  onRepost,
  onClose,
  onDismiss,
}: {
  track: SpotifyTrack | null;
  /** The server switch. Off → the sheet only offers "Play on Spotify". */
  canRepost: boolean;
  onPlay: (track: SpotifyTrack) => void;
  onRepost: (track: SpotifyTrack) => void;
  onClose: () => void;
  /** iOS only (RN's Modal): the sheet has finished sliding away. See useRunAfterDismiss. */
  onDismiss?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={track !== null}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Close">
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.sheetWrap} pointerEvents="box-none">
        {track ? (
          <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <View style={styles.grabber} />
            <View style={styles.trackRow}>
              {track.imageUrl ? (
                <Image source={{ uri: track.imageUrl }} style={styles.art} />
              ) : (
                <View style={[styles.art, styles.artEmpty]}>
                  <Icon name="musicNote" size={22} color={COLORS.textMuted} />
                </View>
              )}
              <View style={styles.trackText}>
                <Text style={styles.title} numberOfLines={2}>{track.title}</Text>
                <Text style={styles.artist} numberOfLines={1}>{artistLine(track)}</Text>
                <SpotifyLogo size="xs" withName style={styles.logo} />
              </View>
            </View>
            <Button
              label="Play on Spotify"
              variant="secondary"
              size="lg"
              fullWidth
              leading={<SpotifyLogo size="sm" />}
              onPress={() => onPlay(track)}
              haptic="none"
            />
            {canRepost ? (
              <Button
                label="Repost to Livil"
                icon="repost"
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => onRepost(track)}
              />
            ) : null}
            <Text style={styles.note}>
              Spotify songs play in the Spotify app. Livil pauses what you're listening to first.
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 4 },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  // Spotify artwork: small corner radius, nothing on top.
  art: { width: 64, height: 64, borderRadius: 4, backgroundColor: COLORS.card },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  trackText: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  artist: { color: COLORS.textSecondary, fontSize: 14 },
  logo: { marginTop: 2 },
  note: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
