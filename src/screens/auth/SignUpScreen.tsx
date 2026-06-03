import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { AuthStackParamList } from '../../navigation/types';
import FormInput from '../../components/FormInput';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
};

export default function SignUpScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);

  const handleSignUp = async () => {
    if (!displayName.trim() || !username.trim() || !email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: 'livil://auth',
        data: {
          display_name: displayName.trim(),
          username: username.trim().toLowerCase().replace(/^@/, ''),
        },
      },
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
    } else {
      Alert.alert(
        'Check your email ✉️',
        `We sent a confirmation link to ${email.trim()}. Please verify your email to get started.`,
        [{ text: 'Go to Sign In', onPress: () => navigation.navigate('SignIn') }],
      );
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
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>

          <View style={styles.titleSection}>
            <Text style={styles.appName}>Livil</Text>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Join the music community today</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
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
                    <Text style={styles.eyeText}>{passwordVisible ? '🙈' : '👁'}</Text>
                  </TouchableOpacity>
                }
              />
              <Text style={styles.hint}>At least 6 characters</Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
              onPress={handleSignUp}
              disabled={loading}
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
    </SafeAreaView>
  );
}

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
