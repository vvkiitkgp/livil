import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { pick, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';

import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from '../../components/MediaPlayer';
import FormInput from '../../components/FormInput';
import { Button } from '../../components/Button';
import { COLORS } from '../../theme/colors';
import { GradientBorder } from '../../components/GradientBorder';
import type { RootStackParamList } from '../../navigation/types';
import { getChipStyle, getChipTone, type PendingCollaborator } from '../../constants/roles';
import { createTrack, type CreateTrackStage, type PostMode } from '../../services/tracks';
import { addTrackToAlbum } from '../../services/albums';
import { MAX_UPLOAD_BYTES, tooLargeMessage } from '../../services/uploads';
import type { PickedFile, TrackMediaKind } from '../../services/uploads';
import { onCollaboratorPicked } from '../../services/uploadEvents';
import { Icon } from '../../components/Icon';
import AddToAlbumSheet from '../../components/AddToAlbumSheet';

type UploadNavigation = NativeStackNavigationProp<RootStackParamList, 'Upload'>;

type FileSlot = {
  kind: TrackMediaKind;
  label: string;
  description: string;
  required: boolean;
  accept: string;
};

const AUDIO_SLOTS: FileSlot[] = [
  {
    kind: 'audio',
    label: 'Audio',
    description: 'Required · mp3, wav, m4a, flac, ogg',
    required: true,
    accept: types.audio,
  },
  {
    kind: 'cover',
    label: 'Cover image',
    description: 'Required · jpg, png, webp',
    required: true,
    accept: types.images,
  },
];

const VIDEO_SLOTS: FileSlot[] = [
  {
    kind: 'video',
    label: 'Video',
    description: 'Required · mp4, mov, webm',
    required: true,
    accept: types.video,
  },
  {
    kind: 'thumbnail',
    label: 'Thumbnail',
    description: 'Required · jpg, png, webp · shown in feed',
    required: true,
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

  const [mode, setMode] = useState<PostMode>('audio');
  const [audio, setAudio] = useState<PickedFile | null>(null);
  const [video, setVideo] = useState<PickedFile | null>(null);
  const [cover, setCover] = useState<PickedFile | null>(null);
  const [thumbnail, setThumbnail] = useState<PickedFile | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<{ id: string; title: string } | null>(null);
  const [albumSheetOpen, setAlbumSheetOpen] = useState(false);
  const [error, setError] = useState('');
  const [progressStage, setProgressStage] = useState<CreateTrackStage>('preparing');
  const [progressFraction, setProgressFraction] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [previewPaused, setPreviewPaused] = useState(true);
  // Captured from the preview player's onLoad — the picked file's length in
  // seconds — so we can persist duration_seconds at upload (feed/profile cards
  // read it to show the track length before the post is ever played).
  const [previewDurationSec, setPreviewDurationSec] = useState<number | null>(null);
  const previewRef = useRef<MediaPlayerHandle>(null);

  const handlePreviewEnded = useCallback(() => {
    setPreviewPaused(true);
    previewRef.current?.seek(0);
  }, []);

  const previewMedia: MediaShape | null = useMemo(() => {
    if (mode === 'audio') {
      if (!audio) {return null;}
      return { kind: 'audio', audioUrl: audio.uri, coverUrl: cover?.uri ?? null };
    }
    if (!video) {return null;}
    return { kind: 'video', videoUrl: video.uri };
  }, [mode, audio, cover, video]);

  const fileSlots = mode === 'audio' ? AUDIO_SLOTS : VIDEO_SLOTS;

  const handleModeChange = useCallback(
    (next: PostMode) => {
      if (submitting || next === mode) {return;}
      setMode(next);
      setError('');
      // Drop files that don't belong in the new mode so we never carry stale state into createTrack.
      if (next === 'audio') {
        setVideo(null);
        setThumbnail(null);
      } else {
        setAudio(null);
      }
    },
    [mode, submitting],
  );

  const collaboratorCount = collaborators.length;
  const handleDismissSuccess = useCallback(() => {
    setShowSuccess(false);
    navigation.goBack();
  }, [navigation]);

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

  useEffect(() => { setPreviewPaused(true); setPreviewDurationSec(null); }, [previewMedia]);

  useFocusEffect(
    useCallback(() => () => { setPreviewPaused(true); }, []),
  );

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
        // Catch oversized files up front — the free-plan storage limit would reject them anyway,
        // and telling the user now beats letting them wait through a doomed upload.
        if (file.size != null && file.size > MAX_UPLOAD_BYTES) {
          setError(tooLargeMessage(slot.kind));
          return;
        }
        if (slot.kind === 'audio') {setAudio(file);}
        else if (slot.kind === 'video') {setVideo(file);}
        else if (slot.kind === 'thumbnail') {setThumbnail(file);}
        else {
          setCover(file);
        }
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
    else if (kind === 'thumbnail') {setThumbnail(null);}
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
      if (kind === 'thumbnail') {return thumbnail;}
      return cover;
    },
    [audio, video, cover, thumbnail],
  );

  const canSubmit = useMemo(() => {
    if (submitting || title.trim().length === 0) {return false;}
    if (mode === 'audio') {return Boolean(audio && cover);}
    return Boolean(video && thumbnail);
  }, [mode, audio, cover, video, thumbnail, title, submitting]);

  const handleSubmit = useCallback(async () => {
    setPreviewPaused(true);
    if (!title.trim()) {
      setError('Add a title to continue.');
      return;
    }
    if (mode === 'audio') {
      if (!audio || !cover) {
        setError('Audio posts need an audio file and a cover image.');
        return;
      }
    } else {
      if (!video) {
        setError('Video posts need a video file.');
        return;
      }
      if (!thumbnail) {
        setError('Video posts need a thumbnail image.');
        return;
      }
    }
    setSubmitting(true);
    setError('');
    setProgressStage('preparing');
    setProgressFraction(0);
    try {
      const result = await createTrack(
        mode === 'audio'
          ? {
              mode: 'audio',
              title,
              description,
              audio: audio!,
              cover: cover!,
              collaborators,
              durationSeconds: previewDurationSec,
            }
          : {
              mode: 'video',
              title,
              description,
              video: video!,
              cover: cover ?? undefined,
              thumbnail: thumbnail!,
              collaborators,
              durationSeconds: previewDurationSec,
            },
        ({ stage, fraction }) => {
          setProgressStage(stage);
          setProgressFraction(fraction);
        },
      );
      // Tag into the selected album if the user picked one. Fire-and-forget —
      // a failed album tag shouldn't block the success state of the upload.
      if (selectedAlbum && result?.trackId) {
        addTrackToAlbum(selectedAlbum.id, result.trackId).catch(() => {});
      }
      setShowSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [mode, audio, title, description, video, cover, thumbnail, collaborators, previewDurationSec, selectedAlbum]);

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

      <KeyboardAwareScrollView
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

          <Text style={styles.sectionLabel}>Post type</Text>
          <View style={styles.modeSegment}>
            <TouchableOpacity
              onPress={() => handleModeChange('audio')}
              activeOpacity={0.85}
              disabled={submitting}
              style={[
                styles.modeSegmentButton,
                mode === 'audio' && styles.modeSegmentButtonActive,
              ]}
            >
              {mode === 'audio' ? <GradientBorder borderRadius={14} /> : null}
              <Text
                style={[
                  styles.modeSegmentLabel,
                  mode === 'audio' && styles.modeSegmentLabelActive,
                ]}
              >
                Audio + Cover
              </Text>
              <Text
                style={[
                  styles.modeSegmentSubLabel,
                  mode === 'audio' && styles.modeSegmentSubLabelActive,
                ]}
              >
                A song with a cover image
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleModeChange('video')}
              activeOpacity={0.85}
              disabled={submitting}
              style={[
                styles.modeSegmentButton,
                mode === 'video' && styles.modeSegmentButtonActive,
              ]}
            >
              {mode === 'video' ? <GradientBorder borderRadius={14} /> : null}
              <Text
                style={[
                  styles.modeSegmentLabel,
                  mode === 'video' && styles.modeSegmentLabelActive,
                ]}
              >
                Video
              </Text>
              <Text
                style={[
                  styles.modeSegmentSubLabel,
                  mode === 'video' && styles.modeSegmentSubLabelActive,
                ]}
              >
                A music video — audio is baked in
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Files</Text>
          <View style={styles.filesGroup}>
            {fileSlots.map(slot => {
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
                      <Button
                        label="Change"
                        size="sm"
                        variant="secondary"
                        onPress={() => handlePickFile(slot)}
                        disabled={submitting}
                      />
                      <Button
                        label="Remove"
                        size="sm"
                        variant="ghost"
                        onPress={() => handleClearFile(slot.kind)}
                        disabled={submitting}
                      />
                    </View>
                  ) : (
                    <Button
                      label="Choose"
                      size="sm"
                      variant="primary"
                      onPress={() => handlePickFile(slot)}
                      disabled={submitting}
                    />
                  )}
                </View>
              );
            })}
          </View>

          {previewMedia ? (
            <>
              <Text style={styles.sectionLabel}>Preview</Text>
              <View style={styles.previewCard}>
                <MediaPlayer
                  ref={previewRef}
                  postId="upload_preview"
                  media={previewMedia}
                  paused={previewPaused}
                  onTogglePaused={() => setPreviewPaused(p => !p)}
                  onLoaded={setPreviewDurationSec}
                  onEnded={handlePreviewEnded}
                  visible
                  pauseWhenOffScreen={false}
                />
                {title.trim() ? (
                  <View style={styles.previewTrackInfo}>
                    <Text style={styles.previewTitle} numberOfLines={1}>
                      {title}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {mode === 'video' && thumbnail ? (
            <>
              <Text style={styles.sectionLabel}>Feed thumbnail</Text>
              <View style={styles.previewCard}>
                <Image
                  source={{ uri: thumbnail.uri }}
                  style={styles.thumbnailPreview}
                  resizeMode="cover"
                />
              </View>
            </>
          ) : null}

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

          {/* Add to album · optional — creators can group this upload with
              their other tracks. Picker lists their existing albums. */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Add to album · optional</Text>
            <TouchableOpacity
              style={styles.albumRow}
              onPress={() => setAlbumSheetOpen(true)}
              disabled={submitting}
              activeOpacity={0.75}
            >
              <Icon name="disc" size={18} color={selectedAlbum ? COLORS.purpleLight : COLORS.textSecondary} />
              <View style={styles.albumRowMeta}>
                {selectedAlbum ? (
                  <>
                    <Text style={styles.albumRowMini}>SELECTED</Text>
                    <Text style={styles.albumRowTitle} numberOfLines={1}>{selectedAlbum.title}</Text>
                  </>
                ) : (
                  <Text style={styles.albumRowPlaceholder}>Pick album or create new</Text>
                )}
              </View>
              {selectedAlbum ? (
                <TouchableOpacity
                  onPress={() => setSelectedAlbum(null)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  disabled={submitting}
                >
                  <Icon name="close" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ) : (
                <Icon name="forward" size={16} color={COLORS.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.collabHeader}>
            <Text style={styles.sectionLabel}>Collaborators</Text>
            <TouchableOpacity
              onPress={handleAddCollaborator}
              activeOpacity={0.85}
              disabled={submitting}
              style={styles.addCollabButton}
            >
              <GradientBorder borderRadius={999} />
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
                      <Icon name="close" size={18} color={palette.text} />
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
      </KeyboardAwareScrollView>

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
            <Button
              label="Post track"
              onPress={() => void handleSubmit()}
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canSubmit}
            />
          )}
        </View>

      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleDismissSuccess}
      >
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successGlow} />
            <View style={styles.successIconOuter}>
              <View style={styles.successIconInner}>
                <Icon name="check" size={30} color={COLORS.white} />
              </View>
            </View>
            <Text style={styles.successTitle}>Track posted</Text>
            <Text style={styles.successBody}>
              {collaboratorCount > 0
                ? `Your track is live. ${collaboratorCount} collaborator${
                    collaboratorCount === 1 ? '' : 's'
                  } will see a request to confirm.`
                : 'Your track is live and up on your profile.'}
            </Text>
            <Button
              label="Done"
              onPress={handleDismissSuccess}
              variant="primary"
              size="lg"
              fullWidth
            />
          </View>
        </View>
      </Modal>

      <AddToAlbumSheet
        visible={albumSheetOpen}
        mode="pick"
        onClose={() => setAlbumSheetOpen(false)}
        onPicked={album => setSelectedAlbum({ id: album.id, title: album.title })}
      />
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
  modeSegment: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  modeSegmentButton: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: COLORS.card,
  },
  // Selected state is the gradient outline; no fill.
  modeSegmentButtonActive: {
    borderColor: 'transparent',
  },
  modeSegmentLabel: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  modeSegmentLabelActive: {
    color: COLORS.purpleLight,
  },
  modeSegmentSubLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 14,
  },
  modeSegmentSubLabelActive: {
    color: COLORS.purpleLight,
    opacity: 0.85,
  },
  filesGroup: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  previewCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  },
  previewTrackInfo: {
    padding: 14,
    gap: 4,
  },
  previewTitle: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  thumbnailPreview: {
    aspectRatio: 1,
    width: '100%',
    backgroundColor: COLORS.card,
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
  albumRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  albumRowMeta: { flex: 1, minWidth: 0 },
  albumRowMini: { color: COLORS.purpleLight, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  albumRowTitle: { color: COLORS.white, fontSize: 14, fontWeight: '700', marginTop: 1 },
  albumRowPlaceholder: { color: COLORS.textSecondary, fontSize: 14 },
  collabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 10,
  },
  addCollabButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  addCollabButtonText: {
    color: COLORS.purpleNeon,
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
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 12, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  successCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  successGlow: {
    position: 'absolute',
    top: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.purpleGlow,
    opacity: 0.65,
  },
  successIconOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.purpleDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.purple,
    marginBottom: 18,
  },
  successIconInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 10,
  },
  successTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  successBody: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
});
