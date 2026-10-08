import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import FormInput from './FormInput';
import {
  EXIT_NOTE_MAX,
  EXIT_REASONS,
  type ExitReasonId,
} from '../../shared/constants/exitFeedback';

type Props = {
  visible: boolean;
  /** Called with whatever was given — both may be empty, which means "skipped". */
  onConfirm: (reason: ExitReasonId | null, note: string) => void;
  onCancel: () => void;
};

/**
 * The last step before an account is deleted: an OPTIONAL "why are you leaving?".
 *
 * Shown after the user has already typed DELETE, so it doubles as the final confirm —
 * the red button here is what actually deletes. Nothing is required: tapping it with no
 * reason and no note deletes exactly as before, and the answer is sent fail-safe
 * (`submitExitFeedback` never throws), so this can never stand between someone and
 * deleting their account.
 *
 * Layout follows PostReportModal (chips + optional note).
 */
export default function ExitFeedbackModal({ visible, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<ExitReasonId | null>(null);
  const [note, setNote] = useState('');

  // Fresh form every time it opens — backing out and reopening should not resubmit an
  // answer the user may have meant to abandon.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote('');
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      {/* keyboard-controller's KeyboardAvoidingView, not React Native's: the app runs
          under KeyboardProvider (edge-to-edge IME handling), and RN's `behavior="height"`
          fought it on Android — the card flickered as it resized against stale keyboard
          frames. `navigationBarTranslucent` alongside `statusBarTranslucent` is what lets
          the library measure the modal's own window on Android. */}
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Before you go</Text>
          <Text style={styles.subtitle}>
            Why are you leaving? This is optional — it helps us make Livil better.
          </Text>

          <View style={styles.chips}>
            {EXIT_REASONS.map(r => {
              const selected = reason === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.chip, selected && styles.chipSelected]}
                  // Tapping the chosen reason again clears it: "optional" has to stay
                  // true after a stray tap.
                  onPress={() => setReason(selected ? null : r.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <FormInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything else? Please leave out personal details"
            multiline
            numberOfLines={3}
            maxLength={EXIT_NOTE_MAX}
            style={styles.noteInput}
            wrapperStyle={styles.noteWrapper}
            accessibilityLabel="Anything else you want to tell us"
          />

          {/* Said before they answer, not after: the delete screen promises everything
              goes, and this is the one thing that stays. */}
          <Text style={styles.privacy}>
            Your answer is kept without your name after your account is deleted.
          </Text>

          <Button
            label="Delete my account"
            onPress={() => onConfirm(reason, note)}
            variant="destructive"
            size="md"
            fullWidth
            haptic="warning"
          />

          <Button
            label="Cancel"
            onPress={onCancel}
            variant="ghost"
            size="md"
            fullWidth
            style={styles.dismiss}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.inputBg,
  },
  chipSelected: {
    borderColor: COLORS.purple,
    backgroundColor: COLORS.purpleDim,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: COLORS.purpleLight,
  },
  noteWrapper: {
    marginBottom: 10,
  },
  noteInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  privacy: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 16,
  },
  dismiss: {
    marginTop: 10,
  },
});
