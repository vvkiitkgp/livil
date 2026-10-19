import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon } from '../../components/Icon';
import SheetModal, { SheetScrollView } from '../../components/SheetModal';
import { AuthStep, StepButton, StepLink } from '../../components/auth/AuthStep';
import { useToast } from '../../contexts/ToastContext';
import { useRunAfterDismiss } from '../../hooks/useRunAfterDismiss';
import {
  getMyProfile,
  isUploadedAvatar,
  pickAvatarFromCamera,
  pickAvatarFromLibrary,
  setMyAvatar,
  uploadAvatar,
  type PickedAvatar,
} from '../../services/profileService';
import { haptics } from '../../utils/haptics';

type Props = {
  userId: string;
  /** Finished or skipped — the first-run guide comes next. */
  onDone: () => void;
};

type Phase =
  | { kind: 'empty' }
  | { kind: 'saving'; uri: string }
  | { kind: 'done'; uri: string };

const CIRCLE = 168;

/** Set once the step is finished or skipped, so closing the app never brings it back. */
const doneKey = (userId: string) => `livil.photoStepDone.v1.${userId}`;

/**
 * "Add your face": the last sign-up step, for every new account (owner's design,
 * 2026-10-19). It comes after the first sign-in because an email account only exists once
 * its confirmation link is tapped — there is nowhere to save a photo before that.
 *
 * Always starts empty, even when Google gave the account a photo: the owner wants people
 * asked. "Skip for now" changes nothing, so a Google account keeps that photo and an email
 * account shows its initial. A picked photo is saved straight away (only `avatar_url`,
 * setMyAvatar); a failed save says so and the step stays open.
 *
 * Shown once: finishing or skipping is remembered on the device, and an account whose photo
 * is already an uploaded one skips it anywhere — the app can be closed between this step
 * and the guide's pick step, and must reopen on the guide, not here (bug, 2026-10-19).
 */
