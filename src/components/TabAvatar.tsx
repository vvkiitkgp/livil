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
    const refresh = () => {
      fetchMyAvatar()
        .then(next => { if (!cancelled) { setUrl(next); } })
        .catch(() => { /* keep the icon */ });
    };
    refresh();
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') { refresh(); }
      if (event === 'SIGNED_OUT') { setUrl(null); }
    });
    const sub = onMyAvatarChanged(next => setUrl(next));
    return () => {
      cancelled = true;
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

  useEffect(() => { setFailed(false); }, [url]);

  if (!url || failed) {
    return <Icon name="profile" size={26} color={color} weight={focused ? 'fill' : 'regular'} />;
  }
  return (
    <View style={[styles.ring, focused && styles.ringFocused]}>
      <Image
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
