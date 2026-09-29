import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import { Icon } from './Icon';
import { onMyAvatarChanged } from '../services/profileService';

const SIZE = 28;
const RING = 2;

async function fetchMyAvatar(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) { return null; }
  const { data: row } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', uid)
    .maybeSingle();
  return (row as { avatar_url: string | null } | null)?.avatar_url ?? null;
}

/**
 * The signed-in user's avatar, kept current: read on mount and on every sign-in /
 * account switch, and replaced in place when EditProfile saves a new one
 * (updateProfile emits onMyAvatarChanged), so the tab never shows a stale photo.
 */
function useMyAvatar(): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // A cold start can run this before the session is restored or the network is up
    // (seen on Android: the one fetch failed and the tab kept the glyph until restart).
    // So retry a few times with backoff, and re-read on every session event below.
    const refresh = () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      fetchMyAvatar()
        .then(next => {
          if (cancelled) { return; }
          setUrl(next);
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
      if (event === 'SIGNED_OUT') { setUrl(null); }
    });
    const sub = onMyAvatarChanged(next => setUrl(next));
    return () => {
      cancelled = true;
      if (retryTimer) { clearTimeout(retryTimer); }
      auth.subscription.unsubscribe();
      sub.remove();
    };
  }, []);

  return url;
}

/**
 * The Profile tab's icon: your own photo in a circle, with a purpleNeon ring while the
 * tab is selected. Falls back to the profile glyph when there is no photo, or it fails
 * to load, so the tab is never blank.
 */
export default function TabAvatar({ color, focused }: { color: string; focused: boolean }) {
  const url = useMyAvatar();
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
});
