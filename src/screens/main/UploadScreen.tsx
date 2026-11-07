import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Image,
  Linking,
  Platform,
  BackHandler,
  Keyboard,
  Dimensions,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardController, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { pick, keepLocalCopy, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';

import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from '../../components/MediaPlayer';
import WaveformScrubber, { SCRUBBER_LABEL_PULL } from '../../components/WaveformScrubber';
import { usePlayback } from '../../contexts/PlaybackContext';
import FormInput from '../../components/FormInput';
import TagInput from '../../components/TagInput';
import { EMOTION_TAGS } from '../../../shared/constants/tags';
import { Button } from '../../components/Button';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { GradientBorder } from '../../components/GradientBorder';
import type { RootStackParamList } from '../../navigation/types';
import { closeAddFlow } from '../../navigation/closeAddFlow';
import {
  ROLES,
  getChipStyle,
  getChipTone,
  type PendingCollaborator,
} from '../../constants/roles';
import {
  createTrack,
  discardStagedUpload,
  MAX_UPLOADER_ROLES,
  publishStagedTrack,
  stageMediaUpload,
  StagingAbandonedError,
  sweepStagedUploads,
  UploadCancelledError,
  type CreateTrackInput,
  type CreateTrackStage,
  type PostMode,
  type StagedUpload,
} from '../../services/tracks';
import CopyrightMatchModal from '../../components/CopyrightMatchModal';
import { Choice } from '../../components/Choice';
import {
  describeMatch,
  needsAcknowledgement,
  type RightsDeclaration,
  type ScanResult,
} from '../../../shared/services/copyrightScan';
import { addTrackToAlbum } from '../../services/albums';
import { MAX_UPLOAD_BYTES, tooLargeMessage } from '../../services/uploads';
import { useIsOffline } from '../../services/network';
import { autoRetryDelay, interruptionCopy, isUploadNetworkError } from '../../utils/uploadRecovery';
import { MIN_TRACK_SECONDS, tooShortMessage } from '../../../shared/constants/media';
import { pickSquareImageFromGallery, pickVideoFromGallery } from '../../services/mediaPicks';
import type { PickedFile, TrackMediaKind } from '../../services/uploads';
import { onCollaboratorPicked } from '../../services/uploadEvents';
import { Icon } from '../../components/Icon';
import AddToAlbumSheet from '../../components/AddToAlbumSheet';
import RolePicker from '../../components/RolePicker';
import FullScreenFrame from '../../components/FullScreenFrame';
import UploadStep, { type UploadStepState } from '../../components/UploadStep';
import UploadPreviewCard, { type UploadPreviewAuthor } from '../../components/UploadPreviewCard';
import { GradientFill } from '../../components/GradientFill';
import { supabase } from '../../../lib/supabase';
import { getMyProfile } from '../../services/profileService';
import { useToast } from '../../contexts/ToastContext';
import {
  deleteDraft,
  loadUploadDraft,
  newDraftId,
  saveUploadDraft,
  uploadDraftsAvailable,
} from '../../services/drafts';
import { getMyUserId } from '../../services/session';
import MentionSuggestions from '../../components/MentionSuggestions';
import { useMentionInput, useMentionListRoom } from '../../hooks/useMentionInput';

type UploadNavigation = NativeStackNavigationProp<RootStackParamList, 'Upload'>;

/**
 * The upload, as six steps in a vertical list and then a Preview page. One step is open at
 * a time; done steps fold into a ticked one-line summary and stay tappable, so the order is
 * a guide, not a lock. Post lives only on the Preview page, which also lists anything still
 * missing with a jump to the step that fixes it.
 */
/**
 * The Preview page's "How it looks in full screen" frame (videos): a phone-shaped window at
 * the screen's own proportions, so the crop it shows is the crop full screen makes.
 */
// The rounded purple outline and its thickness. The video fills right up to it.
const FS_FRAME_RADIUS = 28;
const FS_FRAME_BORDER = 3;
const FS_FRAME_W = Math.round(Math.min(230, Dimensions.get('window').width * 0.58));
// The SCREEN inside the bezel is at the phone's own proportions, so its crop is full screen's.
const FS_FRAME_H = Math.round(
  (FS_FRAME_W - FS_FRAME_BORDER * 2) * (Dimensions.get('window').height / Dimensions.get('window').width)
  + FS_FRAME_BORDER * 2,
);

/** How far above the keyboard a focused field is kept: the field, then room for Next. */
const FIELD_CLEARANCE = 120;
/** The scroll content's top padding — the offset of the view revealFocusedField measures. */
const SCROLL_PAD_TOP = 16;

type StepKey = 'type' | 'media' | 'cover' | 'details' | 'role' | 'credits' | 'rights';
const STEP_ORDER: StepKey[] = ['type', 'media', 'cover', 'details', 'role', 'credits', 'rights'];

/** One early-upload attempt: abandoned once the screen moves on; holds its promise and result. */
type StagingToken = {
  abandoned: boolean;
  /** Stops the file upload itself when the attempt is abandoned. */
  controller: AbortController;
  staged: StagedUpload | null;
  promise: Promise<StagedUpload | null> | null;
};

/** The early upload + copyright check of the song or video — see the effect that runs it. */
type Staging =
  | { status: 'idle' }
  | { status: 'uploading'; fraction: number }
  | { status: 'checking' }
  | { status: 'ready'; staged: StagedUpload }
  /** `network`: the connection stopped it (retried by itself once, and offers Try again). */
  | { status: 'failed'; network: boolean; reason: string };

/**
 * Where the desktop studio lives.
 *
 * The apex, not a subdomain: ADR-0015 decision 6 folds the marketing page into the same
 * Vercel app and puts the dashboard at `/studio`. One origin means the session, the branding
 * and the future public track pages all share it, and there is no second migration later.
 *
 * So this URL is already correct and does not change at deploy — before the cutover it lands
 * on the about page, which carries the sign-in entry; after it, the studio is a path on the
 * same site.
 */
const STUDIO_URL = 'https://livil-music.com';

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

/** m:ss for the preview scrubber's readout. */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) { return '0:00'; }
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) {return '';}
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What to tell someone when the file picker fails — never the library's raw text. */
function pickErrorMessage(err: unknown): string {
  // The photo gallery (image-crop-picker) refuses outright when access was denied.
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && /PERMISSION/.test(code)) {
    return Platform.OS === 'ios'
      ? 'Livil needs access to your photos. Turn it on in Settings → Livil → Photos.'
      : 'Livil needs access to your photos. Turn it on in Settings → Apps → Livil → Permissions.';
  }
  if (isErrorWithCode(err)) {
    if (err.code === errorCodes.IN_PROGRESS) {
      return 'Your files are still opening. Give it a second, then try again.';
    }
    if (err.code === errorCodes.UNABLE_TO_OPEN_FILE_TYPE) {
      return "That kind of file can't be opened here. Try a different file.";
    }
  }
  return "Couldn't open that. Please try again.";
}

