import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { pick, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';

import FormInput from '../../components/FormInput';
import { COLORS } from '../../theme/colors';
import type { RootStackParamList } from '../../navigation/types';
import { getChipStyle, getChipTone, type PendingCollaborator } from '../../constants/roles';
import { createTrack, type CreateTrackStage } from '../../services/tracks';
import type { PickedFile, TrackMediaKind } from '../../services/uploads';
import { onCollaboratorPicked } from '../../services/uploadEvents';

type UploadNavigation = NativeStackNavigationProp<RootStackParamList, 'Upload'>;

type FileSlot = {
  kind: TrackMediaKind;
  label: string;
  description: string;
  required: boolean;
  accept: string;
};

const FILE_SLOTS: FileSlot[] = [
  {
    kind: 'audio',
    label: 'Audio',
    description: 'Required · mp3, wav, m4a, flac, ogg',
    required: true,
    accept: types.audio,
  },
  {
    kind: 'video',
    label: 'Video',
    description: 'Optional · mp4, mov, webm',
    required: false,
    accept: types.video,
  },
  {
    kind: 'cover',
    label: 'Cover art',
    description: 'Optional · jpg, png, webp',
    required: false,
    accept: types.images,
  },
];

function formatBytes(bytes: number | null): string {
  if (bytes == null) {return '';}
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadScreen() {
  const navigation = useNavigation<UploadNavigation>();

  const [audio, setAudio] = useState<PickedFile | null>(null);
  const [video, setVideo] = useState<PickedFile | null>(null);
  const [cover, setCover] = useState<PickedFile | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [progressStage, setProgressStage] = useState<CreateTrackStage>('preparing');
  const [progressFraction, setProgressFraction] = useState(0);

  useEffect(() => {
    const subscription = onCollaboratorPicked(picked => {
      setCollaborators(prev => {
        const dupe =
          picked.kind === 'user' &&
          prev.some(
            c => c.kind === 'user' && c.userId === picked.userId && c.role === picked.role,
          );
        if (dupe) {return prev;}
        return [...prev, picked];
      });
    });
    return () => subscription.remove();
  }, []);

  const handlePickFile = useCallback(
    async (slot: FileSlot) => {
      try {
        const [result] = await pick({ type: [slot.accept] });
        if (!result) {return;}
        const file: PickedFile = {
          uri: result.uri,
          name: result.name,
          type: result.type,
          size: result.size,
        };
        if (slot.kind === 'audio') {setAudio(file);}
        else if (slot.kind === 'video') {setVideo(file);}
        else {setCover(file);}
        setError('');
      } catch (err) {
        if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {return;}
        const message = err instanceof Error ? err.message : 'Failed to pick file.';
        setError(message);
      }
    },
    [],
  );

  const handleClearFile = useCallback((kind: TrackMediaKind) => {
    if (kind === 'audio') {setAudio(null);}
    else if (kind === 'video') {setVideo(null);}
    else {setCover(null);}
  }, []);

  const handleAddCollaborator = useCallback(() => {
    const excludeUserIds = collaborators
      .filter(c => c.kind === 'user' && c.userId)
      .map(c => c.userId!) as string[];
    navigation.navigate('CollaboratorPicker', { excludeUserIds });
  }, [collaborators, navigation]);

  const handleRemoveCollaborator = useCallback((clientId: string) => {
    setCollaborators(prev => prev.filter(c => c.clientId !== clientId));
  }, []);

  const fileFor = useCallback(
    (kind: TrackMediaKind): PickedFile | null => {
      if (kind === 'audio') {return audio;}
      if (kind === 'video') {return video;}
      return cover;
    },
    [audio, video, cover],
  );

  const canSubmit = useMemo(
    () => Boolean(audio && title.trim().length > 0) && !submitting,
    [audio, title, submitting],
  );

  const handleSubmit = useCallback(async () => {
    if (!audio || !title.trim()) {
      setError('Add an audio file and a title to continue.');
      return;
    }
    setSubmitting(true);
    setError('');
    setProgressStage('preparing');
    setProgressFraction(0);
    try {
      await createTrack(
        {
          title,
          description,
          audio,
          video: video ?? undefined,
          cover: cover ?? undefined,
          collaborators,
        },
        ({ stage, fraction }) => {
          setProgressStage(stage);
          setProgressFraction(fraction);
        },
      );
      Alert.alert('Posted', 'Your track is live.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [audio, title, description, video, cover, collaborators, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          disabled={submitting}
          style={styles.headerSide}
        >
          <Text style={[styles.headerCancel, submitting && styles.disabledText]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New track</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>Files</Text>
          <View style={styles.filesGroup}>
            {FILE_SLOTS.map(slot => {
              const file = fileFor(slot.kind);
              return (
                <View key={slot.kind} style={styles.fileRow}>
                  <View style={styles.fileText}>
                    <Text style={styles.fileLabel}>
                      {slot.label}
                      {slot.required ? (
                        <Text style={styles.fileRequired}> *</Text>
                      ) : null}
                    </Text>
                    {file ? (
                      <Text style={styles.fileFilename} numberOfLines={1}>
                        {file.name ?? 'Selected file'}
                        {file.size != null ? `  ·  ${formatBytes(file.size)}` : ''}
                      </Text>
                    ) : (
                      <Text style={styles.fileDescription}>{slot.description}</Text>
                    )}
                  </View>
                  {file ? (
                    <View style={styles.fileActions}>
                      <TouchableOpacity
                        onPress={() => handlePickFile(slot)}
                        activeOpacity={0.7}
                        disabled={submitting}
                        style={styles.fileActionSecondary}
                      >
                        <Text style={styles.fileActionSecondaryText}>Change</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleClearFile(slot.kind)}
                        activeOpacity={0.7}
                        disabled={submitting}
                        style={styles.fileActionGhost}
                      >
                        <Text style={styles.fileActionGhostText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handlePickFile(slot)}
                      activeOpacity={0.85}
                      disabled={submitting}
                      style={styles.fileActionPrimary}
                    >
                      <Text style={styles.fileActionPrimaryText}>Choose</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Track details</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Title</Text>
            <FormInput
              value={title}
              onChangeText={setTitle}
              placeholder="Name your track"
              maxLength={120}
              editable={!submitting}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Description</Text>
            <FormInput
              value={description}
              onChangeText={setDescription}
              placeholder="Tell people about this track"
              multiline
              maxLength={2000}
              editable={!submitting}
              wrapperStyle={styles.descriptionWrapper}
              style={styles.descriptionInput}
            />
          </View>

          <View style={styles.collabHeader}>
            <Text style={styles.sectionLabel}>Collaborators</Text>
            <TouchableOpacity
              onPress={handleAddCollaborator}
              activeOpacity={0.85}
              disabled={submitting}
              style={styles.addCollabButton}
            >
              <Text style={styles.addCollabButtonText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {collaborators.length === 0 ? (
            <Text style={styles.collabEmpty}>
              Tag people who played on this track. They'll get a request to confirm — once they
              accept, the post lands on their profile too. You can also add custom names for folks
              who aren't on Livil yet.
            </Text>
          ) : (
            <View style={styles.chipsWrap}>
              {collaborators.map(c => {
                const tone = getChipTone(c.kind, 'pending');
                const palette = getChipStyle(tone);
                return (
                  <View
                    key={c.clientId}
                    style={[
                      styles.chip,
                      { backgroundColor: palette.bg, borderColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
                      <Text style={styles.chipName}>{c.name}</Text>
                      <Text style={styles.chipDivider}>  ·  </Text>
                      <Text>{c.role}</Text>
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleRemoveCollaborator(c.clientId)}
                      activeOpacity={0.7}
                      disabled={submitting}
                      style={styles.chipRemove}
                      accessibilityLabel={`Remove ${c.name}`}
                    >
                      <Text style={[styles.chipRemoveText, { color: palette.text }]}>×</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.chipLegend}>
            <View style={styles.legendRow}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: getChipStyle('pending').border },
                ]}
              />
              <Text style={styles.legendText}>Waiting on Livil user</Text>
            </View>
            <View style={styles.legendRow}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: getChipStyle('custom').border },
                ]}
              />
              <Text style={styles.legendText}>Not on Livil yet</Text>
            </View>
            <View style={styles.legendRow}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: getChipStyle('accepted').border },
                ]}
              />
              <Text style={styles.legendText}>Accepted (after they confirm)</Text>
            </View>
          </View>

          <View style={styles.scrollSpacer} />
        </ScrollView>

        <View style={styles.footer}>
          {submitting ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressLabel}>
                  {progressStage === 'preparing'
                    ? 'Preparing files…'
                    : progressStage === 'finalizing'
                    ? 'Saving track…'
                    : 'Uploading…'}
                </Text>
                <Text style={styles.progressPercent}>
                  {progressStage === 'uploading'
                    ? `${Math.round(progressFraction * 100)}%`
                    : ''}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width:
                        progressStage === 'uploading'
                          ? `${Math.max(2, Math.round(progressFraction * 100))}%`
                          : progressStage === 'finalizing'
                          ? '100%'
                          : '6%',
                    },
                  ]}
                />
              </View>
              {progressStage !== 'uploading' ? (
                <ActivityIndicator color={COLORS.purpleLight} style={styles.progressSpinner} />
              ) : null}
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={!canSubmit}
              style={[styles.postButton, !canSubmit && styles.postButtonDisabled]}
            >
              <Text style={styles.postButtonText}>Post track</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerSide: {
    minWidth: 64,
  },
  headerCancel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  disabledText: {
    opacity: 0.5,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
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
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  filesGroup: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  fileText: {
    flex: 1,
  },
  fileLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
  fileRequired: {
    color: COLORS.purpleLight,
  },
  fileDescription: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  fileFilename: {
    color: COLORS.purpleLight,
    fontSize: 12,
    marginTop: 3,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  fileActionPrimary: {
    backgroundColor: COLORS.purple,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  fileActionPrimaryText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  fileActionSecondary: {
    backgroundColor: COLORS.purpleDim,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.purple,
  },
  fileActionSecondaryText: {
    color: COLORS.purpleLight,
    fontSize: 12,
    fontWeight: '700',
  },
  fileActionGhost: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  fileActionGhostText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  fieldGroup: {
    gap: 7,
    marginBottom: 16,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  descriptionWrapper: {
    alignItems: 'flex-start',
  },
  descriptionInput: {
    minHeight: 100,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  collabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 10,
  },
  addCollabButton: {
    backgroundColor: COLORS.purpleDim,
    borderWidth: 1,
    borderColor: COLORS.purple,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  addCollabButtonText: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '700',
  },
  collabEmpty: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 220,
  },
  chipName: {
    fontWeight: '800',
  },
  chipDivider: {
    fontWeight: '400',
  },
  chipRemove: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipRemoveText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  chipLegend: {
    marginTop: 4,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  scrollSpacer: {
    height: 24,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  postButton: {
    backgroundColor: COLORS.purple,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  postButtonDisabled: {
    opacity: 0.5,
  },
  postButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  progressBlock: {
    gap: 10,
    paddingVertical: 6,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  progressPercent: {
    color: COLORS.purpleLight,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 44,
    textAlign: 'right',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.purple,
    borderRadius: 4,
  },
  progressSpinner: {
    alignSelf: 'center',
    marginTop: 2,
  },
});
