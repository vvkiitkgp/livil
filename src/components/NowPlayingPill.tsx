import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { GradientBorder } from './GradientBorder';
import EqualizerBars from './EqualizerBars';
import { Icon } from './Icon';
import type { ListeningNow } from '../services/listeningStatus';

const PILL_RADIUS = 999;
const ART = 32;

/**
 * "Riya is listening to Kesariya — Listen". Shown under a DM's header only while the
 * other person is playing music in Livil; it disappears the moment they pause.
 *
 * Tapping plays the same post here (the caller's `onListen`). When the viewer is
 * already playing that exact post, the action reads "Playing" with live bars instead,
 * and a tap toggles it like a shared-track card does. With no post to open (it was
 * deleted since) the pill is informational only.
 */
export default function NowPlayingPill({
  listening,
  name,
  playingHere,
  onListen,
}: {
  listening: ListeningNow;
  /** The other person's display name, for the accessibility label. */
  name: string;
  /** The viewer is playing this same post right now. */
  playingHere: boolean;
  onListen: (postId: string) => void;
}) {
  const { postId, title, artistName, coverArtUrl } = listening;
  const canListen = postId !== null;

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={styles.wrap}>
      <Pressable
        disabled={!canListen}
        onPress={() => { if (postId) { onListen(postId); } }}
        accessibilityRole={canListen ? 'button' : 'text'}
        accessibilityLabel={
          `${name} is listening to ${title} by ${artistName}` +
          (canListen ? (playingHere ? '. Playing here too' : '. Listen') : '')
        }
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <GradientBorder borderRadius={PILL_RADIUS} />
        {coverArtUrl ? (
          <Image source={{ uri: coverArtUrl }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artFallback]}>
            <Icon name="musicNote" size={14} color={COLORS.purpleLight} />
          </View>
        )}
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <EqualizerBars height={10} barWidth={2} />
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          </View>
          <Text style={styles.artist} numberOfLines={1}>{artistName}</Text>
        </View>
        {canListen ? (
          <Text style={styles.action}>{playingHere ? 'Playing' : 'Listen'}</Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  // No overflow: 'hidden' — it would shave the GradientBorder's outer edge.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: PILL_RADIUS,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 16,
  },
  pressed: { opacity: 0.7 },
  art: { width: ART, height: ART, borderRadius: ART / 2 },
  // Decorative fallback — exempt from the no-fill rule.
  artFallback: {
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, color: COLORS.white, fontSize: 13, fontWeight: '600' },
  artist: { color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  // purpleNeon, never purple: #8B3DFF fails contrast on the dark background.
  action: { color: COLORS.purpleNeon, fontSize: 13, fontWeight: '700' },
});
