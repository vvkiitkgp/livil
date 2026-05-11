import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../theme/colors';
import type { RootStackParamList } from '../../navigation/types';

type HomeNavigation = NativeStackNavigationProp<RootStackParamList>;

type Track = {
  id: string;
  title: string;
  artist: string;
  coverColors: [string, string];
  initial: string;
};

type FriendActivity = {
  id: string;
  username: string;
  displayName: string;
  track: string;
  artist: string;
  timeAgo: string;
  avatarColor: string;
  initials: string;
};

const FEATURED = {
  tag: 'Featured today',
  title: 'Midnight Sessions',
  subtitle: 'A curated mix of late-night vibes from your community',
  cta: 'Listen now',
};

const RECENTLY_PLAYED: Track[] = [
  {
    id: 'rp1',
    title: 'Neon Skies',
    artist: 'Aurora Vale',
    coverColors: ['#7C3AED', '#3B1E6E'],
    initial: 'N',
  },
  {
    id: 'rp2',
    title: 'Echoes',
    artist: 'Lo-Fi Wolves',
    coverColors: ['#EC4899', '#7C3AED'],
    initial: 'E',
  },
  {
    id: 'rp3',
    title: 'After Hours',
    artist: 'Kairos',
    coverColors: ['#22D3EE', '#3B82F6'],
    initial: 'A',
  },
  {
    id: 'rp4',
    title: 'Velvet Hour',
    artist: 'Mira Solène',
    coverColors: ['#F59E0B', '#EF4444'],
    initial: 'V',
  },
  {
    id: 'rp5',
    title: 'Slow Burn',
    artist: 'The Embers',
    coverColors: ['#10B981', '#0EA5E9'],
    initial: 'S',
  },
  {
    id: 'rp6',
    title: 'Glassland',
    artist: 'Halcyon',
    coverColors: ['#A78BFA', '#7C3AED'],
    initial: 'G',
  },
];

