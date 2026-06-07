import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../theme/colors';
import FormInput from './FormInput';
import { reportPost, type PostReportReason } from '../services/posts';
import { useToast } from '../contexts/ToastContext';

type Props = {
  visible: boolean;
  postId: string | null;
  onClose: () => void;
};

const REASONS: { value: PostReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other', label: 'Other' },
];

/**
 * Sibling to CommentReportModal — same UX, targets the post_reports table.
 * Kept as a separate component (rather than a generic ReportModal) so the
 * service binding stays explicit and the surfaces can evolve independently.
 */
export default function PostReportModal({ visible, postId, onClose }: Props) {
  const { showToast } = useToast();
  const [reason, setReason] = useState<PostReportReason | null>(null);
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
    if (!postId || !reason) { return; }
    if (reason === 'other' && details.trim().length === 0) {
      showToast('Please add details for "Other".', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      await reportPost(postId, reason, details);
      showToast('Reported. Thanks for letting us know.', { kind: 'success' });
      reset();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not submit report.', { kind: 'error' });
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
          <Text style={styles.title}>Report post</Text>
          <Text style={styles.subtitle}>Why are you reporting this post?</Text>

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

          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnPrimary,
              (!reason || busy) && styles.btnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!reason || busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.btnPrimaryText}>Submit report</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.dismiss} onPress={handleClose} disabled={busy}>
            <Text style={styles.dismissText}>Cancel</Text>
          </TouchableOpacity>
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
  btn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  btnPrimaryText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  dismiss: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 8,
  },
  dismissText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
});
