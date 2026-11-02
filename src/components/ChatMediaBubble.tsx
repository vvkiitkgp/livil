import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../theme/colors';
import { chatMediaLeftMs, formatDuration, formatLeft, type ChatMedia } from '../utils/chatMedia';
import { serverNow } from '../utils/serverClock';
import type { ChatMediaSaver } from '../services/chatMedia';

/**
 * Time left on a disappearing photo/video (PROP-0011), re-read every second until it reaches 0 —
 * then the interval stops, so an expired bubble costs nothing. `createdAt` null → null (not
 * a media message), so this can be called unconditionally.
 */
export function useChatMediaLeft(createdAt: string | null): number | null {
  const [left, setLeft] = useState(() => (createdAt ? chatMediaLeftMs(createdAt, serverNow()) : null));
  useEffect(() => {
    if (!createdAt) { setLeft(null); return; }
    const read = () => chatMediaLeftMs(createdAt, serverNow());
    setLeft(read());
    if (read() <= 0) { return; }
    const id = setInterval(() => {
      const next = read();
      setLeft(next);
      if (next <= 0) { clearInterval(id); }
    }, 1000);
    return () => clearInterval(id);
  }, [createdAt]);
  return left;
}

/**
 * The inside of a photo/video bubble: a round icon, "Photo" / "Video · 0:08", and under it
 * the running timer — or "Expired". The bubble around it (fill, outline, long-press) is the
 * chat's own; see ConversationScreen's bubbleMedia* styles. No explanatory copy: the timer
 * teaches the rule (owner, 2026-11-02).
 */
export function ChatMediaBubbleContent({
  media,
  isMe,
  leftMs,
  loading = false,
}: {
  media: ChatMedia;
  isMe: boolean;
  leftMs: number;
  /** Tapped while still downloading: a spinner where the icon is, until it opens. */
  loading?: boolean;
}) {
  const expired = leftMs <= 0;
  const title = media.type === 'video'
    ? `Video${media.durationMs ? ` · ${formatDuration(media.durationMs)}` : ''}`
    : 'Photo';
  const subtitle = expired
    ? 'Expired'
    : isMe
      ? `${formatLeft(leftMs)} left`
      : `Tap to view · ${formatLeft(leftMs)} left`;
  const iconColor = expired ? COLORS.textSecondary : isMe ? COLORS.white : COLORS.purpleNeon;
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.iconCircle,
          expired ? styles.iconCircleExpired : isMe ? styles.iconCircleMe : styles.iconCircleThem,
        ]}
      >
        {loading && !expired ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Icon name={expired || media.type === 'photo' ? 'timer' : 'video'} size={18} color={iconColor} />
        )}
      </View>
      <View style={styles.texts}>
        <Text style={[styles.title, expired && styles.titleExpired]}>{title}</Text>
        <Text
          style={[styles.subtitle, isMe && !expired ? styles.subtitleMe : null]}
          accessibilityLiveRegion="none"
        >
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

/** "Saved to phone by" + the savers' faces, under the bubble. */
export function ChatMediaSavedBy({ savers, alignEnd }: { savers: ChatMediaSaver[]; alignEnd: boolean }) {
  if (savers.length === 0) { return null; }
  const names = savers.map(s => s.displayName || s.username || 'Someone').join(', ');
  return (
    <View
      style={[styles.savedRow, alignEnd ? styles.savedRowEnd : null]}
      accessible
      accessibilityLabel={`Saved to phone by ${names}`}
    >
      <Text style={styles.savedText}>Saved to phone by</Text>
      <View style={styles.faces}>
        {savers.slice(0, 4).map((s, i) => (
          <View key={s.userId} style={[styles.face, i > 0 ? styles.faceOverlap : null]}>
            {s.avatarUrl ? (
              <Image source={{ uri: s.avatarUrl }} style={styles.faceImg} />
            ) : (
              <Text style={styles.faceInitial}>
                {(s.displayName || s.username || '?').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleMe: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  iconCircleThem: { backgroundColor: COLORS.purpleDim },
  iconCircleExpired: { borderWidth: 1, borderColor: COLORS.border },
  texts: { gap: 1 },
  title: { color: COLORS.white, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  titleExpired: { color: COLORS.textSecondary },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  subtitleMe: { color: 'rgba(255, 255, 255, 0.85)' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingHorizontal: 4 },
  savedRowEnd: { alignSelf: 'flex-end' },
  savedText: { color: COLORS.textSecondary, fontSize: 11 },
  faces: { flexDirection: 'row' },
  face: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.bg,
  },
  faceOverlap: { marginLeft: -5 },
  faceImg: { width: '100%', height: '100%' },
  faceInitial: { color: COLORS.purpleLight, fontSize: 9, fontWeight: '700' },
});
