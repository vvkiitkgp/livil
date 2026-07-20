import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { Button } from './Button';
import FormInput from './FormInput';
import { reportComment, type ReportReason } from '../services/comments';
import { useToast } from '../contexts/ToastContext';
import { friendlyErrorMessage } from '../utils/errorMessages';

type Props = {
  visible: boolean;
  commentId: string | null;
  onClose: () => void;
};

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other', label: 'Other' },
];

export default function CommentReportModal({ visible, commentId, onClose }: Props) {
  const { showToast } = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setReason(null);
    setDetails('');
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) { return; }
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!commentId || !reason) { return; }
    if (reason === 'other' && details.trim().length === 0) {
      showToast('Please add details for "Other".', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      await reportComment(commentId, reason, details);
      showToast('Reported. Thanks for letting us know.', { kind: 'success' });
      reset();
      onClose();
    } catch (e) {
      showToast(friendlyErrorMessage(e, "Couldn't submit your report."), { kind: 'error' });
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Report comment</Text>
          <Text style={styles.subtitle}>Why are you reporting this comment?</Text>

          <View style={styles.chips}>
            {REASONS.map(r => {
              const selected = reason === r.value;
              return (
                <TouchableOpacity
                  key={r.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setReason(r.value)}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <FormInput
            value={details}
            onChangeText={setDetails}
            placeholder={reason === 'other' ? 'Tell us more (required)' : 'Add details (optional)'}
            multiline
            numberOfLines={4}
            style={styles.detailsInput}
            editable={!busy}
            wrapperStyle={styles.detailsWrapper}
          />

          <Button
            label="Submit report"
            onPress={handleSubmit}
            variant="primary"
            size="md"
            busy={busy}
            disabled={!reason}
            fullWidth
          />

          <Button
            label="Cancel"
            onPress={handleClose}
            variant="ghost"
            size="md"
            disabled={busy}
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
  detailsWrapper: {
    marginBottom: 16,
  },
  detailsInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  dismiss: {
    marginTop: 10,
  },
});
