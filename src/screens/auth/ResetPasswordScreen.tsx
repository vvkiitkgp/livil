import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import FormInput from '../../components/FormInput';
import { Icon } from '../../components/Icon';

type Props = {
  /** Called once the password has been updated. */
  onComplete: () => void;
  /** Called when the user backs out — signs them out of the recovery session. */
  onCancel: () => void;
};

export default function ResetPasswordScreen({ onComplete, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
    } else {
      onComplete();
    }
  };

  const handleCancel = () => {
    void supabase.auth.signOut();
    onCancel();
  };

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
          <Text style={styles.title}>Set a new password</Text>
          <Text style={styles.subtitle}>Choose a new password for your account.</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>New Password</Text>
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
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <FormInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter password"
              secureTextEntry={!passwordVisible}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleReset}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Update Password</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Not you? </Text>
          <TouchableOpacity onPress={handleCancel} activeOpacity={0.7}>
            <Text style={styles.footerLink}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
  titleSection: { marginTop: 48, marginBottom: 28 },
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
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
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