export default function UploadScreen() {
  const navigation = useNavigation<UploadNavigation>();
  const playback = usePlayback();
  // An Editor mix arrives already chosen (ADR-0036): the song step opens with it, and nothing
  // is uploaded until the artist moves on from that step (`studioConfirmed`).
  const routeParams = useRoute<RouteProp<RootStackParamList, 'Upload'>>().params;
  const studio = routeParams?.studio ?? null;
  // An upload draft being reopened, saved earlier from this screen's leave dialog.
  const openedDraftId = routeParams?.draftId ?? null;
  const { showToast } = useToast();
  const studioFile = useMemo<PickedFile | null>(
    () => (studio ? { uri: studio.uri, name: studio.name, type: 'audio/flac', size: studio.size } : null),
    [studio],
  );
  const [studioConfirmed, setStudioConfirmed] = useState(false);

  const [mode, setMode] = useState<PostMode>('audio');
  const [audio, setAudio] = useState<PickedFile | null>(studioFile);
  const [video, setVideo] = useState<PickedFile | null>(null);
  const [cover, setCover] = useState<PickedFile | null>(null);
  const [thumbnail, setThumbnail] = useState<PickedFile | null>(null);

  const [title, setTitle] = useState(studio?.title ?? '');
  const [description, setDescription] = useState('');
  const mention = useMentionInput(description, setDescription);

  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>([]);
  // Already normalized — `TagInput` commits the stored form, never the typed form. Seeded
  // with the emotions, pre-applied: the artist removes the ones this track is not, rather
  // than opting in to the ones it is.
  // Starts EMPTY; the moods are one-tap suggestions under the field (owner's call,
  // 2026-10-15 — they used to arrive pre-applied and had to be pruned).
  const [tags, setTags] = useState<string[]>([]);
  // One or more, each saved as its own credit (createTrack); at least one is required.
  const [uploaderRoles, setUploaderRoles] = useState<string[]>([]);
  // The per-upload streaming grant, ticked beside the post button. Required on every
  // upload, matched or not — `createTrack` records it once the post exists.
  const [grantedStreaming, setGrantedStreaming] = useState(false);

  /**
   * Which file slot's picker is opening, if any. While set, every Choose/Change button is
   * disabled and the tapped one shows a spinner.
   *
   * WHY: the picker can only be open once. A second tap while the first request is still
   * opening (easy on a slow phone) made the native picker reject it with a raw
   * "previous promise did not settle" error. The ref is the real guard — state updates
   * land a render later, and two taps can arrive inside one render.
   */
  const [pickingKind, setPickingKind] = useState<TrackMediaKind | null>(null);
  const pickingRef = useRef(false);
  /**
   * Choose stays disabled until this screen has finished sliding up. iOS silently refuses
   * to present the picker over a screen that is still animating in, and the request then
   * never settles — nothing opens, and every later tap hits "already in progress".
   */
  const [screenSettled, setScreenSettled] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<{ id: string; title: string } | null>(null);
  const [albumSheetOpen, setAlbumSheetOpen] = useState(false);
  const [error, setError] = useState('');
  // A neutral note (not an error), e.g. after backing out at the copyright question.
  const [notice, setNotice] = useState('');
  const [progressStage, setProgressStage] = useState<CreateTrackStage>('preparing');
  const [progressFraction, setProgressFraction] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(!!openedDraftId);

  // The copyright question, if the scan raised one. `createTrack` awaits the promise
  // below, so the upload genuinely pauses here rather than racing the modal — holding
  // the resolver in a ref keeps that promise alive across the re-render the modal
  // causes, which a state-only version would drop.
  const [pendingMatch, setPendingMatch] = useState<ScanResult | null>(null);
  const matchResolverRef = useRef<((answer: RightsDeclaration) => void) | null>(null);

  // Bumped for every question asked. It is the modal's `key`, so React discards the
  // previous instance rather than reusing it — see the mount site at the bottom of this
  // file for why that matters more than it looks.
  const [matchSeq, setMatchSeq] = useState(0);

  const askAboutMatch = useCallback((result: ScanResult) => {
    setMatchSeq(n => n + 1);
    setPendingMatch(result);
    return new Promise<RightsDeclaration>(resolve => {
      matchResolverRef.current = resolve;
    });
  }, []);

  const answerMatch = useCallback((answer: RightsDeclaration) => {
    setPendingMatch(null);
    const resolve = matchResolverRef.current;
    matchResolverRef.current = null;
    resolve?.(answer);
  }, []);
  const [previewPaused, setPreviewPaused] = useState(true);
  // Captured from the preview player's onLoad — the picked file's length in
  // seconds — so we can persist duration_seconds at upload (feed/profile cards
  // read it to show the track length before the post is ever played).
  const [previewDurationSec, setPreviewDurationSec] = useState<number | null>(null);
  const [previewPositionSec, setPreviewPositionSec] = useState(0);
  const previewRef = useRef<MediaPlayerHandle>(null);
  // True for the length of a scrub swipe. While it is set the FINGER owns the
  // readout, so the player's progress events must not overwrite it.
  const previewScrubbingRef = useRef(false);

  // The previews loop (`repeat`), so this only runs if a platform ends one anyway: back to
  // the start, ready to play again.
  const handlePreviewEnded = useCallback(() => {
    setPreviewPaused(true);
    setPreviewPositionSec(0);
    previewRef.current?.seek(0);
  }, []);

  const handlePreviewProgress = useCallback((pos: number) => {
    if (previewScrubbingRef.current) { return; }
    setPreviewPositionSec(pos);
  }, []);

  const handlePreviewScrubStart = useCallback(() => {
    previewScrubbingRef.current = true;
  }, []);

  // Readout only while the finger moves — seeking the preview on every gesture
  // event makes it re-buffer and the scrub visibly stutters. Same rule as the
  // player and the repost editor.
  const handlePreviewScrub = useCallback((s: number) => {
    setPreviewPositionSec(s);
  }, []);

  const handlePreviewSeekEnd = useCallback((s: number) => {
    previewScrubbingRef.current = false;
    setPreviewPositionSec(s);
    previewRef.current?.seek(s);
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
    // Opened from the "+ Post" chooser, this closes the chooser too.
    closeAddFlow(navigation);
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

  // Reset the preview only when the SONG changes. previewMedia also changes with the cover
  // art, but picking a cover does not reload the player — so a reset there wiped the length
  // the player had already reported, and it was never reported again: every upload that
  // picked the song before the cover was saved without a length (duration_seconds null,
  // which only the uploader's own first play backfills). Keyed on the media file alone.
  const previewMediaUri = mode === 'audio' ? audio?.uri : video?.uri;
  useEffect(() => {
    setPreviewPaused(true);
    setPreviewDurationSec(null);
    setPreviewPositionSec(0);
  }, [mode, previewMediaUri]);

  // Hide the FloatingPlayer for the length of this screen, and stop whatever it
  // was controlling on the way in. Hiding it alone would leave music playing with
  // no visible control — and the preview below is a second player competing for
  // the same ears. Mirrors RepostScreen.
  //
  // NOTE the flag is named for the repost screen because that was its first
  // caller; it really means "a full-screen compose surface is open". Depending on
  // the individual callbacks rather than the whole `playback` object matters:
  // its value memo re-creates constantly, which would re-run this on every
  // playback state change and re-pause the user's music mid-screen.
  const { pauseAll, setRepostOpen, handlersRef } = playback;
  useFocusEffect(
    useCallback(() => {
      handlersRef.current?.pause();
      pauseAll();
      setRepostOpen(true);
      return () => {
        setPreviewPaused(true);
        setRepostOpen(false);
      };
    }, [handlersRef, pauseAll, setRepostOpen]),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('transitionEnd', e => {
      if (!e.data.closing) {setScreenSettled(true);}
    });
    // Fallback in case the event never arrives (no animation, or already settled by the
    // time this subscribed) — the buttons must never stay disabled for good.
    const fallback = setTimeout(() => setScreenSettled(true), 1200);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]);

  const handlePickFile = useCallback(
    async (slot: FileSlot) => {
      if (pickingRef.current) {return;}
      pickingRef.current = true;
      setPickingKind(slot.kind);
      // Safety valve. If the OS drops the request without ever answering, the spinner must
      // not spin forever. Once the picker is actually open it covers this screen, so
      // re-enabling the button behind it is invisible and harmless.
      const release = setTimeout(() => {
        pickingRef.current = false;
        setPickingKind(null);
      }, 10_000);
      try {
        // Only audio comes from the Files app. A video, its thumbnail and cover art come from
        // the photo gallery — that is where they live on a phone — and pictures are cropped
        // to a square for real, so what the artist sees here is what the feed and the
        // full-screen player show (see `pickSquareImageFromGallery`).
        if (slot.kind !== 'audio') {
          const picked =
            slot.kind === 'video'
              ? await pickVideoFromGallery()
              : await pickSquareImageFromGallery(slot.kind);
          // Backing out keeps whatever was chosen before.
          if (!picked) {return;}
          if (picked.size != null && picked.size > MAX_UPLOAD_BYTES) {
            setError(tooLargeMessage(slot.kind));
            return;
          }
          if (slot.kind === 'video') {
            setVideo(picked);
            // "Upload cancelled. You can pick a different video." has been acted on.
            setNotice('');
          }
          else if (slot.kind === 'thumbnail') {setThumbnail(picked);}
          else {setCover(picked);}
          setError('');
          return;
        }
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
        // iOS hands back a TEMPORARY copy (`tmp/<bundle>-Inbox/`) that the system is free to
        // delete — and does, before the user reaches Post. React Native's networking then
        // fails to read the missing file while building the request body and never fires
        // `onerror`, so the upload sat at 0% until the stall watchdog gave up. Copy it into
        // our own caches directory now, while it still exists. Android is unchanged: its
        // `content://` uri is materialized at upload time by `resolveReadableUri`.
        if (Platform.OS === 'ios') {
          const [copy] = await keepLocalCopy({
            files: [{ uri: result.uri, fileName: result.name ?? `${slot.kind}` }],
            destination: 'cachesDirectory',
          });
          if (copy.status !== 'success') {
            console.log('[LIVIL][picker] local copy failed', copy.copyError);
            setError("Couldn't read that file. Try picking it again.");
            return;
          }
          file.uri = copy.localUri;
        }
        setAudio(file);
        setError('');
        // "Upload cancelled. You can pick a different song." has been acted on.
        setNotice('');
      } catch (err) {
        if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {return;}
        // The picker's own messages are written for developers ("previous promise did not
        // settle…"), so they are logged, not shown.
        console.log('[LIVIL][picker] pick failed', err);
        setError(pickErrorMessage(err));
      } finally {
        clearTimeout(release);
        pickingRef.current = false;
        setPickingKind(null);
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
    // Person AND role. Hiding the person outright — what this used to do — meant the
    // guitarist who also wrote the song could only ever be credited once.
    const takenRoleKeys = collaborators.map(c =>
      c.kind === 'user' && c.userId
        ? `${c.userId}|${c.role}`
        : `custom:${c.name.trim().toLowerCase()}|${c.role}`,
    );
    navigation.navigate('CollaboratorPicker', { takenRoleKeys });
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

  // ── The early upload + copyright check ───────────────────────────────────────
  //
  // The file uploads and the provider check runs straight after, while the artist fills in
  // the rest — so a match is raised early, not after the whole form and the whole upload.
  // See `stageMediaUpload`. A song starts the moment it is picked. A video starts once the
  // artist moves on from its step (`confirmedVideo`): it can be hundreds of MB, and a wrong
  // pick is caught on the preview before any of it is spent.
  //
  // A match is NOT asked about when the check finishes: the artist answers on their own tap
  // (step 2's card, or the banner on the other steps), and Post asks if they never did. An
  // unprompted dialog would land on top of the photo picker, the collaborator picker, the
  // album sheet or the full-screen preview, and iOS refuses to present it there — the
  // question would never show, and Post would wait on it forever.
  //
  // Each attempt gets a token. A newer pick (or a removal, a switch of type, leaving the
  // screen) marks the old token abandoned, stops its upload, and removes whatever it wrote.
  // The token also carries the attempt's promise and, once done, its staged upload — read
  // at Post, and cleared there once Post has taken it over.
  const [staging, setStaging] = useState<Staging>({ status: 'idle' });
  const [stepBarW, setStepBarW] = useState(0);
  const stagingTokenRef = useRef<StagingToken | null>(null);
  const [awaitingStaging, setAwaitingStaging] = useState(false);

  // ── When the connection stops an upload ──────────────────────────────────────
  //
  // A failure the connection caused (`UploadNetworkError`: a stall, a dropped connection, a
  // step that got no answer) is retried ONCE by itself, a few seconds after the phone is
  // online — at once if it still is, else when it comes back — and after that offers Try
  // again. Never a silent freeze: there is always a message, and a button unless the retry
  // is about to start. Retrying starts from 0%: a request that broke cannot be resumed
  // (see `kb/architecture/media-pipeline.md`).
  //
  // Two uploaders can be stopped this way — the early upload and Post — and they must never
  // both re-send the file. Post owns retrying from the moment it is tapped: the early
  // upload never retries by itself while Post is running or has an interruption showing.
  // (A Post that finds an early upload running waits for it instead of starting another.)
  const offline = useIsOffline();
  /** Bumped to start the early upload again (Try again, or the automatic retry). */
  const [stagingAttempt, setStagingAttempt] = useState(0);
  /** The file whose early upload has used its one automatic retry. */
  const [stagingAutoRetriedFile, setStagingAutoRetriedFile] = useState<PickedFile | null>(null);
  /** Post stopped by the connection: shown in place of the Post button, with Try again. */
  const [postFailure, setPostFailure] = useState<{ reason: string } | null>(null);
  const [postAutoRetried, setPostAutoRetried] = useState(false);
  const lastStagedFileRef = useRef<PickedFile | null>(null);

  // Uploads staged on an earlier visit whose app was killed before they were posted.
  useEffect(() => { void sweepStagedUploads(); }, []);

  // The video the artist has moved on from (their "yes, this one"). Compared by identity, so
  // a newly picked video is unconfirmed until they move on again.
  const [confirmedVideo, setConfirmedVideo] = useState<PickedFile | null>(null);
  const stagedFile = mode === 'audio'
    ? (audio && (audio !== studioFile || studioConfirmed) ? audio : null)
    : video && confirmedVideo === video ? video : null;

  useEffect(() => {
    if (!stagedFile) { return; }
    const token: StagingToken = {
      abandoned: false,
      controller: new AbortController(),
      staged: null,
      promise: null,
    };
    stagingTokenRef.current = token;
    const abandoned = () => token.abandoned;
    // Same file as the last run: this is Try again or the automatic retry, not a new pick.
    const again = lastStagedFileRef.current === stagedFile;
    lastStagedFileRef.current = stagedFile;
    console.log(`[LIVIL][upload] staging: ${again ? 'starting again from 0%' : 'starting'} (${mode})`);
    setStaging({ status: 'uploading', fraction: 0 });
    const promise = stageMediaUpload(
      stagedFile,
      mode,
      p => {
        if (abandoned()) { return; }
        setStaging(p.stage === 'checking' ? { status: 'checking' } : { status: 'uploading', fraction: p.fraction });
      },
      abandoned,
      token.controller.signal,
    )
      .then(staged => {
        if (abandoned()) { void discardStagedUpload(staged); return null; }
        token.staged = staged;
        setStaging({ status: 'ready', staged });
        return staged;
      })
      .catch((err: unknown) => {
        if (err instanceof StagingAbandonedError || abandoned()) { return null; }
        const network = isUploadNetworkError(err);
        console.log(`[LIVIL][upload] early upload failed (${network ? 'connection' : 'other'})`, err);
        setStaging({
          status: 'failed',
          network,
          reason: err instanceof Error ? err.message : 'The upload stopped.',
        });
        return null;
      });
    token.promise = promise;
    return () => {
      // A different file, no file, the other type, or leaving the screen: this attempt is
      // over, and an upload still running stops now rather than finishing first. An upload
      // Post has taken over is no longer on the token, so it is never removed here.
      token.abandoned = true;
      token.controller.abort();
      const staged = token.staged;
      token.staged = null;
      setStaging({ status: 'idle' });
      if (staged) { void discardStagedUpload(staged); }
    };
    // `stagingAttempt` starts the same file again (Try again / the automatic retry).
  }, [mode, stagedFile, stagingAttempt]);

  const stagingAutoUsed = !!stagedFile && stagingAutoRetriedFile === stagedFile;
  const stagingNetworkFailure = staging.status === 'failed' && staging.network;

  // The early upload's one automatic retry (see "When the connection stops an upload").
  useEffect(() => {
    if (!stagingNetworkFailure || submitting || postFailure || !stagedFile) { return; }
    const delay = autoRetryDelay({ network: true, offline, autoRetryUsed: stagingAutoUsed });
    if (delay == null) { return; }
    const t = setTimeout(() => {
      console.log('[LIVIL][upload] staging: retrying by itself (connection is back)');
      setStagingAutoRetriedFile(stagedFile);
      setStagingAttempt(n => n + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [stagingNetworkFailure, submitting, postFailure, stagedFile, offline, stagingAutoUsed]);

  const retryStagingNow = useCallback(() => {
    console.log('[LIVIL][upload] staging: Try again tapped');
    setStagingAttempt(n => n + 1);
  }, []);

  // The staged song matched a known recording and the artist has not answered yet.
  const needsAnswer =
    staging.status === 'ready' && needsAcknowledgement(staging.staged.scan) && !staging.staged.declaration;

  // Asked on the artist's tap, when nothing else is on screen (see the note above the
  // staging effect). Backing out removes the song, as it always did.
  const answerMatchNow = useCallback(async () => {
    const token = stagingTokenRef.current;
    const staged = token?.staged;
    if (!token || token.abandoned || !staged) { return; }
    const answer = await askAboutMatch(staged.scan);
    if (token.abandoned || token.staged !== staged) { return; }
    if (answer.acknowledgement === 'cancelled') {
      token.abandoned = true;
      token.staged = null;
      void discardStagedUpload(staged);
      if (staged.mediaKind === 'audio') {
        setAudio(null);
        setNotice('Upload cancelled. You can pick a different song.');
      } else {
        setVideo(null);
        setNotice('Upload cancelled. You can pick a different video.');
      }
      return;
    }
    const answered = { ...staged, declaration: answer };
    token.staged = answered;
    setStaging({ status: 'ready', staged: answered });
  }, [askAboutMatch]);

  // Step 2's Next waits (briefly) for the inline player to report the file's length: it is
  // saved with the track and checked against the minimum, and the player only exists while
  // step 2 is open. A file the player cannot read must not trap anyone, hence the timeout.
  const [lengthWaitOver, setLengthWaitOver] = useState(false);
  useEffect(() => {
    setLengthWaitOver(false);
    if (!previewMediaUri) { return; }
    const t = setTimeout(() => setLengthWaitOver(true), 8000);
    return () => clearTimeout(t);
  }, [previewMediaUri]);
  const lengthKnown = previewDurationSec != null || lengthWaitOver;

  // ── Steps ────────────────────────────────────────────────────────────────────
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  // FIELD_CLEARANCE, plus the @ list's height while the description's list is open.
  const mentionRoom = useMentionListRoom(scrollRef, FIELD_CLEARANCE);
  const [step, setStep] = useState<StepKey>(studio || openedDraftId ? 'media' : 'type');
  const [reviewing, setReviewing] = useState(false);

  const mediaFile = mode === 'audio' ? audio : video;
  const imageFile = mode === 'audio' ? cover : thumbnail;

  const stepDone: Record<StepKey, boolean> = {
    type: step !== 'type' || reviewing,
    media: Boolean(mediaFile),
    cover: Boolean(imageFile),
    details: title.trim().length > 0,
    role: uploaderRoles.length > 0,
    // Optional: done once they add someone, or once they have moved past it.
    credits: collaborators.length > 0 || reviewing || STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf('credits'),
    rights: grantedStreaming,
  };
  const doneCount = STEP_ORDER.filter(k => stepDone[k]).length;
  const stepState = (key: StepKey): UploadStepState => {
    if (!reviewing && step === key) { return 'current'; }
    return stepDone[key] ? 'done' : 'todo';
  };

  // A box that appears and takes the keyboard in the same moment ("+ Something else") is
  // missed by the keyboard-aware scroll — its position is not known yet when the keyboard
  // starts to rise — and that scroll only aims to make a field TOUCH the keyboard (the
  // iPhone's suggestion strip got in the way even then). And the artist cannot fix it by
  // hand: dragging closes the keyboard. So once the keyboard is up, measure where the field
  // and the keyboard actually are and scroll the field to FIELD_CLEARANCE above the keys,
  // which leaves room for the Next button under it.
  // Held while two fingers pinch the full-screen frame, so the page does not scroll under them.
  const [pinching, setPinching] = useState(false);
  const scrollFrameRef = useRef<View>(null);
  const scrollInnerRef = useRef<View>(null);
  const revealFocusedField = useCallback((field: TextInput | null) => {
    if (!field) { return; }
    const attempt = (triesLeft: number) => {
      const kb = Keyboard.metrics();
      if (!kb) {
        if (triesLeft > 0) { setTimeout(() => attempt(triesLeft - 1), 200); }
        return;
      }
      const keyboardTop = kb.screenY;
      field.measureInWindow((_x, fieldTop, _w, fieldH) => {
        if (fieldTop + fieldH <= keyboardTop - FIELD_CLEARANCE) { return; } // already clear
        const inner = scrollInnerRef.current;
        const frame = scrollFrameRef.current;
        if (!inner || !frame) { return; }
        field.measureLayout(
          inner,
          (_fx, fy, _fw, fh) => {
            frame.measureInWindow((_sx, frameTop) => {
              const y = frameTop + SCROLL_PAD_TOP + fy + fh - keyboardTop + FIELD_CLEARANCE;
              scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
            });
          },
          () => {},
        );
      });
    };
    setTimeout(() => attempt(3), 300);
  }, []);

  // Moving on from "Your video" (Next, another step, or the Preview) is the artist's "yes,
  // this one": the video's early upload and check start then (see the staging effect).
  const confirmVideo = useCallback(() => {
    if (mode === 'video' && video) { setConfirmedVideo(video); }
    // The same "yes, this one" for an Editor mix: its upload and check start now.
    if (mode === 'audio' && studioFile && audio === studioFile) { setStudioConfirmed(true); }
  }, [mode, video, audio, studioFile]);

  const openStep = useCallback((key: StepKey) => {
    // Forward only: going back to step 1 (e.g. to switch to a song) is not a "yes".
    if (STEP_ORDER.indexOf(key) > STEP_ORDER.indexOf('media')) { confirmVideo(); }
    setPreviewPaused(true);
    setReviewing(false);
    setStep(key);
    setError('');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [confirmVideo]);

  const openPreview = useCallback(() => {
    confirmVideo();
    setPreviewPaused(true);
    setReviewing(true);
    setError('');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [confirmVideo]);

  // A reopened draft skips what is already filled in (credits are optional, so never missing).
  const stepsAhead = STEP_ORDER.slice(STEP_ORDER.indexOf(step) + 1);
  const nextStep = openedDraftId ? stepsAhead.find(k => k !== 'credits' && !stepDone[k]) : stepsAhead[0];
  const goNext = useCallback(() => {
    if (!nextStep) { openPreview(); return; }
    openStep(nextStep);
  }, [nextStep, openStep, openPreview]);

  // The signed-in user, looked up once per visit like the Editor's: a draft must save with no
  // signal, when a lookup at that moment may not answer.
  const ownerRef = useRef<string | null>(null);
  const owner = useCallback(async (): Promise<string | null> => {
    if (!ownerRef.current) { ownerRef.current = await getMyUserId().catch(() => null); }
    return ownerRef.current;
  }, []);
  useEffect(() => { void owner(); }, [owner]);

  // A reopened draft fills the form in. Nothing was uploaded, so its upload starts as a new
  // pick's would.
  const draftRef = useRef<{ id: string; createdAt: string; durationSec: number } | null>(null);
  useEffect(() => {
    if (!openedDraftId) { return; }
    let cancelled = false;
    void (async () => {
      try {
        const userId = await owner();
        if (!userId) { throw new Error('No signed-in user'); }
        const { draft, media, picture } = await loadUploadDraft(userId, openedDraftId);
        if (cancelled) { return; }
        const f = draft.form;
        draftRef.current = { id: draft.id, createdAt: draft.createdAt, durationSec: draft.durationSec };
        setMode(f.mode);
        if (f.mode === 'audio') {
          setAudio(media);
          setCover(picture);
        } else {
          setVideo(media);
          setThumbnail(picture);
        }
        setTitle(draft.title);
        setDescription(f.description);
        setTags(f.tags);
        setUploaderRoles(f.uploaderRoles);
        setCollaborators(f.collaborators);
        setSelectedAlbum(f.album);
        setDraftLoading(false);
      } catch (err) {
        if (cancelled) { return; }
        console.log('[LIVIL][upload] draft would not open', err);
        showToast("This draft can't be opened.", { kind: 'error' });
        navigation.goBack();
      }
    })();
    return () => { cancelled = true; };
  }, [openedDraftId, owner, showToast, navigation]);

  // Anything leaving the screen would lose: for a reopened draft, changes since it opened; else
  // whatever is filled in. An Editor mix arrives chosen and stays in its draft, so on its own it
  // doesn't count.
  const formSnapshot = JSON.stringify([
    mode, mediaFile?.uri, imageFile?.uri, title, description, tags, uploaderRoles, collaborators, selectedAlbum?.id,
  ]);
  const openedSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (openedDraftId && !draftLoading && openedSnapshotRef.current === null) {
      openedSnapshotRef.current = formSnapshot;
    }
  }, [openedDraftId, draftLoading, formSnapshot]);
  const hasWork = openedDraftId
    ? openedSnapshotRef.current !== null && formSnapshot !== openedSnapshotRef.current
    : Boolean(
      video || cover || thumbnail || (audio && audio !== studioFile)
      || title.trim() !== (studio?.title ?? '').trim() || description.trim()
      || collaborators.length || tags.length || uploaderRoles.length || selectedAlbum,
    );
  const askToDiscard = useCallback(async () => {
    await KeyboardController.dismiss();
    setConfirmDiscard(true);
  }, []);

  // Android back on the Preview page returns to the steps, as the header arrow does; from the
  // steps it leaves the screen, asking first if that would lose anything. Mid-upload it does
  // nothing.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (submitting) { return true; }
        if (reviewing) { setReviewing(false); return true; }
        if (!hasWork) { return false; }
        void askToDiscard();
        return true;
      });
      return () => sub.remove();
    }, [reviewing, submitting, hasWork, askToDiscard]),
  );

  // Who the preview card and player say posted it.
  const [me, setMe] = useState<UploadPreviewAuthor | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const id = data?.user?.id;
        if (!id) { return; }
        const p = await getMyProfile(id);
        if (!cancelled) {
          setMe({ name: p.display_name?.trim() || p.username, username: p.username, avatarUrl: p.avatar_url });
        }
      } catch {
        // The card says "You" instead.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const author: UploadPreviewAuthor = me ?? { name: 'You', username: null, avatarUrl: null };

  // Everything Post still needs, each with the step that fixes it.
  const missing = useMemo(() => {
    const out: { key: StepKey; label: string }[] = [];
    if (!mediaFile) { out.push({ key: 'media', label: mode === 'audio' ? 'your song' : 'your video' }); }
    if (needsAnswer) { out.push({ key: 'media', label: 'an answer to the copyright question' }); }
    if (!imageFile) { out.push({ key: 'cover', label: mode === 'audio' ? 'a cover' : 'a thumbnail' }); }
    if (!title.trim()) { out.push({ key: 'details', label: 'a title' }); }
    if (uploaderRoles.length === 0) { out.push({ key: 'role', label: 'your role' }); }
    if (!grantedStreaming) { out.push({ key: 'rights', label: 'streaming permission' }); }
    return out;
  }, [mediaFile, needsAnswer, imageFile, mode, title, uploaderRoles, grantedStreaming]);

  const canSubmit = !submitting && missing.length === 0;

  const handleSubmit = useCallback(async (opts?: { auto?: boolean }) => {
    setPreviewPaused(true);
    // A tap (Post or Try again) earns a fresh automatic retry; the retry itself does not.
    setPostFailure(null);
    if (!opts?.auto) { setPostAutoRetried(false); }
    if (missing.length > 0) {
      setError(`Still needed: ${missing.map(m => m.label).join(', ')}.`);
      return;
    }
    // Unknown duration (the preview couldn't probe it) is let through: it backfills on
    // first play, and blocking would strand files that are perfectly fine.
    if (previewDurationSec != null && previewDurationSec > 0 && previewDurationSec < MIN_TRACK_SECONDS) {
      setError(tooShortMessage(previewDurationSec));
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    setProgressStage('preparing');
    setProgressFraction(0);
    const onProgress = ({ stage, fraction }: { stage: CreateTrackStage; fraction: number }) => {
      setProgressStage(stage);
      setProgressFraction(fraction);
    };
    try {
      let result: { trackId: string } | null = null;
      const input: CreateTrackInput = mode === 'audio'
        ? {
            mode: 'audio',
            title,
            description,
            audio: audio!,
            cover: cover!,
            uploaderRoles,
            collaborators,
            tags,
            durationSeconds: previewDurationSec,
            streamingGrantAccepted: grantedStreaming,
            // The Editor's own mix, unchanged — not a file the artist swapped in on this screen.
            madeWithLivil: !!studioFile && audio === studioFile,
          }
        : {
            mode: 'video',
            title,
            description,
            video: video!,
            cover: cover ?? undefined,
            thumbnail: thumbnail!,
            uploaderRoles,
            collaborators,
            tags,
            durationSeconds: previewDurationSec,
            streamingGrantAccepted: grantedStreaming,
          };
      // The song or video may still be uploading or being checked: wait for it rather than
      // start a second copy. A match raised meanwhile is answered in the same dialog.
      const token = stagingTokenRef.current;
      let staged = token && !token.abandoned ? token.staged : null;
      if (token && !token.abandoned && !staged && token.promise) {
        console.log('[LIVIL][upload] post: waiting for the early upload to finish');
        setAwaitingStaging(true);
        staged = await token.promise;
        setAwaitingStaging(false);
        if (token.abandoned) {
          // Backed out at the question: the file is gone, and that path set its own notice.
          console.log('[LIVIL][upload] post: stopped — the early upload was cancelled at the copyright question');
          return;
        }
      }
      if (token && staged) {
        // Post owns it now: leaving the screen must not remove it mid-publish. The
        // publish removes it itself if it fails.
        token.staged = null;
        token.promise = null;
        try {
          result = await publishStagedTrack(staged, input, onProgress, askAboutMatch);
        } catch (err) {
          // Removed with everything else by the failed publish — so a retry goes the
          // classic way, uploading everything at Post. Not a `network` failure here even when
          // the connection caused it: Post owns that retry, and the early upload is gone.
          setStaging({ status: 'failed', network: false, reason: '' });
          throw err;
        }
      } else {
        if (token) { console.log('[LIVIL][upload] post: no early upload to use — uploading everything now'); }
        result = await createTrack(input, onProgress, askAboutMatch);
      }
      // Tag into the selected album if the user picked one. Fire-and-forget —
      // a failed album tag shouldn't block the success state of the upload.
      if (selectedAlbum && result?.trackId) {
        addTrackToAlbum(selectedAlbum.id, result.trackId).catch(() => {});
      }
      // The Editor draft this mix came from is done with — only now, once the post exists
      // (ADR-0036 §6: a failed or cancelled post keeps the draft).
      if (studio && result?.trackId) {
        void getMyUserId().then(me => (me ? deleteDraft(me, studio.draftId) : undefined)).catch(() => {});
      }
      // Same for an upload draft: posted, it is done with. A failed post keeps it.
      if (openedDraftId && result?.trackId) {
        void owner().then(id => (id ? deleteDraft(id, openedDraftId) : undefined)).catch(() => {});
      }
      // Fires with the success modal, not with the upload finishing — the
      // buzz and the confirmation land together.
      haptics.success();
      setShowSuccess(true);
    } catch (err) {
      setAwaitingStaging(false);
      // Backing out at the copyright question is a choice, not a failure. Showing it
      // as an error would tell someone who just decided not to publish that something
      // went wrong — the form stays as it was, ready to edit or abandon.
      if (err instanceof UploadCancelledError) {
        console.log('[LIVIL][upload] post: cancelled at the copyright question');
        return;
      }
      // The connection, not the post, failed: the interruption block takes the Post
      // button's place (with Try again) instead of a dead-end error at the top.
      if (isUploadNetworkError(err)) {
        console.log(`[LIVIL][upload] post: interrupted at "${err.step}"`);
        setPostFailure({ reason: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      console.log('[LIVIL][upload] post failed', message);
      setError(message);
    } finally {
      // Clears whether the upload finished, failed, or was cancelled — and drops any
      // resolver still held, so an unanswered question cannot strand the next attempt.
      matchResolverRef.current = null;
      setPendingMatch(null);
      setSubmitting(false);
    }
  }, [missing, previewDurationSec, mode, title, description, audio, cover, uploaderRoles, collaborators, tags, grantedStreaming, askAboutMatch, video, thumbnail, selectedAlbum, studio, studioFile, openedDraftId, owner]);

  // Post's one automatic retry. Through a ref, so the timer always runs the current form.
  // Only on the Preview page, where its progress is shown — never behind the steps.
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  useEffect(() => {
    if (!postFailure || submitting || !reviewing) { return; }
    const delay = autoRetryDelay({ network: true, offline, autoRetryUsed: postAutoRetried });
    if (delay == null) { return; }
    const t = setTimeout(() => {
      console.log('[LIVIL][upload] post: retrying by itself (connection is back)');
      setPostAutoRetried(true);
      void handleSubmitRef.current({ auto: true });
    }, delay);
    return () => clearTimeout(t);
  }, [postFailure, submitting, reviewing, offline, postAutoRetried]);

  // ── Pieces ───────────────────────────────────────────────────────────────────

  const renderNext = (label: string, enabled: boolean, why: string) => (
    <View style={styles.nextWrap}>
      <Button
        label={openedDraftId ? 'Next' : label}
        onPress={goNext}
        variant="primary"
        size="md"
        fullWidth
        disabled={!enabled || submitting}
      />
      {enabled ? null : <Text style={styles.nextWhy}>{why}</Text>}
    </View>
  );

  const renderFileSlot = (slot: FileSlot) => {
    const file = fileFor(slot.kind);
    // The Editor's own mix is what this post IS: it can't be swapped or removed here (go back
    // to the draft to change it), and the post is labelled "Made with Livil" because of it.
    const fromEditor = slot.kind === 'audio' && !!studioFile && file === studioFile;
    return (
      <View style={styles.fileRow}>
        <View style={styles.fileText}>
          <Text style={styles.fileLabel}>{slot.label}</Text>
          {file ? (
            <Text style={styles.fileFilename} numberOfLines={1}>
              {file.name ?? 'Selected file'}
              {/* The song or video's length (m:ss) once the player has read it. */}
              {(slot.kind === 'audio' || slot.kind === 'video') && previewDurationSec && previewDurationSec > 0
                ? `  ·  ${formatClock(previewDurationSec)}`
                : ''}
              {file.size != null ? `  ·  ${formatBytes(file.size)}` : ''}
            </Text>
          ) : (
            <Text style={styles.fileDescription}>{slot.description}</Text>
          )}
        </View>
        {fromEditor ? (
          <View style={styles.fromEditor}>
            <Icon name="ai" size={12} color={COLORS.purpleLight} />
            <Text style={styles.fromEditorText}>From the Editor</Text>
          </View>
        ) : file ? (
          <View style={styles.fileActions}>
            <Button
              label="Change"
              size="sm"
              variant="secondary"
              onPress={() => handlePickFile(slot)}
              busy={pickingKind === slot.kind}
              disabled={submitting || !screenSettled || pickingKind !== null}
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
            busy={pickingKind === slot.kind}
            disabled={submitting || !screenSettled || pickingKind !== null}
          />
        )}
      </View>
    );
  };

  // What the early upload and copyright check are doing: under the picked file, and (for a
  // video, which starts once they move on) above the later steps.
  const renderStagingStatus = () => {
    if (!mediaFile) { return null; }
    const what = mode === 'audio' ? 'song' : 'video';
    let icon: React.ReactNode = <ActivityIndicator size="small" color={COLORS.purpleLight} />;
    let text: string;
    switch (staging.status) {
      case 'idle':
        // A picked video waits for Next (see `confirmVideo`); say what Next will do.
        if (mode !== 'video' || video === confirmedVideo) { return null; }
        icon = <Icon name="info" size={16} color={COLORS.textSecondary} />;
        text = 'When you tap Next, it uploads and is checked against known recordings.';
        break;
      case 'uploading':
        text = `Uploading your ${what} · ${Math.round(staging.fraction * 100)}%`;
        break;
      case 'checking':
        text = 'Checking it against known recordings…';
        break;
      case 'ready':
        if (needsAnswer) {
          return (
            <View style={styles.matchCard}>
              <Text style={styles.matchTitle}>This sounds like a known recording</Text>
              <Text style={styles.matchBody}>
                {describeMatch(staging.staged.scan)} — tell us how it relates to you before you post.
              </Text>
              <Button label="Answer" onPress={() => { void answerMatchNow(); }} variant="primary" size="sm" />
            </View>
          );
        }
        icon = <Icon name="check" size={16} color={COLORS.purpleLight} weight="bold" />;
        text = staging.staged.declaration
          ? 'Uploaded · your answer is saved for when you post'
          : staging.staged.scan.status === 'complete'
            ? 'Uploaded · no match with known recordings'
            : "Uploaded · couldn't check it yet, it's checked again when you post";
        break;
      case 'failed': {
        if (!staging.network) {
          icon = <Icon name="info" size={16} color={COLORS.textSecondary} />;
          text = "Couldn't upload it yet — it will upload when you post.";
          break;
        }
        // Once Post has been tapped it owns retrying, so this one no longer retries by itself.
        const copy = interruptionCopy({
          offline,
          autoRetryUsed: stagingAutoUsed || !!postFailure,
          reason: staging.reason,
        });
        return (
          <View style={styles.matchCard}>
            <View style={styles.interruptHead}>
              {copy.showTryAgain
                ? <Icon name="offline" size={16} color={COLORS.warning} />
                : <ActivityIndicator size="small" color={COLORS.warning} />}
              <Text style={styles.matchTitle}>{copy.title}</Text>
            </View>
            <Text style={styles.matchBody}>{copy.body}</Text>
            {copy.showTryAgain ? (
              <>
                <Text style={styles.stagingText}>Or carry on — it uploads when you post.</Text>
                <Button label="Try again" onPress={retryStagingNow} variant="primary" size="sm" />
              </>
            ) : null}
          </View>
        );
      }
      default:
        return null;
    }
    return (
      <View style={styles.stagingRow}>
        {icon}
        <Text style={styles.stagingText}>{text}</Text>
      </View>
    );
  };

  // The inline player under the picked song: confirms it is the right file, and is what
  // reports its length (previewDurationSec) before anything is posted.
  const renderInlinePlayer = () => (previewMedia ? (
    <View style={styles.previewCard}>
      <MediaPlayer
        ref={previewRef}
        postId="upload_preview"
        media={previewMedia}
        paused={previewPaused}
        onTogglePaused={() => setPreviewPaused(p => !p)}
        onProgress={handlePreviewProgress}
        onLoaded={setPreviewDurationSec}
        onEnded={handlePreviewEnded}
        visible
        pauseWhenOffScreen={false}
        repeat
      />
      {/* Same control the jam room uses: whole track, no clip, swipe to scrub. */}
      {previewDurationSec && previewDurationSec > 0 ? (
        <View style={styles.previewSeekWrap}>
          <View style={styles.previewTimeRow}>
            <Text style={styles.previewTimeText}>{formatClock(0)}</Text>
            <Text style={styles.previewTimeNow}>{formatClock(previewPositionSec)}</Text>
            <Text style={styles.previewTimeText}>{formatClock(previewDurationSec)}</Text>
          </View>
          <WaveformScrubber
            position={previewPositionSec}
            duration={previewDurationSec}
            seed={previewMedia.kind === 'audio' ? (audio?.uri ?? '') : (video?.uri ?? '')}
            span="full"
            height={44}
            onSeekStart={handlePreviewScrubStart}
            onSeek={handlePreviewScrub}
            onSeekEnd={handlePreviewSeekEnd}
          />
        </View>
      ) : null}
    </View>
  ) : null);

  const typeCard = (value: PostMode, label: string, sub: string, icon: 'musicNote' | 'camera') => {
    const active = mode === value;
    return (
      <TouchableOpacity
        onPress={() => handleModeChange(value)}
        activeOpacity={0.85}
        disabled={submitting}
        style={[styles.typeCard, active && styles.typeCardActive]}
        accessibilityRole="radio"
        accessibilityState={{ checked: active }}
      >
        {active ? <GradientBorder borderRadius={14} /> : null}
        <View style={[styles.typeIcon, active && styles.typeIconActive]}>
          <Icon name={icon} size={22} color={active ? COLORS.purpleLight : COLORS.textSecondary} />
        </View>
        <View style={styles.typeText}>
          <Text style={styles.typeLabel}>{label}</Text>
          <Text style={styles.typeSub}>{sub}</Text>
        </View>
        <View style={[styles.radio, active && styles.radioOn]}>
          {active ? <Icon name="check" size={13} color={COLORS.white} weight="bold" /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  const mediaSlot = fileSlots[0];
  const imageSlot = fileSlots[1];
  const mediaSummary = mediaFile
    ? [
        mediaFile.name ?? 'Selected file',
        previewDurationSec && previewDurationSec > 0 ? formatClock(previewDurationSec) : null,
        mediaFile.size != null ? formatBytes(mediaFile.size) : null,
      ].filter(Boolean).join(' · ')
    : '';
  const tagLine = tags.length > 0 ? tags.slice(0, 3).map(t => `#${t}`).join(' ') : '';
  const collabLine = collaborators.length > 0
    ? ` · with ${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'}`
    : '';

  const renderSteps = () => (
    <>
      <UploadStep
        number={1}
        title="Audio or video"
        hint="What are you posting?"
        summary={studio ? 'Song · made in the Editor' : mode === 'audio' ? 'Song' : 'Video'}
        state={stepState('type')}
        onOpen={() => openStep('type')}
        // An Editor post is a song: no switching it to a video.
        disabled={submitting || !!studio}
      >
        <View style={styles.typeGroup}>
          {typeCard('audio', 'Song', 'An audio file, with cover art', 'musicNote')}
          {typeCard('video', 'Video', 'A music video, with a feed thumbnail', 'camera')}
        </View>
        {renderNext(mode === 'audio' ? 'Next: choose your song' : 'Next: choose your video', true, '')}
      </UploadStep>

      <UploadStep
        number={2}
        title={mode === 'audio' ? 'Your song' : 'Your video'}
        hint={mode === 'audio' ? 'mp3, wav, m4a, flac or ogg' : 'mp4, mov or webm'}
        summary={mediaSummary}
        state={stepState('media')}
        onOpen={() => openStep('media')}
        disabled={submitting}
      >
        {renderFileSlot(mediaSlot)}
        {mode === 'audio' && studioFile && audio === studioFile && !studioConfirmed ? (
          <Text style={styles.studioNote}>
            Your mix from the Editor, lossless (FLAC). It starts uploading when you tap Next, and
            an outside service checks it for copyright.
          </Text>
        ) : null}
        {renderStagingStatus()}
        {renderInlinePlayer()}
        {renderNext(
          mode === 'audio' ? 'Next: cover' : 'Next: thumbnail',
          Boolean(mediaFile) && lengthKnown,
          !mediaFile
            ? (mode === 'audio' ? 'Choose your song to continue.' : 'Choose your video to continue.')
            : 'Reading the file…',
        )}
      </UploadStep>

      <UploadStep
        number={3}
        title={mode === 'audio' ? 'Cover' : 'Thumbnail'}
        hint={mode === 'audio' ? 'A square picture · jpg, png or webp' : 'Shown in the feed · jpg, png or webp'}
        summary={imageFile?.name ?? 'Selected'}
        state={stepState('cover')}
        onOpen={() => openStep('cover')}
        disabled={submitting}
        leading={imageFile ? <Image source={{ uri: imageFile.uri }} style={styles.stepThumb} /> : null}
      >
        {renderFileSlot(imageSlot)}
        {imageFile ? (
          <Image source={{ uri: imageFile.uri }} style={styles.imagePreview} resizeMode="cover" />
        ) : null}
        {renderNext('Next: details', Boolean(imageFile), mode === 'audio' ? 'Choose a cover to continue.' : 'Choose a thumbnail to continue.')}
      </UploadStep>

      <UploadStep
        number={4}
        title="Details"
        hint="Title, description and tags"
        summary={`"${title.trim()}"${tagLine ? ` · ${tagLine}` : ''}`}
        state={stepState('details')}
        onOpen={() => openStep('details')}
        disabled={submitting}
      >
        <View style={styles.fieldGroup}>
          {/* The one required field here, said as plainly as the "· optional" ones are —
              amber until it is filled in. */}
          <Text style={styles.label}>
            Title <Text style={title.trim() ? null : styles.labelNeeded}>· needed</Text>
          </Text>
          <FormInput
            value={title}
            onChangeText={setTitle}
            placeholder="Name your track"
            maxLength={120}
            editable={!submitting}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Description · optional</Text>
          <FormInput
            // Children, not `value`: the text with its @tags coloured (useMentionInput).
            onChangeText={setDescription}
            onSelectionChange={mention.onSelectionChange}
            placeholder="Tell people about this track"
            multiline
            maxLength={2000}
            editable={!submitting}
            wrapperStyle={styles.descriptionWrapper}
            style={styles.descriptionInput}
          >
            {mention.styled}
          </FormInput>
          {/* @ to tag someone (a collaborator, a friend). Under the field; the page makes room. */}
          <MentionSuggestions
            query={mention.query}
            onSelect={mention.select}
            variant="card"
            onHeightChange={mentionRoom.onHeightChange}
          />
        </View>
        {/* Tags sit with the description, not behind a disclosure: they decide whether
            anyone not already following you ever finds the track. The moods are one-tap
            suggestions under the field. */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Tags · optional</Text>
          <Text style={styles.tagsHint}>
            How people find your track. Tap the moods that fit, or add something else —
            genre, language, whatever you'd search for. Listeners never see these.
          </Text>
          <TagInput
            tags={tags}
            onChange={setTags}
            editable={!submitting}
            suggestions={EMOTION_TAGS}
            onFieldFocus={revealFocusedField}
          />
        </View>
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
        {renderNext('Next: your role', title.trim().length > 0, 'Add a title to continue.')}
      </UploadStep>

      <UploadStep
        number={5}
        title="Your role"
        hint="What did you do on this track? Pick all that apply"
        summary={uploaderRoles.join(', ')}
        state={stepState('role')}
        onOpen={() => openStep('role')}
        disabled={submitting}
      >
        {/* The uploader's own credit, required: a credit list that names the guitarist and
            the mixer but not the person who made the record is not a credit list. Human roles
            only — an AI role describes what a TOOL did, and the tool is credited as a
            collaborator in its own right. */}
        <Text style={[styles.label, styles.roleLabel]}>
          Pick everything you did, up to {MAX_UPLOADER_ROLES}{' '}
          <Text style={uploaderRoles.length > 0 ? null : styles.labelNeeded}>· needed</Text>
        </Text>
        <RolePicker
          roles={uploaderRoles}
          onChange={setUploaderRoles}
          presets={ROLES}
          max={MAX_UPLOADER_ROLES}
          editable={!submitting}
          onFieldFocus={revealFocusedField}
        />
        {renderNext('Next: credits', uploaderRoles.length > 0, 'Pick what you did on this track to continue.')}
      </UploadStep>

      <UploadStep
        number={6}
        title="Credits"
        hint="Who else worked on it · optional"
        summary={
          collaborators.length > 0
            ? `${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'}`
            : 'Just you'
        }
        state={stepState('credits')}
        onOpen={() => openStep('credits')}
        disabled={submitting}
      >
        <View style={styles.collabHeader}>
          <Text style={styles.label}>Collaborators · optional</Text>
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
          <>
            <View style={styles.chipsWrap}>
              {collaborators.map(c => {
                const tone = getChipTone(c.kind, 'pending');
                const palette = getChipStyle(tone);
                return (
                  <View
                    key={c.clientId}
                    style={[styles.chip, { backgroundColor: palette.bg, borderColor: palette.border }]}
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
            <View style={styles.chipLegend}>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: getChipStyle('pending').border }]} />
                <Text style={styles.legendText}>Waiting on Livil user</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: getChipStyle('custom').border }]} />
                <Text style={styles.legendText}>Not on Livil yet</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: getChipStyle('accepted').border }]} />
                <Text style={styles.legendText}>Accepted (after they confirm)</Text>
              </View>
            </View>
          </>
        )}
        {renderNext('Next: rights', true, '')}
      </UploadStep>

      <UploadStep
        number={7}
        title="Rights"
        hint="Let Livil stream it"
        summary="Streaming allowed"
        state={stepState('rights')}
        onOpen={() => openStep('rights')}
        disabled={submitting}
        isLast
      >
        <Choice
          label="I grant Livil permission to stream this recording in the app"
          hint="Required to post. You keep your rights — this lets Livil play it to listeners."
          selected={grantedStreaming}
          onPress={() => setGrantedStreaming(v => !v)}
          compact
          shape="checkbox"
        />
        {renderNext('Next: preview', grantedStreaming, 'Tick the box to continue.')}
      </UploadStep>

      {step === 'type' ? (
        // Quiet, and below the steps: the artist came here to upload, and a phone upload
        // is a perfectly good outcome. This is for someone who did not know there was
        // anywhere else to be.
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { Linking.openURL(STUDIO_URL).catch(() => {}); }}
          style={styles.studioCard}
        >
          <Text style={styles.studioTitle}>Got a laptop nearby?</Text>
          <Text style={styles.studioBody}>
            Livil for Creators publishes from your desktop — masters up to 2 GB, uploads
            that resume if the connection drops, and a whole folder at once.
          </Text>
          <Text style={styles.studioLink}>livil-music.com →</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );

  const copyrightLine =
    staging.status === 'ready'
      ? staging.staged.declaration
        ? 'Matched a known recording · your answer is saved'
        : needsAnswer
          ? 'Matched a known recording · answer needed'
          : staging.staged.scan.status === 'complete'
            ? 'No match with known recordings'
            : "Couldn't check yet — it's checked again when you post"
      : staging.status === 'uploading' || staging.status === 'checking'
        ? 'Still checking — finishes when you post'
        : 'Checked when you post';

  const renderPreview = () => (
    <>
      <Text style={styles.previewIntro}>This is how your post looks in the feed.</Text>
      <UploadPreviewCard
        author={author}
        title={title}
        caption={description}
        mediaKind={mode}
        imageUri={imageFile?.uri ?? null}
        durationSec={previewDurationSec}
        playing={!previewPaused}
        // A song plays in the card itself, like a feed post; a video keeps its thumbnail
        // and plays in the full-screen frame below.
        mediaSlot={mode === 'audio' && previewMedia ? (
          <MediaPlayer
            postId="upload_preview"
            media={previewMedia}
            paused={previewPaused}
            onTogglePaused={() => setPreviewPaused(p => !p)}
            onProgress={handlePreviewProgress}
            onLoaded={s => setPreviewDurationSec(prev => prev ?? s)}
            onEnded={handlePreviewEnded}
            visible
            pauseWhenOffScreen={false}
            repeat
            ref={previewRef}
            style={styles.cardPlayer}
          />
        ) : undefined}
        onOpen={() => setPreviewPaused(p => !p)}
      />
      {mode === 'video' && previewMedia ? (
        // Videos only: what full screen does to the picture. The player fills the screen
        // with the video and crops the edges, and listeners tap and pinch to zoom out to
        // the whole frame — worth seeing before posting. A song's full screen is just its
        // cover, which the card above already shows.
        <View style={styles.fsSection}>
          <Text style={styles.fsTitle}>How it looks in full screen</Text>
          <FullScreenFrame
            media={previewMedia as Extract<MediaShape, { kind: 'video' }>}
            width={FS_FRAME_W}
            height={FS_FRAME_H}
            radius={FS_FRAME_RADIUS}
            border={FS_FRAME_BORDER}
            paused={previewPaused}
            onTogglePaused={() => setPreviewPaused(p => !p)}
            onProgress={handlePreviewProgress}
            onLoaded={s => setPreviewDurationSec(prev => prev ?? s)}
            onEnded={handlePreviewEnded}
            onPinchingChange={setPinching}
            playerRef={previewRef}
          />
          {/* Icons beside the text, never inside it — they are SVGs (CLAUDE.md). */}
          <View style={styles.fsCaptionRow}>
            <Icon name="handTap" size={16} color={COLORS.purpleLight} />
            <Icon name="zoomOut" size={16} color={COLORS.purpleLight} />
            <Text style={styles.fsCaption}>
              Listeners can tap and pinch to zoom out and see the whole video.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.summaryList}>
        <TouchableOpacity style={styles.summaryRow} onPress={() => openStep('details')} disabled={submitting}>
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>Tags · only used for search</Text>
            <Text style={styles.summaryValue} numberOfLines={2}>
              {tags.length > 0 ? tags.map(t => `#${t}`).join(' ') : 'None'}
            </Text>
          </View>
          <Text style={styles.summaryEdit}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.summaryRow} onPress={() => openStep(uploaderRoles.length > 0 ? 'credits' : 'role')} disabled={submitting}>
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>Credits</Text>
            <Text style={styles.summaryValue} numberOfLines={2}>
              {uploaderRoles.length > 0 ? `You · ${uploaderRoles.join(', ')}${collabLine}` : 'Your role is still needed'}
            </Text>
          </View>
          <Text style={styles.summaryEdit}>Edit</Text>
        </TouchableOpacity>
        {selectedAlbum ? (
          <TouchableOpacity style={styles.summaryRow} onPress={() => openStep('details')} disabled={submitting}>
            <View style={styles.summaryText}>
              <Text style={styles.summaryLabel}>Album</Text>
              <Text style={styles.summaryValue} numberOfLines={1}>{selectedAlbum.title}</Text>
            </View>
            <Text style={styles.summaryEdit}>Edit</Text>
          </TouchableOpacity>
        ) : null}
        {copyrightLine ? (
          <View style={styles.summaryRow}>
            <View style={styles.summaryText}>
              <Text style={styles.summaryLabel}>Copyright check</Text>
              <Text style={styles.summaryValue}>{copyrightLine}</Text>
            </View>
          </View>
        ) : null}
        <TouchableOpacity style={[styles.summaryRow, styles.summaryRowLast]} onPress={() => openStep('rights')} disabled={submitting}>
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>Streaming permission</Text>
            <Text style={styles.summaryValue}>{grantedStreaming ? 'Granted' : 'Still needed'}</Text>
          </View>
          <Text style={styles.summaryEdit}>Edit</Text>
        </TouchableOpacity>
      </View>

      {missing.length > 0 ? (
        <View style={styles.missingBox}>
          <Text style={styles.missingTitle}>Before you can post</Text>
          <View style={styles.missingRow}>
            {missing.map(m => (
              <TouchableOpacity key={m.key} onPress={() => openStep(m.key)} style={styles.missingChip}>
                <Text style={styles.missingChipText}>Add {m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );

  // Post stopped by the connection: where the progress bar was, so it is seen at once.
  const renderPostInterrupted = (reason: string) => {
    const copy = interruptionCopy({ offline, autoRetryUsed: postAutoRetried, reason });
    return (
      <View style={styles.footerStack}>
        <View style={styles.interruptHead}>
          {copy.showTryAgain
            ? <Icon name="offline" size={18} color={COLORS.warning} />
            : <ActivityIndicator size="small" color={COLORS.purpleLight} />}
          <Text style={styles.progressLabel}>{copy.title}</Text>
        </View>
        <Text style={styles.interruptBody}>{copy.body}</Text>
        {copy.showTryAgain ? (
          <Button
            label="Try again"
            onPress={() => { void handleSubmit(); }}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSubmit}
          />
        ) : null}
      </View>
    );
  };

  const headerBack = () => {
    if (submitting) { return; }
    if (reviewing) { setReviewing(false); return; }
    if (hasWork) { void askToDiscard(); return; }
    navigation.goBack();
  };

  // An Editor mix already has its own draft, in the Editor.
  const canSaveDraft = uploadDraftsAvailable() && !studio;
  const leaveUpload = () => {
    setConfirmDiscard(false);
    navigation.goBack();
  };
  const saveAsDraft = async () => {
    setSavingDraft(true);
    try {
      const userId = await owner();
      if (!userId) { throw new Error('No signed-in user'); }
      const existing = draftRef.current;
      await saveUploadDraft(userId, {
        id: existing?.id ?? newDraftId(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        durationSec: previewDurationSec ?? existing?.durationSec ?? 0,
        title,
        mode,
        description,
        tags,
        uploaderRoles,
        collaborators,
        album: selectedAlbum,
        media: mediaFile,
        picture: imageFile,
      });
      console.log('[LIVIL][upload] saved as a draft');
      showToast('Saved to your drafts.', { kind: 'success' });
      leaveUpload();
    } catch (err) {
      console.log('[LIVIL][upload] draft not saved', err);
      const message = err instanceof Error && /space/.test(err.message) ? err.message : "Couldn't save the draft. Try again.";
      showToast(message, { kind: 'error' });
    } finally {
      setSavingDraft(false);
    }
  };

  const barPercent = reviewing ? 100 : Math.round((doneCount / STEP_ORDER.length) * 100);
  const progressLabel = awaitingStaging
    ? staging.status === 'checking'
      ? 'Checking it against known recordings…'
      : `Uploading your ${mode === 'audio' ? 'song' : 'video'}…`
    : progressStage === 'preparing'
      ? 'Preparing files…'
      : progressStage === 'checking'
        ? 'Checking it against known recordings…'
        : progressStage === 'finalizing'
          ? 'Saving track…'
          : 'Uploading…';
  const progressPct = awaitingStaging
    ? (staging.status === 'uploading' ? Math.round(staging.fraction * 100) : null)
    : progressStage === 'uploading' ? Math.round(progressFraction * 100) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={headerBack}
          activeOpacity={0.7}
          disabled={submitting}
          style={styles.headerBack}
          accessibilityRole="button"
          accessibilityLabel={reviewing ? 'Back to the steps' : 'Close upload'}
        >
          <Icon name="back" size={26} color={submitting ? COLORS.textMuted : COLORS.purple} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{reviewing ? 'Preview' : 'Upload'}</Text>
        <Text style={styles.headerStep}>
          {reviewing ? '' : `Step ${STEP_ORDER.indexOf(step) + 1} of ${STEP_ORDER.length}`}
        </Text>
      </View>
      <View style={styles.stepBar} onLayout={e => setStepBarW(e.nativeEvent.layout.width)}>
        <View style={[styles.stepBarFill, { width: `${barPercent}%` }]}>
          {stepBarW > 0 ? <GradientFill width={stepBarW} height={4} /> : null}
        </View>
      </View>

      <View ref={scrollFrameRef} style={styles.flex} collapsable={false}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        // As on Search and New message: dragging the page puts the keyboard away.
        keyboardDismissMode="on-drag"
        scrollEnabled={!pinching}
        // Room between a focused field and the keyboard — the Next button under it included.
        bottomOffset={mentionRoom.bottomOffset}
        showsVerticalScrollIndicator={false}
      >
        {/* Measured by revealFocusedField; collapsable={false} keeps it a real native view. */}
        <View ref={scrollInnerRef} collapsable={false}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {needsAnswer && !reviewing && step !== 'media' ? (
          <View style={styles.matchCard}>
            <Text style={styles.matchTitle}>
              Your {mode === 'audio' ? 'song' : 'video'} sounds like a known recording
            </Text>
            <Text style={styles.matchBody}>Answer one question about it before you post.</Text>
            <Button label="Answer now" onPress={() => { void answerMatchNow(); }} variant="primary" size="sm" />
          </View>
        ) : null}
        {/* A video starts uploading as they leave its step, so its progress follows them. */}
        {mode === 'video' && !needsAnswer && !reviewing && step !== 'media' && staging.status !== 'idle'
          ? <View style={styles.stagingBanner}>{renderStagingStatus()}</View>
          : null}

        {draftLoading
          ? <ActivityIndicator color={COLORS.purpleLight} style={styles.progressSpinner} />
          : reviewing ? renderPreview() : renderSteps()}

        <View style={styles.scrollSpacer} />
        </View>
      </KeyboardAwareScrollView>
      </View>

      {reviewing ? (
        <View style={styles.footer}>
          {submitting ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressLabel}>{progressLabel}</Text>
                <Text style={styles.progressPercent}>{progressPct != null ? `${progressPct}%` : ''}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width:
                        progressPct != null
                          ? `${Math.max(2, progressPct)}%`
                          : progressStage === 'finalizing' || progressStage === 'checking'
                            ? '100%'
                            : '6%',
                    },
                  ]}
                />
              </View>
              {progressPct == null ? (
                <ActivityIndicator color={COLORS.purpleLight} style={styles.progressSpinner} />
              ) : null}
            </View>
          ) : postFailure ? (
            renderPostInterrupted(postFailure.reason)
          ) : (
            <View style={styles.footerStack}>
              <Button
                label="Post track"
                onPress={() => { void handleSubmit(); }}
                variant="primary"
                size="lg"
                fullWidth
                disabled={!canSubmit}
              />
            </View>
          )}
        </View>
      ) : null}

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
                ? `It's live. ${collaboratorCount} collaborator${
                    collaboratorCount === 1 ? '' : 's'
                  } will be asked to confirm.`
                : "It's live on your profile."}
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

      {canSaveDraft ? (
        <ConfirmActionModal
          visible={confirmDiscard}
          title={openedDraftId ? 'Save your changes?' : 'Save this as a draft?'}
          message={openedDraftId
            ? 'If you discard them, your draft stays as it was.'
            : "If you discard it, everything you've filled in is lost. Drafts stay on this phone."}
          tone="primary"
          icon="pencilLine"
          confirmLabel="Save draft"
          altLabel={openedDraftId ? 'Discard changes' : 'Discard'}
          onAlt={leaveUpload}
          cancelLabel="Keep editing"
          busy={savingDraft}
          onConfirm={() => { void saveAsDraft(); }}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : (
        <ConfirmActionModal
          visible={confirmDiscard}
          title="Discard this upload?"
          message="Everything you've filled in will be lost."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={leaveUpload}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      <AddToAlbumSheet
        visible={albumSheetOpen}
        mode="pick"
        onClose={() => setAlbumSheetOpen(false)}
        onPicked={album => setSelectedAlbum({ id: album.id, title: album.title })}
      />

      {/* Only reached when the scan actually matched something — now usually at step 2,
          while the song uploads early; at Post for a video or when the early upload
          failed. `key` IS LOAD-BEARING: the modal is mounted for the life of the screen,
          so without a fresh key its chosen option, licence fields and BOTH consent boxes
          outlived the question that set them — a second match opened pre-filled with the
          previous track's declaration, one tap from a rights statement about the wrong
          song. Keying it on the question number makes React throw the instance away. */}
      <CopyrightMatchModal
        key={matchSeq}
        visible={pendingMatch !== null}
        matchDescription={describeMatch(pendingMatch)}
        onAnswer={answerMatch}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fromEditor: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, borderWidth: 1, borderColor: COLORS.purple },
  fromEditorText: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700' },
  studioNote: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 10 },
  studioCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  studioTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  studioBody: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
  studioLink: {
    color: COLORS.purpleNeon,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 8,
  },
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
  headerTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: SCROLL_PAD_TOP,
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
  // Not a card any more — no fill, no outline, no rounding. The media sits
  // straight on the page and keeps its own square corners.
  previewCard: {
    marginBottom: 24,
  },
  previewSeekWrap: { width: '100%', marginTop: 4, marginBottom: 4 },
  // start · now · end above the bar, matching FullScreenPlayer — including the
  // negative pull into the scrubber's transparent top slop.
  previewTimeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: SCRUBBER_LABEL_PULL },
  previewTimeText: { color: COLORS.white, fontSize: 12, fontVariant: ['tabular-nums'] },
  previewTimeNow: { color: COLORS.purpleLight, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // One file per step now, so the row is its own card rather than a line in a group.
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    gap: 12,
    marginBottom: 14,
  },
  fileText: {
    flex: 1,
  },
  fileLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
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
  tagsHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 10,
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
  footerStack: {
    gap: 10,
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

  // ── Steps ──
  headerBack: { width: 44, height: 44, justifyContent: 'center' },
  headerStep: {
    minWidth: 44,
    textAlign: 'right',
    color: COLORS.textSecondary,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  // A progress bar IS its fill: GradientFill at the full track width, clipped by the fill.
  stepBar: { height: 4, backgroundColor: COLORS.border, overflow: 'hidden' },
  stepBarFill: { height: 4, overflow: 'hidden' },
  noticeBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  noticeText: { color: COLORS.white, fontSize: 14, lineHeight: 20 },
  nextWrap: { marginTop: 6, gap: 8 },
  nextWhy: { color: COLORS.textSecondary, fontSize: 12, textAlign: 'center' },
  stagingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  // The same row above the later steps; its own bottom margin spaces it from the steps.
  stagingBanner: { paddingHorizontal: 4 },
  stagingText: { flex: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  typeGroup: { gap: 10, marginBottom: 6 },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  // Selected: the gradient outline carries it; no purple fill (Button rule).
  typeCardActive: { borderColor: 'transparent', backgroundColor: COLORS.bg },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIconActive: { backgroundColor: COLORS.purpleDim },
  typeText: { flex: 1 },
  typeLabel: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  typeSub: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  // A radio's ticked state is a small indicator — solid is allowed and reads as "on".
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  stepThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: COLORS.card },
  imagePreview: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    marginBottom: 14,
  },

  labelNeeded: { color: COLORS.warning },
  roleLabel: { marginBottom: 10 },
  matchCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    backgroundColor: COLORS.warningBg,
    gap: 8,
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  matchTitle: { color: COLORS.warning, fontSize: 14, fontWeight: '700' },
  interruptHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  interruptBody: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  matchBody: { color: COLORS.white, fontSize: 13, lineHeight: 18 },

  // ── Preview page ──
  cardPlayer: { width: '100%', aspectRatio: 1 },
  fsSection: { alignItems: 'center', marginBottom: 22 },
  fsTitle: {
    alignSelf: 'flex-start',
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  fsCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 8 },
  fsCaption: { flexShrink: 1, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  previewIntro: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 12 },
  previewHint: { color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  summaryList: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryText: { flex: 1 },
  summaryLabel: { color: COLORS.textSecondary, fontSize: 12 },
  summaryValue: { color: COLORS.white, fontSize: 15, marginTop: 2 },
  summaryEdit: { color: COLORS.purpleLight, fontSize: 14, fontWeight: '600' },
  missingBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    backgroundColor: COLORS.warningBg,
    gap: 10,
  },
  missingTitle: { color: COLORS.warning, fontSize: 14, fontWeight: '700' },
  missingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  missingChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
  },
  missingChipText: { color: COLORS.warning, fontSize: 13, fontWeight: '600' },
});
