import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import FormInput from '../../components/FormInput';
import { Icon } from '../../components/Icon';
import { COLORS } from '../../theme/colors';
import { supabase } from '../../../lib/supabase';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { useToast } from '../../contexts/ToastContext';
import {
  getMyPrivateProfile,
  getMyProfile,
  pickAvatarFromCamera,
  pickAvatarFromLibrary,
  updatePrivateProfile,
  updateProfile,
  uploadAvatar,
  type PickedAvatar,
} from '../../services/profileService';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'EditProfile'>;

const MAX_LINKS = 10;
const BIO_MAX = 160;
const DISPLAY_NAME_MAX = 50;

type FormState = {
  display_name: string;
  bio: string;
  dob: string; // MM/DD/YYYY
  phone: string;
  links: string[];
};

type AvatarState =
  | { kind: 'remote'; url: string | null }
  | { kind: 'local'; asset: PickedAvatar }
  | { kind: 'removed' };

const EMPTY_FORM: FormState = {
  display_name: '',
  bio: '',
  dob: '',
  phone: '',
  links: [],
};

function maskDob(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) {return digits;}
  if (digits.length <= 4) {return `${digits.slice(0, 2)}/${digits.slice(2)}`;}
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function dobToIsoDate(mmddyyyy: string): string | null {
  if (!mmddyyyy) {return null;}
  const m = mmddyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) {return null;}
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
    return null;
  }
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function isoDateToDob(iso: string | null): string {
  if (!iso) {return '';}
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {return '';}
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function isFormEqual(a: FormState, b: FormState): boolean {
  if (
    a.display_name !== b.display_name ||
    a.bio !== b.bio ||
    a.dob !== b.dob ||
    a.phone !== b.phone
  ) {
    return false;
  }
  if (a.links.length !== b.links.length) {return false;}
  for (let i = 0; i < a.links.length; i += 1) {
    if (a.links[i] !== b.links[i]) {return false;}
  }
  return true;
}

export default function EditProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const initialFormRef = useRef<FormState>(EMPTY_FORM);
  const initialAvatarUrlRef = useRef<string | null>(null);
  const [avatar, setAvatar] = useState<AvatarState>({ kind: 'remote', url: null });
  const [username, setUsername] = useState<string>('');
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user.id;
        if (!uid) {throw new Error('Not signed in.');}
        const pub = await getMyProfile(uid);
        if (cancelled) {return;}
        // Private fields are optional — don't let a failure here block the
        // rest of the form. Surface the failure as a non-fatal error.
        let priv = { date_of_birth: null as string | null, phone_number: null as string | null };
        try {
          priv = await getMyPrivateProfile(uid);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed to load private fields.';
          if (!cancelled) {setError(`Couldn't load private fields: ${msg}`);}
        }
        if (cancelled) {return;}
        const next: FormState = {
          display_name: pub.display_name ?? '',
          bio: pub.bio ?? '',
          dob: isoDateToDob(priv.date_of_birth),
          phone: priv.phone_number ?? '',
          links: pub.links ?? [],
        };
        setUserId(uid);
        setUsername(pub.username);
        setForm(next);
        initialFormRef.current = next;
        initialAvatarUrlRef.current = pub.avatar_url;
        setAvatar({ kind: 'remote', url: pub.avatar_url });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load profile.';
        if (!cancelled) {setError(msg);}
      } finally {
        if (!cancelled) {setLoading(false);}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!isFormEqual(form, initialFormRef.current)) {return true;}
    if (avatar.kind === 'local' || avatar.kind === 'removed') {return true;}
    return false;
  }, [form, avatar]);

  const trimmedDisplayName = form.display_name.trim();
  const dobIso = form.dob ? dobToIsoDate(form.dob) : null;
  const dobInvalid = form.dob.length > 0 && dobIso === null;
  const canSave = dirty && !saving && trimmedDisplayName.length > 0 && !dobInvalid;

  const setLink = useCallback((index: number, value: string) => {
    setForm(prev => {
      const next = [...prev.links];
      next[index] = value;
      return { ...prev, links: next };
    });
  }, []);

  const removeLink = useCallback((index: number) => {
    setForm(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }));
  }, []);

  const addLink = useCallback(() => {
    setForm(prev =>
      prev.links.length >= MAX_LINKS ? prev : { ...prev, links: [...prev.links, ''] },
    );
  }, []);

  const openAvatarSheet = useCallback(() => setAvatarSheetOpen(true), []);
  const closeAvatarSheet = useCallback(() => setAvatarSheetOpen(false), []);

  const handlePickFromLibrary = useCallback(async () => {
    closeAvatarSheet();
    try {
      const asset = await pickAvatarFromLibrary();
      if (asset) {setAvatar({ kind: 'local', asset });}
    } catch (e) {
      console.warn('[profile] pickAvatarFromLibrary failed', e);
      showToast("Couldn't open the photo library.", { kind: 'error' });
    }
  }, [closeAvatarSheet, showToast]);

  const handleTakePhoto = useCallback(async () => {
    closeAvatarSheet();
    try {
      const asset = await pickAvatarFromCamera();
      if (asset) {setAvatar({ kind: 'local', asset });}
    } catch (e) {
      console.warn('[profile] pickAvatarFromCamera failed', e);
      showToast("Couldn't open the camera.", { kind: 'error' });
    }
  }, [closeAvatarSheet, showToast]);

  const handleRemoveAvatar = useCallback(() => {
    closeAvatarSheet();
    setAvatar({ kind: 'removed' });
  }, [closeAvatarSheet]);

  const handleBack = useCallback(() => {
    if (!dirty) {
      navigation.goBack();
      return;
    }
    setDiscardOpen(true);
  }, [dirty, navigation]);

  const confirmDiscard = useCallback(() => {
    setDiscardOpen(false);
    navigation.goBack();
  }, [navigation]);

  const handleSave = useCallback(async () => {
    if (!canSave || !userId) {return;}
    setSaving(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {throw new Error('Session expired. Please sign in again.');}

      let nextAvatarUrl: string | null = initialAvatarUrlRef.current;
      if (avatar.kind === 'local') {
        nextAvatarUrl = await uploadAvatar(userId, avatar.asset, accessToken);
      } else if (avatar.kind === 'removed') {
        nextAvatarUrl = null;
      }

      const cleanedLinks = form.links
        .map(l => l.trim())
        .filter(l => l.length > 0);

      await updateProfile(userId, {
        display_name: trimmedDisplayName,
        bio: form.bio.trim() || null,
        avatar_url: nextAvatarUrl,
        links: cleanedLinks,
      });

      await updatePrivateProfile(userId, {
        date_of_birth: dobIso,
        phone_number: form.phone.trim() || null,
      });

      navigation.goBack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [avatar, canSave, dobIso, form, navigation, trimmedDisplayName, userId]);

  const avatarPreviewUri = useMemo(() => {
    if (avatar.kind === 'local') {return avatar.asset.uri;}
    if (avatar.kind === 'removed') {return null;}
    return avatar.url;
  }, [avatar]);

  const avatarInitial = (form.display_name || username || '?').trim().charAt(0).toUpperCase();
  const hasAvatar =
    (avatar.kind === 'remote' && !!avatar.url) || avatar.kind === 'local';

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.purpleLight} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerSide}
          accessibilityLabel="Back"
        >
          <View style={{ marginTop: Platform.OS === 'android' ? -4 : 0 }}>
            <Icon name="back" size={32} color={COLORS.white} />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          style={[styles.headerSide, styles.headerSaveWrap]}
          accessibilityLabel="Save"
        >
          {saving ? (
            <ActivityIndicator color={COLORS.purpleLight} />
          ) : (
            <Text style={[styles.headerSave, !canSave && styles.headerSaveDisabled]}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={[styles.errorBox, styles.errorBoxTop]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={openAvatarSheet}
            activeOpacity={0.85}
            style={styles.avatarRing}
          >
            <View style={styles.avatarInner}>
              {avatarPreviewUri ? (
                <Image source={{ uri: avatarPreviewUri }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitial}>{avatarInitial}</Text>
              )}
            </View>
            <View style={styles.avatarEditBadge}>
              <Icon name="edit" size={14} color={COLORS.white} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={openAvatarSheet} activeOpacity={0.7}>
            <Text style={styles.avatarHint}>
              {hasAvatar ? 'Change profile picture' : 'Add profile picture'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Username (locked) */}
        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <View style={[styles.lockedField]}>
            <Text style={styles.lockedFieldText}>@{username}</Text>
            <Text style={styles.lockedFieldHint}>locked</Text>
          </View>
        </View>

        {/* Display name */}
        <View style={styles.field}>
          <Text style={styles.label}>Display name</Text>
          <FormInput
            value={form.display_name}
            onChangeText={t => setForm(prev => ({ ...prev, display_name: t }))}
            placeholder="Your name"
            maxLength={DISPLAY_NAME_MAX}
            autoCorrect={false}
            returnKeyType="next"
          />
          {trimmedDisplayName.length === 0 ? (
            <Text style={styles.helperError}>Display name is required.</Text>
          ) : null}
        </View>

        {/* Bio */}
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Bio</Text>
            <Text style={styles.labelCount}>
              {form.bio.length}/{BIO_MAX}
            </Text>
          </View>
          <FormInput
            value={form.bio}
            onChangeText={t => setForm(prev => ({ ...prev, bio: t }))}
            placeholder="Tell people about yourself"
            multiline
            maxLength={BIO_MAX}
            wrapperStyle={styles.bioWrapper}
            style={styles.bioInput}
            textAlignVertical="top"
          />
        </View>

        {/* Date of birth */}
        <View style={styles.field}>
          <Text style={styles.label}>Date of birth</Text>
          <FormInput
            value={form.dob}
            onChangeText={t => setForm(prev => ({ ...prev, dob: maskDob(t) }))}
            placeholder="MM/DD/YYYY"
            keyboardType="number-pad"
            maxLength={10}
          />
          {dobInvalid ? (
            <Text style={styles.helperError}>Enter a valid date (MM/DD/YYYY).</Text>
          ) : (
            <Text style={styles.helperHint}>Only you can see your date of birth.</Text>
          )}
        </View>

        {/* Phone number */}
        <View style={styles.field}>
          <Text style={styles.label}>Phone number</Text>
          <FormInput
            value={form.phone}
            onChangeText={t => setForm(prev => ({ ...prev, phone: t }))}
            placeholder="+1 555 123 4567"
            keyboardType="phone-pad"
            maxLength={32}
          />
          <Text style={styles.helperHint}>Only you can see your phone number.</Text>
        </View>

        {/* Links */}
        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Links</Text>
            <Text style={styles.labelCount}>
              {form.links.length}/{MAX_LINKS}
            </Text>
          </View>
          {form.links.map((url, idx) => (
            <View key={idx} style={styles.linkRow}>
              <FormInput
                value={url}
                onChangeText={t => setLink(idx, t)}
                placeholder="https://"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                wrapperStyle={styles.linkInputWrapper}
                trailing={
                  <TouchableOpacity
                    onPress={() => removeLink(idx)}
                    style={styles.linkRemove}
                    accessibilityLabel="Remove link"
                  >
                    <Icon name="close" size={22} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                }
              />
            </View>
          ))}
          <TouchableOpacity
            onPress={addLink}
            disabled={form.links.length >= MAX_LINKS}
            style={[
              styles.addLinkButton,
              form.links.length >= MAX_LINKS && styles.addLinkButtonDisabled,
            ]}
            activeOpacity={0.85}
          >
            <Text style={styles.addLinkText}>+ Add link</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </KeyboardAwareScrollView>

      <Modal
        visible={avatarSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAvatarSheet}
      >
        <Pressable style={styles.sheetBackdrop} onPress={closeAvatarSheet}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Profile picture</Text>
            <TouchableOpacity
              onPress={handleTakePhoto}
              style={styles.sheetRow}
              activeOpacity={0.7}
            >
              <Text style={styles.sheetRowText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePickFromLibrary}
              style={styles.sheetRow}
              activeOpacity={0.7}
            >
              <Text style={styles.sheetRowText}>Choose from library</Text>
            </TouchableOpacity>
            {hasAvatar ? (
              <TouchableOpacity
                onPress={handleRemoveAvatar}
                style={styles.sheetRow}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetRowText, styles.sheetRowDestructive]}>
                  Remove photo
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={closeAvatarSheet}
              style={[styles.sheetRow, styles.sheetCancel]}
              activeOpacity={0.7}
            >
              <Text style={[styles.sheetRowText, styles.sheetCancelText]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmActionModal
        visible={discardOpen}
        title="Discard changes?"
        message="Your edits won't be saved."
        glyph="!"
        tone="destructive"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={confirmDiscard}
        onCancel={() => setDiscardOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerSide: {
    minWidth: 64,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  headerSaveWrap: { alignItems: 'flex-end' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '600',
  },
  headerSave: { color: COLORS.purpleLight, fontSize: 16, fontWeight: '600' },
  headerSaveDisabled: { color: COLORS.textMuted },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { color: COLORS.white, fontSize: 40, fontWeight: '600' },
  avatarEditBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: COLORS.purple,
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  avatarHint: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '500' },

  field: { marginBottom: 18 },
  label: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelCount: { color: COLORS.textMuted, fontSize: 12, marginBottom: 8 },
  helperError: { color: COLORS.error, fontSize: 12, marginTop: 6 },
  helperHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6 },

  lockedField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.inputBg,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 15,
    opacity: 0.7,
  },
  lockedFieldText: { color: COLORS.white, fontSize: 15 },
  lockedFieldHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  bioWrapper: { alignItems: 'flex-start' },
  bioInput: { minHeight: 88, paddingTop: 14 },

  linkRow: { marginBottom: 10 },
  linkInputWrapper: { paddingRight: 4 },
  linkRemove: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  addLinkButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  addLinkButtonDisabled: { opacity: 0.4 },
  addLinkText: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '600' },

  errorBox: {
    backgroundColor: COLORS.errorBg,
    borderColor: COLORS.errorBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  errorBoxTop: { marginTop: 0, marginBottom: 16 },
  errorText: { color: COLORS.error, fontSize: 13 },

  bottomSpacer: { height: 24 },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
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
  sheetRowDestructive: { color: COLORS.error },
  sheetCancel: { marginTop: 8, borderTopWidth: 0 },
  sheetCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
});
