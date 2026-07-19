import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { AuthStackParamList } from '../../navigation/types';
import FormInput from '../../components/FormInput';
import { Icon } from '../../components/Icon';
import ConfirmActionModal from '../../components/ConfirmActionModal';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
};

type UsernameStatus =
  | 'idle'
  | 'invalid'
  | 'checking'
  | 'available'
  | 'taken'
  | 'error';

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export default function SignUpScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [checkEmailOpen, setCheckEmailOpen] = useState(false);
  const [checkEmailTarget, setCheckEmailTarget] = useState('');
  // 'emailExists' shows an inline "Sign In instead" hint next to the error;
  // 'generic' covers validation / rate-limit / network failures.
  const [errorKind, setErrorKind] = useState<'generic' | 'emailExists'>('generic');

  const cleanedUsername = useMemo(
    () => username.trim().toLowerCase().replace(/^@/, ''),
    [username],
  );

  // Debounced username availability check.
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

  const handleSignUp = async () => {
    setErrorKind('generic');
    if (!displayName.trim() || !cleanedUsername || !email.trim() || !password) {
      setError('Please fill in all fields.');
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
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: 'livil://auth',
          data: {
            display_name: displayName.trim(),
            username: cleanedUsername,
          },
        },
      });
      if (signUpError) {
        const msg = signUpError.message.toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists')) {
          setErrorKind('emailExists');
          setError('An account with this email already exists.');
        } else if (msg.includes('rate limit')) {
          setError('Too many attempts. Please wait a bit and try again.');
        } else {
          setError(signUpError.message);
        }
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        // Supabase's anti-enumeration behavior: a 200 with an empty identities
        // array means this email is already registered and confirmed — no
        // confirmation email is sent in that case.
        setErrorKind('emailExists');
        setError('An account with this email already exists.');
      } else {
        setCheckEmailTarget(email.trim());
        setCheckEmailOpen(true);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Icon name="backArrow" size={20} color={COLORS.white} />
          </TouchableOpacity>

          <View style={styles.titleSection}>
            <Text style={styles.appName}>Livil</Text>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Join the music community today</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              {errorKind === 'emailExists' ? (
                <TouchableOpacity
                  onPress={() => navigation.navigate('SignIn')}
                  activeOpacity={0.7}
                  style={styles.errorHintRow}
                >
                  <Text style={styles.errorHintText}>Sign in instead →</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <View style={styles.form}>
            {/* Display Name + Username side by side */}
            <View style={styles.row}>
              <View style={[styles.fieldGroup, styles.flex]}>
                <Text style={styles.label}>Display Name</Text>
                <FormInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your name"
                  autoCorrect={false}
                />
              </View>

              <View style={[styles.fieldGroup, styles.flex]}>
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
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <FormInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <FormInput
                value={password}
                onChangeText={setPassword}
                placeholder="Min. 6 characters"
                secureTextEntry={!passwordVisible}
                trailing={
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setPasswordVisible(v => !v)}
                    activeOpacity={0.7}
                  >
                    <Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                }
              />
              <Text style={styles.hint}>At least 6 characters</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (loading || usernameStatus === 'checking' || usernameStatus === 'taken' || usernameStatus === 'invalid') && styles.buttonDisabled,
              ]}
              onPress={handleSignUp}
              disabled={loading || usernameStatus === 'checking' || usernameStatus === 'taken' || usernameStatus === 'invalid'}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.termsText}>
              By creating an account you agree to our{' '}
              <Text style={styles.termsLink}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('SignIn')} activeOpacity={0.7}>
              <Text style={styles.footerLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
      </KeyboardAwareScrollView>

      <ConfirmActionModal
        visible={checkEmailOpen}
        title="Check your email"
        message={`We sent a confirmation link to ${checkEmailTarget}. Verify your email to get started.`}
        glyph="✉"
        tone="primary"
        confirmLabel="Go to Sign In"
        cancelLabel={null}
        onConfirm={() => {
          setCheckEmailOpen(false);
          navigation.navigate('SignIn');
        }}
        onCancel={() => setCheckEmailOpen(false)}
      />
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
    return <Text style={[statusStyles.text, statusStyles.muted]}>3–30 letters, numbers, or _</Text>;
  }
  return <Text style={[statusStyles.text, statusStyles.errorText]}>Couldn't verify availability</Text>;
}

const statusStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 12,
    marginTop: -2,
  },
  muted: {
    color: COLORS.textMuted,
  },
  success: {
    color: '#22C55E',
  },
  errorText: {
    color: COLORS.error,
  },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  backButton: {
    marginTop: 8,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backIcon: {
    fontSize: 20,
    color: COLORS.white,
    lineHeight: 22,
  },
  titleSection: {
    marginTop: 32,
    marginBottom: 28,
  },
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
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  errorBox: {
    backgroundColor: COLORS.errorBg,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    lineHeight: 20,
  },
  errorHintRow: {
    marginTop: 8,
  },
  errorHintText: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '700',
  },
  form: {
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldGroup: {
    gap: 7,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  eyeText: {
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: -2,
  },
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
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  termsText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  termsLink: {
    color: COLORS.purpleLight,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 36,
  },
  footerText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: COLORS.purple,
    fontSize: 14,
    fontWeight: '700',
  },
});
