import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Linking, Pressable, StyleSheet, Text } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import { AuthStackParamList } from '../../navigation/types';
import FormInput from '../../components/FormInput';
import { TERMS_URL, PRIVACY_POLICY_URL } from '../../constants/links';
import { Icon } from '../../components/Icon';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { AuthStep, StepButton, StepError, StepField, StepLink } from '../../components/auth/AuthStep';
import {
  UsernameStatusLine,
  cleanUsername,
  usernameReady,
  useUsernameAvailability,
} from '../../components/auth/usernameCheck';
import { stepProblem } from '../../components/auth/signUpSteps';
import { isWeakPasswordError, WEAK_PASSWORD_MESSAGE } from '../../../shared/services/passwordPolicy';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
};

const STEPS = 3;

/**
 * Email sign-up, one question per step (owner's design, 2026-10-19): your name, a
 * username, then email and password. Nothing is created until the last step; then
 * Supabase sends the confirmation link and the account exists once it is tapped. The
 * profile photo is asked for after that first sign-in (AddPhotoScreen) — before then
 * there is no account to save it to.
 */
export default function SignUpScreen({ navigation }: Props) {
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [checkEmailOpen, setCheckEmailOpen] = useState(false);
  const [checkEmailTarget, setCheckEmailTarget] = useState('');
  // 'emailExists' adds a "Sign in instead" link under the error.
  const [errorKind, setErrorKind] = useState<'generic' | 'emailExists'>('generic');

  const cleanedUsername = cleanUsername(username);
  const usernameStatus = useUsernameAvailability(cleanedUsername);

  const back = useCallback(() => {
    setError('');
    if (step > 1) { setStep(s => s - 1); } else { navigation.goBack(); }
  }, [step, navigation]);

  // Android back walks the steps before it leaves the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 1) { return false; }
      back();
      return true;
    });
    return () => sub.remove();
  }, [step, back]);

  const next = useCallback(() => {
    const problem = step === 1
      ? stepProblem({ kind: 'name', displayName })
      : stepProblem({ kind: 'username', username: cleanedUsername, status: usernameStatus });
    if (problem) { setErrorKind('generic'); setError(problem); return; }
    setError('');
    setStep(s => s + 1);
  }, [step, displayName, cleanedUsername, usernameStatus]);

  const handleSignUp = async () => {
    setErrorKind('generic');
    const problem = stepProblem({ kind: 'account', email, password });
    if (problem) { setError(problem); return; }
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
        } else if (isWeakPasswordError(signUpError)) {
          setError(WEAK_PASSWORD_MESSAGE);
        } else if (msg.includes('rate limit')) {
          setError('Too many attempts. Please wait a bit and try again.');
        } else if (msg.includes('sending confirmation email')) {
          // The mail provider refused the address (a typo, or a domain like example.com
          // that takes no mail). Supabase rolls the sign-up back, so nothing is left behind.
          setError("We couldn't send an email to that address. Check it and try again.");
        } else if (msg.includes('username') || msg.includes('duplicate')) {
          // The username went to someone else between the check and now.
          setError('That username was just taken. Go back and pick another.');
        } else {
          setError(signUpError.message);
        }
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        // Supabase's anti-enumeration behaviour: a 200 with no identities means this email
        // is already registered and confirmed — and no confirmation email was sent.
        setErrorKind('emailExists');
        setError('An account with this email already exists.');
      } else {
        setCheckEmailTarget(email.trim());
        setCheckEmailOpen(true);
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const errorBox = error ? (
    <StepError
      message={error}
      action={errorKind === 'emailExists'
        ? <StepLink label="Sign in instead →" onPress={() => navigation.navigate('SignIn')} />
        : undefined}
    />
  ) : null;

  return (
    <>
      {step === 1 ? (
        <AuthStep
          kicker="SIGN UP"
          headline="What's your name?"
          line="This is how friends see you."
          step={1}
          steps={STEPS}
          onBack={back}
          footer={
            <>
              <StepButton label="NEXT →" onPress={next} />
              <StepLink label="Already have an account? Sign in" onPress={() => navigation.navigate('SignIn')} />
            </>
          }
        >
          {errorBox}
          <StepField label="NAME">
            <FormInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={next}
              accessibilityLabel="Your name"
            />
          </StepField>
        </AuthStep>
      ) : step === 2 ? (
        <AuthStep
          kicker="SIGN UP"
          headline="Pick a username"
          line="How friends find you. You can't change it later."
          step={2}
          steps={STEPS}
          onBack={back}
          footer={
            <StepButton
              label="NEXT →"
              onPress={next}
              disabled={!usernameReady(cleanedUsername, usernameStatus)}
            />
          }
        >
          {errorBox}
          <StepField label="USERNAME" below={<UsernameStatusLine status={usernameStatus} />}>
            <FormInput
              value={username}
              onChangeText={setUsername}
              placeholder="handle"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={next}
              accessibilityLabel="Username"
              leading={<Text style={styles.at}>@</Text>}
            />
          </StepField>
        </AuthStep>
      ) : (
        <AuthStep
          kicker="SIGN UP"
          headline="Email and password"
          line="We'll email you a link to confirm."
          step={3}
          steps={STEPS}
          onBack={back}
          footer={
            <>
              <StepButton label="CREATE ACCOUNT" onPress={() => { void handleSignUp(); }} busy={loading} />
              {/* This line is the point of agreement, so what it names must be reachable from it. */}
              <Text style={styles.terms}>
                By creating an account you agree to our{' '}
                <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>Terms</Text>
                {' '}and{' '}
                <Text style={styles.termsLink} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>Privacy Policy</Text>.
              </Text>
            </>
          }
        >
          {errorBox}
          <StepField label="EMAIL">
            <FormInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              autoFocus
              returnKeyType="next"
              accessibilityLabel="Email"
            />
          </StepField>
          <StepField label="PASSWORD" below={<Text style={styles.hint}>8+ characters, with a letter and a number</Text>}>
            <FormInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secureTextEntry={!passwordVisible}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => { void handleSignUp(); }}
              accessibilityLabel="Password"
              trailing={
                <Pressable
                  style={({ pressed }) => [styles.eye, pressed && styles.pressed]}
                  onPress={() => setPasswordVisible(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                >
                  <Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={18} color={COLORS.textSecondary} />
                </Pressable>
              }
            />
          </StepField>
        </AuthStep>
      )}

      <ConfirmActionModal
        visible={checkEmailOpen}
        title="Check your email"
        message={`Tap the link we sent to ${checkEmailTarget}.`}
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
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  at: { paddingLeft: 14, paddingRight: 2, fontSize: 15, color: COLORS.textSecondary },
  eye: { paddingHorizontal: 14, paddingVertical: 12 },
  hint: { fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textSecondary },
  terms: { fontFamily: FONTS.mono, fontSize: 11, lineHeight: 17, color: COLORS.textMuted, textAlign: 'center' },
  termsLink: { color: COLORS.textSecondary, textDecorationLine: 'underline' },
});
