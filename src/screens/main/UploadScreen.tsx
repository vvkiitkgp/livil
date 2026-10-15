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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { pick, keepLocalCopy, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';

import MediaPlayer, { type MediaPlayerHandle, type MediaShape } from '../../components/MediaPlayer';
import WaveformScrubber, { SCRUBBER_LABEL_PULL } from '../../components/WaveformScrubber';
import { usePlayback } from '../../contexts/PlaybackContext';
import FormInput from '../../components/FormInput';
import TagInput from '../../components/TagInput';
import { EMOTION_TAGS } from '../../../shared/constants/tags';
import { Button } from '../../components/Button';
import { COLORS } from '../../theme/colors';
import { haptics } from '../../utils/haptics';
import { GradientBorder } from '../../components/GradientBorder';
import type { RootStackParamList } from '../../navigation/types';
import {
  ROLES,
  getChipStyle,
  getChipTone,
  isPresetRole,
  type PendingCollaborator,
} from '../../constants/roles';
import {
  createTrack,
  discardStagedAudio,
  publishStagedAudioTrack,
  stageAudioUpload,
  StagingAbandonedError,
  sweepStagedUploads,
  UploadCancelledError,
  type CreateTrackStage,
  type PostMode,
  type StagedAudio,
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
import { MIN_TRACK_SECONDS, tooShortMessage } from '../../../shared/constants/media';
import { pickSquareImageFromGallery, pickVideoFromGallery } from '../../services/mediaPicks';
import type { PickedFile, TrackMediaKind } from '../../services/uploads';
import { onCollaboratorPicked } from '../../services/uploadEvents';
import { Icon } from '../../components/Icon';
import AddToAlbumSheet from '../../components/AddToAlbumSheet';
import UploadStep, { type UploadStepState } from '../../components/UploadStep';
import UploadPreviewCard, { type UploadPreviewAuthor } from '../../components/UploadPreviewCard';
import UploadPreviewPlayer from '../../components/UploadPreviewPlayer';
import { GradientFill } from '../../components/GradientFill';
import { supabase } from '../../../lib/supabase';
import { getMyProfile } from '../../services/profileService';

type UploadNavigation = NativeStackNavigationProp<RootStackParamList, 'Upload'>;

/**
 * The upload, as six steps in a vertical list and then a Preview page. One step is open at
 * a time; done steps fold into a ticked one-line summary and stay tappable, so the order is
 * a guide, not a lock. Post lives only on the Preview page, which also lists anything still
 * missing with a jump to the step that fixes it.
 */
type StepKey = 'type' | 'media' | 'cover' | 'details' | 'credits' | 'rights';
const STEP_ORDER: StepKey[] = ['type', 'media', 'cover', 'details', 'credits', 'rights'];

/** One early-upload attempt: abandoned once the screen moves on; holds its promise and result. */
type StagingToken = {
  abandoned: boolean;
  staged: StagedAudio | null;
  promise: Promise<StagedAudio | null> | null;
};

/** The early song upload + copyright check (audio only) — see the effect that runs it. */
type Staging =
  | { status: 'idle' }
  | { status: 'uploading'; fraction: number }
  | { status: 'checking' }
  | { status: 'ready'; staged: StagedAudio }
  | { status: 'failed' };

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

  const [mode, setMode] = useState<PostMode>('audio');
  const [audio, setAudio] = useState<PickedFile | null>(null);
  const [video, setVideo] = useState<PickedFile | null>(null);
  const [cover, setCover] = useState<PickedFile | null>(null);
  const [thumbnail, setThumbnail] = useState<PickedFile | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>([]);
  // Already normalized — `TagInput` commits the stored form, never the typed form. Seeded
  // with the emotions, pre-applied: the artist removes the ones this track is not, rather
  // than opting in to the ones it is.
  // Starts EMPTY; the moods are one-tap suggestions under the field (owner's call,
  // 2026-10-15 — they used to arrive pre-applied and had to be pruned).
  const [tags, setTags] = useState<string[]>([]);
  const [uploaderRole, setUploaderRole] = useState('');
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
  const [progressStage, setProgressStage] = useState<CreateTrackStage>('preparing');
  const [progressFraction, setProgressFraction] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);

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
          if (slot.kind === 'video') {setVideo(picked);}
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

  // ── The early song upload + copyright check ──────────────────────────────────
  //
  // Audio only. The song starts uploading the moment it is picked and the provider check
  // runs straight after, while the artist fills in the rest — so a match is raised at step
  // 2, not after the whole form and the whole upload. See `stageAudioUpload`.
  //
  // A match is NOT asked about when the check finishes: the artist answers on their own tap
  // (step 2's card, or the banner on the other steps), and Post asks if they never did. An
  // unprompted dialog would land on top of the photo picker, the collaborator picker, the
  // album sheet or the full-screen preview, and iOS refuses to present it there — the
  // question would never show, and Post would wait on it forever.
  //
  // Each attempt gets a token. A newer pick (or a removal, a switch to video, leaving the
  // screen) marks the old token abandoned, and an abandoned attempt removes whatever it
  // wrote. The token also carries the attempt's promise and, once done, its staged song —
  // read at Post, and cleared there once Post has taken it over.
  const [staging, setStaging] = useState<Staging>({ status: 'idle' });
  // A neutral note (not an error), e.g. after backing out at the copyright question.
  const [notice, setNotice] = useState('');
  const [stepBarW, setStepBarW] = useState(0);
  const stagingTokenRef = useRef<StagingToken | null>(null);
  const [awaitingStaging, setAwaitingStaging] = useState(false);

  // Songs staged on an earlier visit whose app was killed before they were posted.
  useEffect(() => { void sweepStagedUploads(); }, []);

  useEffect(() => {
    if (mode !== 'audio' || !audio) { return; }
    const token: StagingToken = { abandoned: false, staged: null, promise: null };
    stagingTokenRef.current = token;
    const abandoned = () => token.abandoned;
    setStaging({ status: 'uploading', fraction: 0 });
    const promise = stageAudioUpload(
      audio,
      p => {
        if (abandoned()) { return; }
        setStaging(p.stage === 'checking' ? { status: 'checking' } : { status: 'uploading', fraction: p.fraction });
      },
      abandoned,
    )
      .then(staged => {
        if (abandoned()) { void discardStagedAudio(staged); return null; }
        token.staged = staged;
        setStaging({ status: 'ready', staged });
        return staged;
      })
      .catch((err: unknown) => {
        if (err instanceof StagingAbandonedError || abandoned()) { return null; }
        console.log('[LIVIL][upload] early upload failed', err);
        setStaging({ status: 'failed' });
        return null;
      });
    token.promise = promise;
    return () => {
      // A different song, no song, video, or leaving the screen: this attempt is over.
      // A song Post has taken over is no longer on the token, so it is never removed here.
      token.abandoned = true;
      const staged = token.staged;
      token.staged = null;
      setStaging({ status: 'idle' });
      if (staged) { void discardStagedAudio(staged); }
    };
  }, [mode, audio]);

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
      void discardStagedAudio(staged);
      setAudio(null);
      setNotice('Upload cancelled. You can pick a different song.');
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
  const [step, setStep] = useState<StepKey>('type');
  const [reviewing, setReviewing] = useState(false);
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);

  const mediaFile = mode === 'audio' ? audio : video;
  const imageFile = mode === 'audio' ? cover : thumbnail;

  const stepDone: Record<StepKey, boolean> = {
    type: step !== 'type' || reviewing,
    media: Boolean(mediaFile),
    cover: Boolean(imageFile),
    details: title.trim().length > 0,
    credits: uploaderRole.trim().length > 0,
    rights: grantedStreaming,
  };
  const doneCount = STEP_ORDER.filter(k => stepDone[k]).length;
  const stepState = (key: StepKey): UploadStepState => {
    if (!reviewing && step === key) { return 'current'; }
    return stepDone[key] ? 'done' : 'todo';
  };

  const openStep = useCallback((key: StepKey) => {
    setPreviewPaused(true);
    setReviewing(false);
    setStep(key);
    setError('');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const openPreview = useCallback(() => {
    setPreviewPaused(true);
    setReviewing(true);
    setError('');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const goNext = useCallback(() => {
    const i = STEP_ORDER.indexOf(step);
    if (i >= STEP_ORDER.length - 1) { openPreview(); return; }
    openStep(STEP_ORDER[i + 1]);
  }, [step, openStep, openPreview]);

  // Android back on the Preview page returns to the steps, as the header arrow does —
  // never out of the screen with everything filled in. Mid-upload it does nothing.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (submitting) { return true; }
        if (!reviewing) { return false; }
        setReviewing(false);
        return true;
      });
      return () => sub.remove();
    }, [reviewing, submitting]),
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
    if (!uploaderRole.trim()) { out.push({ key: 'credits', label: 'your role' }); }
    if (!grantedStreaming) { out.push({ key: 'rights', label: 'streaming permission' }); }
    return out;
  }, [mediaFile, needsAnswer, imageFile, mode, title, uploaderRole, grantedStreaming]);

  const canSubmit = !submitting && missing.length === 0;

  const handleSubmit = useCallback(async () => {
    setPreviewPaused(true);
    setFullPreviewOpen(false);
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
      if (mode === 'audio') {
        const input = {
          mode: 'audio' as const,
          title,
          description,
          audio: audio!,
          cover: cover!,
          uploaderRole,
          collaborators,
          tags,
          durationSeconds: previewDurationSec,
          streamingGrantAccepted: grantedStreaming,
        };
        // The song may still be uploading or being checked: wait for it rather than start
        // a second copy. A match raised meanwhile is answered in the same dialog.
        const token = stagingTokenRef.current;
        let staged = token && !token.abandoned ? token.staged : null;
        if (token && !token.abandoned && !staged && token.promise) {
          setAwaitingStaging(true);
          staged = await token.promise;
          setAwaitingStaging(false);
          if (token.abandoned) { return; } // backed out at the question: the song is gone
        }
        if (token && staged) {
          // Post owns it now: leaving the screen must not remove it mid-publish. The
          // publish removes it itself if it fails.
          token.staged = null;
          token.promise = null;
          try {
            result = await publishStagedAudioTrack(staged, input, onProgress, askAboutMatch);
          } catch (err) {
            // Removed with everything else by the failed publish — so a retry goes the
            // classic way, uploading everything at Post.
            setStaging({ status: 'failed' });
            throw err;
          }
        } else {
          result = await createTrack(input, onProgress, askAboutMatch);
        }
      } else {
        result = await createTrack(
          {
            mode: 'video',
            title,
            description,
            video: video!,
            cover: cover ?? undefined,
            thumbnail: thumbnail!,
            uploaderRole,
            collaborators,
            tags,
            durationSeconds: previewDurationSec,
            streamingGrantAccepted: grantedStreaming,
          },
          onProgress,
          askAboutMatch,
        );
      }
      // Tag into the selected album if the user picked one. Fire-and-forget —
      // a failed album tag shouldn't block the success state of the upload.
      if (selectedAlbum && result?.trackId) {
        addTrackToAlbum(selectedAlbum.id, result.trackId).catch(() => {});
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
        return;
      }
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      // Clears whether the upload finished, failed, or was cancelled — and drops any
      // resolver still held, so an unanswered question cannot strand the next attempt.
      matchResolverRef.current = null;
      setPendingMatch(null);
      setSubmitting(false);
    }
  }, [missing, previewDurationSec, mode, title, description, audio, cover, uploaderRole, collaborators, tags, grantedStreaming, askAboutMatch, video, thumbnail, selectedAlbum]);

  // ── Pieces ───────────────────────────────────────────────────────────────────

  const renderNext = (label: string, enabled: boolean, why: string) => (
    <View style={styles.nextWrap}>
      <Button
        label={label}
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
        {file ? (
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

  // What the early upload and copyright check are doing, under the picked song.
  const renderStagingStatus = () => {
    if (mode !== 'audio' || !audio) { return null; }
    let icon: React.ReactNode = <ActivityIndicator size="small" color={COLORS.purpleLight} />;
    let text: string;
    switch (staging.status) {
      case 'uploading':
        text = `Uploading your song · ${Math.round(staging.fraction * 100)}%`;
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
      case 'failed':
        icon = <Icon name="info" size={16} color={COLORS.textSecondary} />;
        text = "Couldn't upload it yet — it will upload when you post.";
        break;
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
        summary={mode === 'audio' ? 'Song' : 'Video'}
        state={stepState('type')}
        onOpen={() => openStep('type')}
        disabled={submitting}
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
          <Text style={styles.label}>Description · optional</Text>
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
        {/* Tags sit with the description, not behind a disclosure: they decide whether
            anyone not already following you ever finds the track. The moods are one-tap
            suggestions under the field. */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Tags · optional</Text>
          <Text style={styles.tagsHint}>
            How people find your track. Tap the moods that fit, or add something else —
            genre, language, whatever you'd search for. Listeners never see these.
          </Text>
          <TagInput tags={tags} onChange={setTags} editable={!submitting} suggestions={EMOTION_TAGS} />
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
        {renderNext('Next: credits', title.trim().length > 0, 'Add a title to continue.')}
      </UploadStep>

      <UploadStep
        number={5}
        title="Credits"
        hint="What you did, and who helped"
        summary={`You · ${uploaderRole.trim()}${collabLine}`}
        state={stepState('credits')}
        onOpen={() => openStep('credits')}
        disabled={submitting}
      >
        {/* The uploader's own credit, required: a credit list that names the guitarist
            and the mixer but not the person who made the record is not a credit list. */}
        <Text style={styles.label}>Your role</Text>
        <View style={styles.ownRoleWrap}>
          {/* Human roles only. An AI role describes what a TOOL did, and the tool gets
              credited as a collaborator in its own right. */}
          {ROLES.map(r => {
            const active = uploaderRole === r;
            return (
              <TouchableOpacity
                key={r}
                activeOpacity={0.85}
                disabled={submitting}
                onPress={() => setUploaderRole(active ? '' : r)}
                style={[styles.roleChip, active && styles.roleChipActive]}
              >
                {active ? <GradientBorder borderRadius={999} /> : null}
                <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                  {r}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {/* The list will always be missing somebody's instrument. A closed list here
            would mean the wrong credit or, since this field is required, no upload. */}
        <FormInput
          value={isPresetRole(uploaderRole) ? '' : uploaderRole}
          onChangeText={setUploaderRole}
          placeholder="Or type your own — e.g. Tabla, Additional production"
          maxLength={40}
          autoCapitalize="words"
          editable={!submitting}
        />

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
        {renderNext('Next: rights', uploaderRole.trim().length > 0, 'Choose what you did on this track to continue.')}
      </UploadStep>

      <UploadStep
        number={6}
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
    mode !== 'audio'
      ? null
      : staging.status === 'ready'
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
        onOpen={() => setFullPreviewOpen(true)}
      />
      <Text style={styles.previewHint}>Tap the post to play it full screen.</Text>

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
        <TouchableOpacity style={styles.summaryRow} onPress={() => openStep('credits')} disabled={submitting}>
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>Credits</Text>
            <Text style={styles.summaryValue} numberOfLines={2}>
              {uploaderRole.trim() ? `You · ${uploaderRole.trim()}${collabLine}` : 'Your role is still needed'}
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

  const headerBack = () => {
    if (submitting) { return; }
    if (reviewing) { setReviewing(false); return; }
    navigation.goBack();
  };

  const barPercent = reviewing ? 100 : Math.round((doneCount / STEP_ORDER.length) * 100);
  const progressLabel = awaitingStaging
    ? 'Uploading your song…'
    : progressStage === 'preparing'
      ? 'Preparing files…'
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

      <KeyboardAwareScrollView
        ref={scrollRef}
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
        {notice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {needsAnswer && !reviewing && step !== 'media' ? (
          <View style={styles.matchCard}>
            <Text style={styles.matchTitle}>Your song sounds like a known recording</Text>
            <Text style={styles.matchBody}>Answer one question about it before you post.</Text>
            <Button label="Answer now" onPress={() => { void answerMatchNow(); }} variant="primary" size="sm" />
          </View>
        ) : null}

        {reviewing ? renderPreview() : renderSteps()}

        <View style={styles.scrollSpacer} />
      </KeyboardAwareScrollView>

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
                          : progressStage === 'finalizing'
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

      <UploadPreviewPlayer
        visible={fullPreviewOpen}
        media={previewMedia}
        title={title}
        artistLine={`${author.name}${uploaderRole.trim() ? ` · ${uploaderRole.trim()}` : ''}`}
        onClose={() => setFullPreviewOpen(false)}
        onDuration={s => setPreviewDurationSec(prev => prev ?? s)}
      />

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
  ownRoleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  // Selected state is the gradient outline; no fill — same as the collaborator picker.
  roleChipActive: { borderColor: 'transparent' },
  roleChipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  roleChipTextActive: { color: COLORS.purpleNeon, fontWeight: '700' },
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
  matchBody: { color: COLORS.white, fontSize: 13, lineHeight: 18 },

  // ── Preview page ──
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
