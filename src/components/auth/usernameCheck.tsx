import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { Icon } from '../Icon';

/**
 * The username rules and live availability check shared by both sign-up paths: email
 * (SignUpScreen) and Google / Apple (ChooseUsernameScreen). The database is the real
 * judge — `is_username_available` here, the unique index and `claim_username` on write —
 * this only tells the person early.
 */

export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export type UsernameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';

/** What the person typed, as a username: trimmed, lower case, without a leading @. */
export function cleanUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

const CHECK_DEBOUNCE_MS = 400;

/** Debounced availability of an already-cleaned username. */
export function useUsernameAvailability(cleaned: string): UsernameStatus {
  const [status, setStatus] = useState<UsernameStatus>('idle');

  useEffect(() => {
    if (cleaned.length === 0) { setStatus('idle'); return; }
    if (!USERNAME_RE.test(cleaned)) { setStatus('invalid'); return; }
    setStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      const db = supabase as any;
      const { data, error } = await db.rpc('is_username_available', { p_username: cleaned });
      if (cancelled) { return; }
      setStatus(error ? 'error' : data ? 'available' : 'taken');
    }, CHECK_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cleaned]);

  return status;
}

/**
 * Whether a username may be submitted. A failed availability lookup does not block —
 * the write itself refuses a taken name with a clear error.
 */
export function usernameReady(cleaned: string, status: UsernameStatus): boolean {
  return USERNAME_RE.test(cleaned) && status !== 'taken' && status !== 'checking' && status !== 'invalid';
}

export function UsernameStatusLine({ status }: { status: UsernameStatus }) {
  if (status === 'idle') { return null; }
  if (status === 'checking') {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={COLORS.textSecondary} />
        <Text style={[styles.text, styles.muted]}>Checking…</Text>
      </View>
    );
  }
  if (status === 'available') {
    return (
      <View style={styles.row}>
        <Icon name="check" size={14} color={COLORS.success} weight="bold" />
        <Text style={[styles.text, styles.success]}>Available</Text>
      </View>
    );
  }
  if (status === 'taken') {
    return <Text style={[styles.text, styles.error]}>That username is taken</Text>;
  }
  if (status === 'invalid') {
    return <Text style={[styles.text, styles.muted]}>3–30 letters, numbers or _</Text>;
  }
  return <Text style={[styles.text, styles.error]}>Couldn't check it. You can still try.</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontFamily: FONTS.mono, fontSize: 12 },
  muted: { color: COLORS.textMuted },
  success: { color: COLORS.success },
  error: { color: COLORS.error },
});
