import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../theme/colors';
import GroupAvatarCluster from './GroupAvatarCluster';
import { useGroupFaces } from '../hooks/useGroupFaces';

/**
 * Who you are jamming with, on the floating player's jam pill — drawn the same way the
 * chat list draws that conversation: a GROUP is its members' faces (GroupAvatarCluster,
 * same data as the inbox), a DM is the other person's photo. Falls back to the room's
 * first letter until either has loaded.
 */
export default function JamPillAvatar({
  conversationId,
  title,
  size,
}: {
  conversationId: string;
  title: string;
  size: number;
}) {
  const faces = useGroupFaces([conversationId]).get(conversationId);
  const isGroup = !!faces && faces.length > 0;
  const visitSeed = useMemo(() => Math.floor(Math.random() * 1e9), []);
  const [dmAvatar, setDmAvatar] = useState<string | null>(null);

  // DM: the other member's photo. Groups never need this (list_group_faces covers them).
  useEffect(() => {
    if (isGroup) { return; }
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase.auth.getUser();
      const uid = me?.user?.id;
      if (!uid) { return; }
      const { data } = await supabase
        .from('conversation_members')
        .select('user_id, profiles!conversation_members_user_id_fkey ( avatar_url )')
        .eq('conversation_id', conversationId)
        .neq('user_id', uid)
        .limit(2);
      const rows = (data ?? []) as unknown as Array<{ profiles: { avatar_url: string | null } | null }>;
      if (!cancelled && rows.length === 1) { setDmAvatar(rows[0]!.profiles?.avatar_url ?? null); }
    })().catch(() => { /* keep the letter */ });
    return () => { cancelled = true; };
  }, [conversationId, isGroup]);

  const circle = { width: size, height: size, borderRadius: size / 2 };

  if (isGroup) {
    return (
      <GroupAvatarCluster
        conversationId={conversationId}
        faces={faces}
        size={size}
        visitSeed={visitSeed}
        fallbackLabel={title}
      />
    );
  }
  if (dmAvatar) {
    return <Image source={{ uri: dmAvatar }} style={[styles.ring, circle]} />;
  }
  return (
    <View style={[styles.ring, styles.letterWrap, circle]}>
      <Text style={styles.letter}>{(title || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: 1.5, borderColor: COLORS.purpleNeon },
  letterWrap: { backgroundColor: COLORS.purpleDim, alignItems: 'center', justifyContent: 'center' },
  letter: { color: COLORS.purpleLight, fontSize: 12, fontWeight: '700' },
});
