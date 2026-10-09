import React, { useEffect, useState } from 'react';
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';
import { fetchSharedProfile, type ShareableProfile } from '../services/share';
import { Icon } from './Icon';

/**
 * A profile link in chat, drawn as a card: photo, name, handle, "View profile".
 *
 * A shared profile travels as a plain TEXT message whose body is the link (see
 * `shareProfileToConversations` — older app builds must still read it). This is how a
 * build that knows about profile links renders that same message, and it applies to a
 * link someone pasted by hand just as much as to one sent from the Share sheet.
 *
 * EVERYTHING SHOWN IS READ FROM THE DATABASE, by handle, under the viewer's own RLS —
 * never from the message. A message can carry any text its sender likes; reading the
 * name and photo from `profiles` is what stops a card from showing one person's face
 * over another person's link. A block in either direction, or a handle that no longer
 * resolves, comes back null — and the card says so instead of guessing.
 *
 * The bubble around it owns the tap (it already owns long-press for reactions), so this
 * component only draws.
 */

type Resolved = ShareableProfile | null;

/**
 * One lookup per handle per signed-in session. A chat can show the same link many times,
 * and a card re-rendering on every new message must not re-query.
 *
 * Only DEFINITE answers are kept — found, or not there for this viewer. A failed request
 * (offline, a dead spot while the cached chat renders) is evicted so the next mount asks
 * again; caching it as "gone" would label a real profile "not available" until restart.
 */
const cache = new Map<string, Resolved | Promise<Resolved>>();

/**
 * Called on sign-out next to the chat cache: every entry was resolved under ONE viewer's
 * RLS (their blocks) and must not be shown to the next account on this phone.
 */
export function clearProfileLinkCache(): void {
  cache.clear();
}

function lookup(username: string): Resolved | Promise<Resolved> {
  const hit = cache.get(username);
  if (hit !== undefined) { return hit; }
  const pending = fetchSharedProfile(username).then(
    result => {
      cache.set(username, result);
      return result;
    },
    err => {
      cache.delete(username);
      throw err;
    },
  );
  cache.set(username, pending);
  return pending;
}

type Props = {
  username: string;
  /** The sender's own bubble is purple; text and accents swap to stay legible on it. */
  isMe: boolean;
};

export function ProfileLinkCard({ username, isMe }: Props) {
  const initial = cache.get(username);
  const [profile, setProfile] = useState<Resolved | undefined>(
    initial instanceof Promise ? undefined : initial,
  );

  useEffect(() => {
    const result = lookup(username);
    if (!(result instanceof Promise)) {
      setProfile(result);
      return;
    }
    let cancelled = false;
    // On a failed request the card stays in its neutral "@handle on Livil" state —
    // tapping it still opens the profile, which resolves afresh.
    result.then(
      r => { if (!cancelled) { setProfile(r); } },
      () => {},
    );
    return () => { cancelled = true; };
  }, [username]);

  const unavailable = profile === null;
  const name = profile?.displayName?.trim() || `@${username}`;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {profile?.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            {unavailable ? (
              <Icon name="profile" size={22} color={COLORS.textSecondary} />
            ) : (
              <Text style={styles.avatarInitial}>
                {(profile?.displayName?.trim() || username)[0]?.toUpperCase() ?? '♪'}
              </Text>
            )}
          </View>
        )}
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {unavailable ? `@${username}` : name}
          </Text>
          <Text style={[styles.handle, isMe && styles.handleMe]} numberOfLines={1}>
            {unavailable
              ? 'Profile not available'
              : profile?.displayName?.trim() ? `@${username}` : 'on Livil'}
          </Text>
        </View>
      </View>
      {unavailable ? null : (
        <View style={styles.cta}>
          <Icon name="profile" size={12} color={isMe ? COLORS.white : COLORS.purpleNeon} weight="bold" />
          <Text style={[styles.ctaText, isMe && styles.ctaTextMe]}>View profile</Text>
        </View>
      )}
    </View>
  );
}

const CARD_WIDTH = Math.round(Dimensions.get('window').width * 0.58);

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.card },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  text: { flex: 1 },
  name: { color: COLORS.white, fontSize: 14.5, fontWeight: '700' },
  handle: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 },
  // Same reason as the track card's artist line: #888 is muddy on the purple bubble.
  handleMe: { color: 'rgba(255,255,255,0.82)' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  ctaText: { color: COLORS.purpleNeon, fontSize: 11.5, fontWeight: '700' },
  ctaTextMe: { color: COLORS.white },
});
