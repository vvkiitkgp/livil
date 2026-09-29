import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { onMyAvatarChanged } from '../services/profileService';

const SIZE = 28;
const RING = 2;

type Me = { avatarUrl: string | null; letter: string | null };

async function fetchMe(): Promise<Me> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) { return { avatarUrl: null, letter: null }; }
  const { data: row, error } = await supabase
    .from('profiles')
    .select('avatar_url, display_name, username')
    .eq('id', uid)
    .maybeSingle();
  if (error) { throw error; }
  const r = row as { avatar_url: string | null; display_name: string | null; username: string | null } | null;
  const name = (r?.display_name || r?.username || '').trim();
  return { avatarUrl: r?.avatar_url ?? null, letter: name ? name.charAt(0).toUpperCase() : null };
}

/**
 * The signed-in user's avatar, kept current: read on mount and on every sign-in /
 * account switch, and replaced in place when EditProfile saves a new one
 * (updateProfile emits onMyAvatarChanged), so the tab never shows a stale photo.
 */
function useMe(): Me {
  const [me, setMe] = useState<Me>({ avatarUrl: null, letter: null });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // A cold start can run this before the session is restored or the network is up
    // (seen on Android: the one fetch failed and the tab kept the glyph until restart).
    // So retry a few times with backoff, and re-read on every session event below.
    const refresh = () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      fetchMe()
        .then(next => {
          if (cancelled) { return; }
          setMe(next);
          attempts = 0;
        })
        .catch(() => {
          if (cancelled || attempts >= 4) { return; }
          attempts += 1;
          retryTimer = setTimeout(refresh, 2000 * attempts);
        });
    };
    refresh();
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN'
          || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { refresh(); }
      if (event === 'SIGNED_OUT') { setMe({ avatarUrl: null, letter: null }); }
    });
    // A saved profile edit: show the new photo at once, then re-read (the name — and so
    // the letter — may have changed too).
    const sub = onMyAvatarChanged(next => {
      setMe(prev => ({ ...prev, avatarUrl: next }));
      refresh();
    });
    return () => {
      cancelled = true;
      if (retryTimer) { clearTimeout(retryTimer); }
      auth.subscription.unsubscribe();
      sub.remove();
    };
  }, []);

  return me;
}

/**
 * The Profile tab's icon: your own photo in a circle, with a purpleNeon ring while the
 * tab is selected. With no photo (or while it fails to load), the first letter of your
 * name in a translucent bubble; the plain glyph only until the profile has loaded.
 */
export default function TabAvatar({ color, focused }: { color: string; focused: boolean }) {
  const { avatarUrl: url, letter } = useMe();
  const [failed, setFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => { setFailed(false); setLoadAttempt(0); }, [url]);

  // A failed image load shows the glyph, then tries again (a remount via `key`) a few
  // times — one flaky load at startup must not cost the photo until the next restart.
  useEffect(() => {
    if (!failed || loadAttempt >= 3) { return; }
    const t = setTimeout(() => { setFailed(false); setLoadAttempt(a => a + 1); }, 4000);
    return () => clearTimeout(t);
  }, [failed, loadAttempt]);

  if (!url || failed) {
    // No photo: the first letter in a see-through bubble, as elsewhere in the app.
    // Only before the profile has loaded at all does the tab show the glyph.
    if (letter) {
      return (
        <View style={[styles.ring, focused && styles.ringFocused]}>
          <View style={[styles.photo, styles.letterBubble, !focused && styles.photoIdle]}>
            <Text style={[styles.letter, focused && styles.letterFocused]}>{letter}</Text>
          </View>
        </View>
      );
    }
    return <Icon name="profile" size={26} color={color} weight={focused ? 'fill' : 'regular'} />;
  }
  return (
    <View style={[styles.ring, focused && styles.ringFocused]}>
      <Image
        key={loadAttempt}
        source={{ uri: url }}
        style={[styles.photo, !focused && styles.photoIdle]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: SIZE + RING * 2,
    height: SIZE + RING * 2,
    borderRadius: (SIZE + RING * 2) / 2,
    borderWidth: RING,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringFocused: { borderColor: COLORS.purpleNeon },
  photo: {
    width: SIZE - 2,
    height: SIZE - 2,
    borderRadius: (SIZE - 2) / 2,
    backgroundColor: COLORS.surface,
  },
  photoIdle: { opacity: 0.85 },
  letterBubble: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { color: COLORS.purpleLight, fontSize: 13, fontWeight: '800' },
  letterFocused: { color: COLORS.white },
});
