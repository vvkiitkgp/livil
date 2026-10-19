import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { claimUsername, getMyProfile } from '../../services/profileService';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/fonts';
import FormInput from '../../components/FormInput';
import { Icon } from '../../components/Icon';
import { AuthStep, StepButton, StepError, StepField, StepLink } from '../../components/auth/AuthStep';
import {
  UsernameStatusLine,
  cleanUsername,
  usernameReady,
  useUsernameAvailability,
} from '../../components/auth/usernameCheck';
import { stepProblem } from '../../components/auth/signUpSteps';

type Props = {
  /** Verified email from Google / Apple — shown, never editable. */
  email?: string | null;
  /** Display name prefilled from Google (editable). */
  displayName?: string | null;
  /**
   * Whether to ask for a name. FALSE for Sign in with Apple: App Review
   * (guideline 4) rejects asking for a name or email the Apple sheet already
   * covered — even when the user chose not to share it. The display name then
   * comes from the one Apple gave us (seeded at sign-in, see appleAuth.ts) or
   * falls back to the username; it can be changed later in Edit Profile.
   */
  askForName?: boolean;
  /** Needed to read back the Apple-seeded display name when `askForName` is false. */
  userId?: string | null;
  /** Called once the account has been finalized with a username. */
  onComplete: () => void;
};

/**
 * "Almost done" for a Google or Apple sign-up, in the same steps as email sign-up
 * (owner's design, 2026-10-19): your name (filled in from Google; skipped for Apple),
 * then a username. The email and password step does not exist here — the provider
 * already verified the email. The photo step follows (AddPhotoScreen); the Google photo
 * is not used for it, the person is asked.
 */
export default function ChooseUsernameScreen({
  email,
  displayName: initialDisplayName,
  askForName = true,
  userId,
  onComplete,
}: Props) {
  const steps = askForName ? 2 : 1;
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState(initialDisplayName?.trim() ?? '');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cleanedUsername = cleanUsername(username);
  const usernameStatus = useUsernameAvailability(cleanedUsername);
  const onUsernameStep = step === steps;

  // Android back: from the username step back to the name; on the first step there is
  // nothing before it (this is a gate, not a stack screen), so it is swallowed.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 1) { setError(''); setStep(s => s - 1); }
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const nextFromName = useCallback(() => {
    const problem = stepProblem({ kind: 'name', displayName });
    if (problem) { setError(problem); return; }
    setError('');
    setStep(2);
  }, [displayName]);

  const handleCreate = async () => {
    if (askForName) {
      const nameProblem = stepProblem({ kind: 'name', displayName });
      if (nameProblem) { setError(nameProblem); setStep(1); return; }
    }
    const problem = stepProblem({ kind: 'username', username: cleanedUsername, status: usernameStatus });
    if (problem) { setError(problem); return; }
    setLoading(true);
    setError('');
    try {
      await claimUsername(
        cleanedUsername,
        askForName ? displayName : await appleDisplayName(userId, email, cleanedUsername),
      );
      onComplete();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create your account. Please try again.');
      setLoading(false);
    }
  };

  const signOut = () => { void supabase.auth.signOut(); };
  const errorBox = error ? <StepError message={error} /> : null;

  const emailChip = email ? (
    <View style={styles.chip} accessible accessibilityLabel={`Signed in as ${email}, verified`}>
      <Icon name="email" size={14} color={COLORS.purpleLight} />
      <Text style={styles.chipText} numberOfLines={1}>{email}</Text>
      <Icon name="check" size={13} color={COLORS.success} weight="bold" />
    </View>
  ) : null;

  if (!onUsernameStep) {
    return (
      <AuthStep
        kicker="ALMOST DONE"
        headline="What's your name?"
        line="This is how friends see you."
        step={1}
        steps={steps}
        footer={
          <>
            <StepButton label="NEXT →" onPress={nextFromName} />
            <StepLink label="Not you? Sign out" onPress={signOut} />
          </>
        }
      >
        {emailChip}
        {errorBox}
        <StepField label="NAME" below={initialDisplayName ? <Text style={styles.hint}>From your Google account. Change it if you like.</Text> : undefined}>
          <FormInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={nextFromName}
            accessibilityLabel="Your name"
          />
        </StepField>
      </AuthStep>
    );
  }

  return (
    <AuthStep
      kicker="ALMOST DONE"
      headline="Pick a username"
      line="How friends find you. You can't change it later."
      step={steps}
      steps={steps}
      onBack={steps > 1 ? () => { setError(''); setStep(1); } : undefined}
      footer={
        <>
          <StepButton
            label="NEXT →"
            onPress={() => { void handleCreate(); }}
            busy={loading}
            disabled={!usernameReady(cleanedUsername, usernameStatus)}
          />
          {/* With no name step (Apple), this is the first screen: keep the way out here. */}
          {steps === 1 ? <StepLink label="Not you? Sign out" onPress={signOut} /> : null}
        </>
      }
    >
      {steps === 1 ? emailChip : null}
      {errorBox}
      <StepField label="USERNAME" below={<UsernameStatusLine status={usernameStatus} />}>
        <FormInput
          value={username}
          onChangeText={setUsername}
          placeholder="handle"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => { void handleCreate(); }}
          accessibilityLabel="Username"
          leading={<Text style={styles.at}>@</Text>}
        />
      </StepField>
    </AuthStep>
  );
}

/**
 * The display name to claim with for a Sign in with Apple account.
 *
 * `undefined` keeps what the profile already holds — `claim_username` coalesces
 * a missing name to the current one — which is right when appleAuth.ts seeded
 * the name Apple shared. Without that seed the profile holds `handle_new_user`'s
 * email-prefix fallback, which for "Hide My Email" is a relay id like
 * `8kd93jf0q1`; the chosen username is a far better name than that.
 */
async function appleDisplayName(
  userId: string | null | undefined,
  email: string | null | undefined,
  username: string,
): Promise<string | undefined> {
  if (!userId) { return username; }
  try {
    const current = (await getMyProfile(userId)).display_name?.trim() ?? '';
    const emailPrefix = email?.split('@')[0] ?? '';
    return !current || current === emailPrefix ? username : undefined;
  } catch {
    // Unreadable profile: the username is a safe name; never block account creation.
    return username;
  }
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  chipText: { flexShrink: 1, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.purpleLight },
  hint: { fontFamily: FONTS.mono, fontSize: 12, color: COLORS.textSecondary },
  at: { paddingLeft: 14, paddingRight: 2, fontSize: 15, color: COLORS.textSecondary },
});