export default function AddPhotoScreen({ userId, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  // Until we know whether this step was already done, draw nothing over the background.
  const [checking, setChecking] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [who, setWho] = useState<{ name: string; username: string } | null>(null);
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  // The library and camera are native screens over the app; on iOS they must wait until
  // the sheet has closed or they open into nothing (useRunAfterDismiss).
  const { runAfterDismiss, onDismiss } = useRunAfterDismiss();

  // Read through a ref: RootNavigator passes a fresh arrow every render, and the check
  // below must run once per account, not on every parent render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    AsyncStorage.setItem(doneKey(userId), '1').catch(() => {});
    onDoneRef.current();
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [flag, profile] = await Promise.all([
        AsyncStorage.getItem(doneKey(userId)).catch(() => null),
        getMyProfile(userId).catch(() => null),
      ]);
      if (!alive) {return;}
      if (flag === '1' || isUploadedAvatar(profile?.avatar_url)) { onDoneRef.current(); return; }
      if (profile) { setWho({ name: profile.display_name?.trim() || profile.username, username: profile.username }); }
      setChecking(false);
    })();
    return () => { alive = false; };
  }, [userId]);

  const save = useCallback(async (asset: PickedAvatar, before: Phase) => {
    setPhase({ kind: 'saving', uri: asset.uri });
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {throw new Error('No session');}
      const url = await uploadAvatar(userId, asset, token);
      await setMyAvatar(userId, url);
      haptics.success();
      AsyncStorage.setItem(doneKey(userId), '1').catch(() => {});
      setPhase({ kind: 'done', uri: asset.uri });
    } catch {
      haptics.error();
      showToast("Couldn't save your photo. Try again.", { kind: 'error' });
      setPhase(before);
    }
  }, [userId, showToast]);

  const pick = useCallback((from: 'library' | 'camera') => {
    setSheetOpen(false);
    const before = phase;
    runAfterDismiss(async () => {
      try {
        const asset = from === 'library' ? await pickAvatarFromLibrary() : await pickAvatarFromCamera();
        if (asset) {void save(asset, before);}
      } catch {
        showToast(from === 'library' ? "Couldn't open your photos." : "Couldn't open the camera.", { kind: 'error' });
      }
    });
  }, [phase, runAfterDismiss, save, showToast]);

  const openSheet = useCallback(() => {
    haptics.tap();
    setSheetOpen(true);
  }, []);

  const done = phase.kind === 'done';
  const saving = phase.kind === 'saving';

  if (checking) {return <View style={styles.blank} />;}

  return (
    <>
      <AuthStep
        kicker="LAST STEP"
        headline={done ? 'Looking sharp' : 'Add your face'}
        line={done ? "You're all set." : 'Friends find you faster with a photo.'}
        step={1}
        steps={1}
        center
        footer={
          phase.kind === 'empty' ? (
            <>
              <StepButton label="ADD A PHOTO" onPress={openSheet} />
              <StepLink label="Skip for now" onPress={finish} muted />
            </>
          ) : (
            <>
              <StepButton label="LET'S GO →" onPress={finish} busy={saving} disabled={saving} />
              <StepLink label="Change photo" onPress={openSheet} />
            </>
          )
        }
      >
        <Pressable
          onPress={openSheet}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={phase.kind === 'empty' ? 'Add a photo' : 'Change photo'}
          style={({ pressed }) => [
            styles.circle,
            phase.kind === 'empty' ? styles.circleEmpty : styles.circleFilled,
            pressed && styles.pressed,
          ]}
        >
          {phase.kind === 'empty' ? (
            <>
              <Icon name="camera" size={36} color={COLORS.purpleLight} />
              <Text style={styles.tapText}>Tap to add</Text>
            </>
          ) : (
            <>
              <Image source={{ uri: phase.uri }} style={styles.photo} />
              {saving ? (
                <View style={styles.savingVeil}>
                  <ActivityIndicator color={COLORS.white} />
                </View>
              ) : null}
            </>
          )}
        </Pressable>
        {who ? (
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{who.name}</Text>
            <Text style={styles.handle} numberOfLines={1}>@{who.username}</Text>
          </View>
        ) : null}
      </AuthStep>

      <SheetModal
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onDismiss={onDismiss}
        fit
        style={styles.sheet}
        header={<Text style={styles.sheetTitle}>Profile picture</Text>}
      >
        <SheetScrollView
          style={styles.sheetBody}
          contentContainerStyle={[styles.sheetBodyContent, { paddingBottom: 28 + insets.bottom }]}
        >
          <TouchableOpacity onPress={() => pick('camera')} style={styles.sheetRow} activeOpacity={0.7}>
            <Text style={styles.sheetRowText}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => pick('library')} style={styles.sheetRow} activeOpacity={0.7}>
            <Text style={styles.sheetRowText}>Choose from library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSheetOpen(false)}
            style={[styles.sheetRow, styles.sheetCancel]}
            activeOpacity={0.7}
          >
            <Text style={[styles.sheetRowText, styles.sheetCancelText]}>Cancel</Text>
          </TouchableOpacity>
        </SheetScrollView>
      </SheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: COLORS.bg },
  pressed: { opacity: 0.8 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  circleEmpty: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.purpleRoyal,
    backgroundColor: COLORS.surface,
  },
  circleFilled: { borderWidth: 2, borderColor: COLORS.purpleNeon },
  tapText: { fontFamily: FONTS.mono, fontSize: 12, color: COLORS.purpleLight },
  photo: { width: '100%', height: '100%' },
  savingVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10, 10, 15, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: { alignItems: 'center', gap: 2, marginTop: -4 },
  name: { fontFamily: FONTS.monoBold, fontSize: 15, color: COLORS.white },
  handle: { fontFamily: FONTS.mono, fontSize: 13, color: COLORS.textSecondary },
  sheet: { backgroundColor: COLORS.surface },
  sheetBody: { flexShrink: 1 },
  sheetBodyContent: { paddingHorizontal: 16 },
  sheetTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingVertical: 10,
  },
  sheetRow: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    alignItems: 'center',
  },
  sheetRowText: { color: COLORS.white, fontSize: 16 },
  sheetCancel: { marginTop: 8, borderTopWidth: 0 },
  sheetCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
});
