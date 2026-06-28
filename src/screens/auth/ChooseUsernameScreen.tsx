import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { claimUsername } from '../../services/profileService';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import { Icon } from '../../components/Icon';

type Props = {
  /** Verified Google email — shown locked, never editable. */
  email?: string | null;
  /** Display name prefilled from Google (editable). */
  displayName?: string | null;
  /** Google profile photo, if any. */
  avatarUrl?: string | null;
  /** Called once the account has been finalized with a username. */
  onComplete: () => void;
};

type UsernameStatus =
  | 'idle'
  | 'invalid'
  | 'checking'
  | 'available'
  | 'taken'
  | 'error';

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const SUCCESS_GREEN = '#22C55E';

export default function ChooseUsernameScreen({
  email,
  displayName: initialDisplayName,
  avatarUrl,
  onComplete,
}: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName?.trim() ?? '');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');

  const cleanedUsername = useMemo(
    () => username.trim().toLowerCase().replace(/^@/, ''),
    [username],
  );

  // Debounced availability check (mirrors SignUpScreen).
  useEffect(() => {
    if (cleanedUsername.length === 0) {
      setUsernameStatus('idle');
      return;
    }
    if (!USERNAME_RE.test(cleanedUsername)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error: rpcError } = await db.rpc('is_username_available', {
        p_username: cleanedUsername,
      });
      if (cancelled) { return; }
      if (rpcError) {
        setUsernameStatus('error');
        return;
      }
      setUsernameStatus(data ? 'available' : 'taken');
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cleanedUsername]);

  const handleCreate = async () => {
    if (!displayName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!USERNAME_RE.test(cleanedUsername)) {
      setError('Username must be 3–30 characters: letters, numbers, underscore.');
      return;
    }
    if (usernameStatus === 'taken') {
      setError('That username is taken. Please choose another.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await claimUsername(cleanedUsername, displayName);
      onComplete();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create your account. Please try again.');
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    void supabase.auth.signOut();
  };

  const createDisabled =
    loading ||
    usernameStatus === 'checking' ||
    usernameStatus === 'taken' ||
    usernameStatus === 'invalid' ||
    cleanedUsername.length === 0 ||
    displayName.trim().length === 0;

  const initial = (displayName.trim()[0] || email?.trim()[0] || '♪').toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleSection}>
          <Text style={styles.appName}>Livil</Text>
          <Text style={styles.title}>Finish your account</Text>
          <Text style={styles.subtitle}>
            Choose a username — this is permanent and can't be changed later.
          </Text>
        </View>

        {/* Avatar from Google */}
        <View style={styles.avatarWrap}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          {/* Verified, locked email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.lockedField}>
              <Text style={styles.lockedText} numberOfLines={1}>
                {email ?? '—'}
              </Text>
              <View style={styles.verifiedPill}>
                <Icon name="check" size={12} color={SUCCESS_GREEN} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Name</Text>
            <FormInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              autoCorrect={false}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Username</Text>
            <FormInput
              value={username}
              onChangeText={setUsername}
              placeholder="@handle"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <UsernameStatusLine status={usernameStatus} />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, createDisabled && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={createDisabled}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Not you? </Text>
          <TouchableOpacity onPress={handleSignOut} activeOpacity={0.7}>
            <Text style={styles.footerLink}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function UsernameStatusLine({ status }: { status: UsernameStatus }) {
  if (status === 'idle') { return null; }
  if (status === 'checking') {
    return (
      <View style={statusStyles.row}>
        <ActivityIndicator size="small" color={COLORS.textSecondary} />
        <Text style={[statusStyles.text, statusStyles.muted]}>Checking…</Text>
      </View>
    );
  }
  if (status === 'available') {
    return <Text style={[statusStyles.text, statusStyles.success]}>✓ Available</Text>;
  }
  if (status === 'taken') {
    return <Text style={[statusStyles.text, statusStyles.errorText]}>Username taken</Text>;
  }
  if (status === 'invalid') {
    return <Text style={[statusStyles.text, statusStyles.errorText]}>Use 3–30 lowercase letters, numbers, or _</Text>;
  }
  return <Text style={[statusStyles.text, statusStyles.errorText]}>Couldn't verify availability</Text>;
}

const statusStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: 12, marginTop: -2 },
  muted: { color: COLORS.textMuted },
  success: { color: '#22C55E' },
  errorText: { color: COLORS.error },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
  titleSection: { marginTop: 48, marginBottom: 20 },
  appName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.purple,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, lineHeight: 22 },
  avatarWrap: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: {
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatarInitial: { fontSize: 36, fontWeight: '800', color: COLORS.purple },
  errorBox: {
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: { color: COLORS.error, fontSize: 14, lineHeight: 20 },
  form: { gap: 16 },
  fieldGroup: { gap: 7 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  lockedField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 10,
  },
  lockedText: { flex: 1, color: COLORS.textSecondary, fontSize: 15 },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  verifiedText: { color: SUCCESS_GREEN, fontSize: 11, fontWeight: '700' },
  primaryButton: {
    backgroundColor: COLORS.purple,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 36,
  },
  footerText: { color: COLORS.textSecondary, fontSize: 14 },
  footerLink: { color: COLORS.purple, fontSize: 14, fontWeight: '700' },
});