const FRIENDS_ACTIVITY: FriendActivity[] = [
  {
    id: 'f1',
    username: '@maya',
    displayName: 'Maya Chen',
    track: 'Borderline',
    artist: 'Tame Impala',
    timeAgo: '2m',
    avatarColor: '#7C3AED',
    initials: 'MC',
  },
  {
    id: 'f2',
    username: '@deron',
    displayName: 'Deron Park',
    track: 'Ribs',
    artist: 'Lorde',
    timeAgo: '14m',
    avatarColor: '#EC4899',
    initials: 'DP',
  },
  {
    id: 'f3',
    username: '@sami',
    displayName: 'Sami Rivers',
    track: 'Redbone',
    artist: 'Childish Gambino',
    timeAgo: '38m',
    avatarColor: '#22D3EE',
    initials: 'SR',
  },
  {
    id: 'f4',
    username: '@noor',
    displayName: 'Noor Hassan',
    track: 'Pink + White',
    artist: 'Frank Ocean',
    timeAgo: '1h',
    avatarColor: '#F59E0B',
    initials: 'NH',
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>L</Text>
          </View>
          <Text style={styles.wordmark}>livil</Text>
        </View>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.uploadButton}
            onPress={() => navigation.navigate('Upload')}
            accessibilityLabel="Upload music"
          >
            <Text style={styles.uploadButtonText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.8} style={styles.avatar}>
            <Text style={styles.avatarText}>VK</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Featured banner */}
        <Pressable style={styles.featured}>
          <View style={styles.featuredGlow} />
          <View style={styles.featuredContent}>
            <Text style={styles.featuredTag}>{FEATURED.tag}</Text>
            <Text style={styles.featuredTitle}>{FEATURED.title}</Text>
            <Text style={styles.featuredSubtitle}>{FEATURED.subtitle}</Text>
            <View style={styles.featuredCtaRow}>
              <View style={styles.featuredCta}>
                <Text style={styles.featuredCtaText}>{FEATURED.cta}</Text>
                <Text style={styles.featuredCtaArrow}>→</Text>
              </View>
            </View>
          </View>
          <View style={styles.featuredArtwork}>
            <View style={[styles.featuredArtBlob, styles.featuredArtBlobA]} />
            <View style={[styles.featuredArtBlob, styles.featuredArtBlobB]} />
            <View style={[styles.featuredArtBlob, styles.featuredArtBlobC]} />
          </View>
        </Pressable>

        {/* Recently Played */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Played</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.sectionLink}>See all</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recentlyRow}
        >
          {RECENTLY_PLAYED.map(track => (
            <Pressable key={track.id} style={styles.trackCard}>
              <View
                style={[
                  styles.coverArt,
                  { backgroundColor: track.coverColors[0] },
                ]}
              >
                <View
                  style={[
                    styles.coverArtAccent,
                    { backgroundColor: track.coverColors[1] },
                  ]}
                />
                <Text style={styles.coverArtInitial}>{track.initial}</Text>
              </View>
              <Text style={styles.trackTitle} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={styles.trackArtist} numberOfLines={1}>
                {track.artist}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Friends Activity */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Friends Activity</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.sectionLink}>See all</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.friendsList}>
          {FRIENDS_ACTIVITY.map(friend => (
            <Pressable key={friend.id} style={styles.friendCard}>
              <View
                style={[
                  styles.friendAvatar,
                  { backgroundColor: friend.avatarColor },
                ]}
              >
                <Text style={styles.friendAvatarText}>{friend.initials}</Text>
                <View style={styles.nowPlayingDot} />
              </View>

              <View style={styles.friendInfo}>
                <View style={styles.friendNameRow}>
                  <Text style={styles.friendName} numberOfLines={1}>
                    {friend.displayName}
                  </Text>
                  <Text style={styles.friendTime}>{friend.timeAgo}</Text>
                </View>
                <Text style={styles.friendUsername}>{friend.username}</Text>
                <View style={styles.nowPlayingRow}>
                  <Text style={styles.nowPlayingIcon}>♪</Text>
                  <Text style={styles.nowPlayingText} numberOfLines={1}>
                    <Text style={styles.nowPlayingTrack}>{friend.track}</Text>
                    <Text style={styles.nowPlayingDivider}> · </Text>
                    {friend.artist}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.scrollSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    paddingBottom: 24,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  uploadButtonText: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: -2,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  logoMarkText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
  },
  wordmark: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Featured banner
  featured: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 28,
    height: 180,
    borderRadius: 22,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  featuredGlow: {
    position: 'absolute',
    top: -60,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.purpleGlow,
    opacity: 0.7,
  },
  featuredContent: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  featuredTag: {
    color: COLORS.purpleLight,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  featuredTitle: {
    color: COLORS.white,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 6,
  },
  featuredSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    paddingRight: 8,
  },
  featuredCtaRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  featuredCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: COLORS.purple,
  },
  featuredCtaText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  featuredCtaArrow: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  featuredArtwork: {
    width: 130,
    height: '100%',
  },
  featuredArtBlob: {
    position: 'absolute',
    borderRadius: 999,
  },
  featuredArtBlobA: {
    width: 110,
    height: 110,
    backgroundColor: '#7C3AED',
    top: 30,
    right: -30,
    opacity: 0.85,
  },
  featuredArtBlobB: {
    width: 80,
    height: 80,
    backgroundColor: '#EC4899',
    top: 80,
    right: 40,
    opacity: 0.7,
  },
  featuredArtBlobC: {
    width: 60,
    height: 60,
    backgroundColor: '#22D3EE',
    top: -10,
    right: 20,
    opacity: 0.6,
  },

  // Sections
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sectionLink: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '600',
  },

  // Recently played
  recentlyRow: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  trackCard: {
    width: 144,
  },
  coverArt: {
    width: 144,
    height: 144,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  coverArtAccent: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -40,
    right: -40,
    opacity: 0.65,
  },
  coverArtInitial: {
    color: COLORS.white,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1,
  },
  trackTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  trackArtist: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },

  // Friends activity
  friendsList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  friendAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  nowPlayingDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: COLORS.surface,
    bottom: -1,
    right: -1,
  },
  friendInfo: {
    flex: 1,
  },
  friendNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendName: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  friendTime: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginLeft: 8,
  },
  friendUsername: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  nowPlayingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  nowPlayingIcon: {
    color: COLORS.purpleLight,
    fontSize: 13,
  },
  nowPlayingText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  nowPlayingTrack: {
    color: COLORS.white,
    fontWeight: '600',
  },
  nowPlayingDivider: {
    color: COLORS.textMuted,
  },

  scrollSpacer: {
    height: 24,
  },
});
