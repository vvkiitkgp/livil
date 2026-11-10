import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { usePreventRemove, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import { usePlayback } from '../../contexts/PlaybackContext';
import { useToast } from '../../contexts/ToastContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { draftsAvailable, loadDraft, newDraftId, saveDraft, writeDraftMix } from '../../services/drafts';
import { MIN_TRACK_SECONDS } from '../../../shared/constants/media';
import { encodeFlac } from '../../utils/audioFile/flac';
import { getMyUserId } from '../../services/session';
import { COLORS } from '../../theme/colors';
import { DEFAULT_FX } from '../../utils/audioFx/effects';
import { autoLevel } from '../../utils/audioFx/level';
import { analyzeTake, applyMagicTune, type TuneAnalysis } from '../../utils/magicTune';
import { DRUM_IDS, emptyPattern } from '../../utils/drums';
import { keyName } from '../../utils/magicTune';
import { BeatsSheet } from './BeatsSheet';
import { SynthSheet } from './SynthSheet';
import type { SynthKey, SynthPart } from '../../utils/synth';
import { EditorPanel } from './EditorPanel';
import { EffectsSheet } from './EffectsSheet';
import { FinalPanel } from './FinalPanel';
import { renderMix, type Mix } from './renderMix';
import { RecordPanel, type RecordedTake } from './RecordPanel';
import { repairTakeClicks, takeAtRate } from './finishTake';
import { clock12, displayTitle } from './draftFormat';
import { CLICK_REPAIR_VERSION } from '../../utils/audioClean/clickRepair';
import { CLEAN_VERSION, cleanTake } from '../../utils/audioClean';
import { StudioLoading } from './StudioLoading';
import { songRange, StudioEngine, type Project, type Take, type TuneChoice, type VoiceLane } from './studioEngine';
import { TunePanel } from './TunePanel';

type Phase = 'record' | 'tune' | 'editor' | 'final';

/** The last Editor session's audio shutdown; a new session waits for it before starting. */
let lastStudioShutdown: Promise<void> = Promise.resolve();
/** Bumped per session: a slow shutdown never hands audio back over a newer session. */
let studioOwner = 0;
type RawTake = RecordedTake;

let idSeq = 0;
const newId = () => `t${Date.now().toString(36)}${(idSeq++).toString(36)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Draft · 31 Oct, 11:40 am" — the title a draft gets until posting names it. */
function defaultDraftTitle(d = new Date()): string {
  return `Draft · ${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock12(d.getHours(), d.getMinutes())}`;
}

type DraftMeta = { id: string; title: string; createdAt: string };

/**
 * Record → Magic Tune → Editor. Opened by "Create" on the "+ Post" sheet (developer builds
 * only from 2026-10-30 until it shipped in 2.2.0). Work can be saved as a draft ON THIS PHONE
 * (src/services/drafts.ts, ADR-0036 §9); `route.params.draftId` reopens one. Create post
 * renders the mix and hands it to Upload (ADR-0036).
 *
 * Audio ownership (ADR-0034): on entry the feed player is paused and GlobalAudioPlayer is
 * UNMOUNTED via `setEngineDriving(true)`, so no RNV view holds the iOS session and no
 * MediaSession exists while the mic is live. Exit reverses it after the engine is closed.
 */
export default function StudioScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Studio'>>();
  const openDraftId = route.params?.draftId;
  const playback = usePlayback();
  const { showToast } = useToast();
  const engineRef = useRef<StudioEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('record');
  const [pending, setPending] = useState<RawTake | null>(null);
  const [project, setProject] = useState<Project>({ voices: [], drumsOn: true, pattern: emptyPattern(), drumVolume: 0.9, masterVolume: 1, synths: [], bpm: 92, range: null });
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [beatsOpen, setBeatsOpen] = useState(false);
  /** A voice reopened in Magic Tune from the Editor. */
  const [editing, setEditing] = useState<VoiceLane | null>(null);
  /** The voice whose effects sheet is open. */
  const [fxLaneId, setFxLaneId] = useState<string | null>(null);
  const fxLane = project.voices.find(v => v.id === fxLaneId) ?? null;
  /** The synth part whose sheet is open. */
  const [synthId, setSynthId] = useState<string | null>(null);
  const synthPart = project.synths.find(s => s.id === synthId) ?? null;
  // The key Magic Tune found in the first voice that has one — where a new synth starts.
  const tunedKey = project.voices.map(v => v.take.tune.key).find(k => k && k.mode !== 'chromatic');
  const voiceKey: SynthKey | null = tunedKey && tunedKey.mode !== 'chromatic' ? { tonic: tunedKey.tonic, mode: tunedKey.mode } : null;
  const [confirmExit, setConfirmExit] = useState(false);
  const [metronome, setMetronome] = useState(true);
  /** Record: take the tempo from the first voice (default) instead of setting one. */
  const [autoTempo, setAutoTempo] = useState(true);
  const restartNext = useRef(false);
  /** The Editor has been open this session: closing Record goes back to it, voice or no voice. */
  const seenEditor = useRef(false);
  const leaving = useRef(false);
  /**
   * Who this Editor session belongs to — looked up ONCE, when it starts (opening a draft needs
   * it anyway). Asking the sign-in again at Create post time came back empty with no error
   * (2026-11-02), and Create post silently did nothing, three times.
   */
  const ownerRef = useRef<string | null>(null);
  const owner = useCallback(async (): Promise<string | null> => {
    if (ownerRef.current) return ownerRef.current;
    const id = await getMyUserId().catch(e => { console.log('[LIVIL][STUDIO] sign-in lookup failed', e); return null; });
    if (id) ownerRef.current = id;
    else console.log('[LIVIL][STUDIO] sign-in lookup found nobody');
    return id;
  }, []);
  useEffect(() => { void owner(); }, [owner]);

  /** The draft this session saves into (set by the first save, or by opening one). */
  const [draft, setDraft] = useState<DraftMeta | null>(null);
  /** The project as last saved or opened: anything else is unsaved work. */
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  /**
   * Opened, then repaired or converted on load: on screen it is the saved draft, but the files
   * on the phone are still the old audio until the next save. A flag, NOT the old project kept
   * in state — that held every old take (~11 MB a minute each) alive for the whole session.
   */
  const [diskStale, setDiskStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(!!openDraftId);
  /** What opening a draft is doing, for the loading screen. */
  const [loadStep, setLoadStep] = useState<{ detail: string; progress: number | null }>({ detail: 'Getting the studio ready…', progress: null });
  /** The finished song for the "Your song" step, and the project it was mixed from. */
  const [mix, setMix] = useState<{ of: Project; mix: Mix } | null>(null);
  /** How far mixing + mastering has got, 0..1. */
  const [mixProgress, setMixProgress] = useState(0);
  /** Create post in progress: what it's doing (the button's label). */
  const [posting, setPosting] = useState<string | null>(null);

  if (!engineRef.current) engineRef.current = new StudioEngine(project);
  const engine = engineRef.current;
  // DIAGNOSTIC (dev builds only): lets the Mac-side debugger read what the engine is playing.
  if (__DEV__) (globalThis as { __livilStudio?: StudioEngine }).__livilStudio = engine;

  // ── ownership: take audio from the feed player, give it back on exit ─────────
  useEffect(() => {
    const { jamLocked, pauseAll, setEngineDriving } = playback;
    if (jamLocked) {
      showToast('Leave the Jam to record.', { kind: 'info' });
      leaving.current = true;
      navigation.goBack();
      return;
    }
    // The previous Editor session may still be shutting its audio down (Create post → Upload →
    // back → Editor again). It used to turn this one away with the Jam message; now this one
    // waits for it (briefly) and takes over. `token`: only the newest session hands audio back.
    const token = ++studioOwner;
    pauseAll();
    setEngineDriving(true);
    let alive = true;
    (async () => {
      await Promise.race([lastStudioShutdown, new Promise<void>(r => setTimeout(r, 3000))]);
      if (!alive) return;
      try {
        await engine.init();
        if (alive) setReady(true);
      } catch (e) {
        console.log('[LIVIL][STUDIO] init failed', e);
        showToast('Could not start the recorder on this phone.', { kind: 'error' });
        leaving.current = true;
        navigation.goBack();
      }
    })();
    return () => {
      alive = false;
      lastStudioShutdown = engine.dispose().finally(() => { if (studioOwner === token) setEngineDriving(false); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reopen a draft once the engine is up.
  useEffect(() => {
    if (!ready || !openDraftId) return;
    let alive = true;
    (async () => {
      try {
        const me = await owner();
        if (!me) throw new Error('Not signed in');
        setLoadStep({ detail: 'Reading your recordings…', progress: 0 });
        // Decoded at the Editor's rate, except takes still owed a click repair: those come at their
        // own rate, are repaired, THEN converted (conversion smears a click past repair).
        const d = await loadDraft(me, openDraftId, engine.sampleRate, CLICK_REPAIR_VERSION, (i, n) => setLoadStep({ detail: 'Reading your recordings…', progress: (0.4 * i) / n }));
        if (!alive) return;
        const voices = [];
        let repaired = 0;
        for (const v of d.project.voices) {
          const share = 0.6 / d.project.voices.length;
          const at = 0.4 + share * voices.length;
          let take = v.take;
          if ((take.clickRepair ?? 0) < CLICK_REPAIR_VERSION) {
            setLoadStep({ detail: 'Removing recorder clicks…', progress: at });
            take = await repairTakeClicks(take);
            repaired++;
          }
          if (take.sampleRate !== engine.sampleRate) {
            setLoadStep({ detail: 'Matching the studio sound…', progress: at + share / 2 });
            take = await takeAtRate(take, engine.sampleRate);
          }
          if (take.tune.clean && !cleanIsCurrent(take)) {
            // Cleaned before breath reduction existed: clean it again from the recording.
            setLoadStep({ detail: 'Cleaning up background…', progress: at + share / 2 });
            take = await rebuildTake(take, true, f => setLoadStep({ detail: 'Cleaning up background…', progress: at + (share / 2) * (1 + f) }));
          }
          voices.push(take === v.take ? v : { ...v, take, level: take.raw === v.take.raw ? v.level : autoLevel(take.raw, take.sampleRate) });
          if (!alive) return;
        }
        if (repaired) console.log(`[LIVIL][DRAFTS] recorder clicks repaired in ${repaired} take(s)`);
        const project = voices.some((v, i) => v !== d.project.voices[i]) ? { ...d.project, voices } : d.project;
        setProject(project);
        setSavedProject(project);
        engine.logMemory('draft opened');
        // Fixed on the way in: save that once, HERE, on the loading screen — so the next open is
        // instant, and no save is still writing behind the Editor (it stalled taps and playback,
        // and raced Create post, 2026-11-02).
        if (project !== d.project) {
          setLoadStep({ detail: 'Saving the fixes…', progress: 1 });
          const r = songRange(project);
          try {
            await saveDraft(me, project, { id: openDraftId, title: d.title, createdAt: d.createdAt, durationSec: r.end - r.start });
            console.log('[LIVIL][DRAFTS] repaired draft saved');
          } catch (e) {
            console.log('[LIVIL][DRAFTS] saving the repaired draft failed', e);
            setDiskStale(true); // shows "edited": the next save writes it
          }
          if (!alive) return;
        }
        setDraft({ id: openDraftId, title: d.title, createdAt: d.createdAt });
        setPhase('editor');
      } catch (e) {
        console.log('[LIVIL][DRAFTS] open failed', e);
        if (alive) showToast("Couldn't open that draft.", { kind: 'error' });
      } finally {
        if (alive) setOpening(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, openDraftId]);

  // Project → engine. Gains apply at once; timing edits ask for a restart.
  useEffect(() => {
    engine.setProject(project);
    if (restartNext.current) { restartNext.current = false; engine.restart(); }
  }, [engine, project]);

  // Playhead and level meter while playing. The level is kept to whole dB so the Editor only
  // re-renders for it when the reading actually changes.
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) { setLevel(null); return; }
    let tick = 0;
    const id = setInterval(() => {
      setPlayhead(engine.position());
      if (++tick % 4 === 0) {
        const db = engine.level();
        setLevel(db == null || !Number.isFinite(db) ? null : Math.round(db));
      }
    }, 50);
    return () => clearInterval(id);
  }, [engine, playing]);

  // Backgrounding pauses playback (a recording is stopped by RecordPanel itself).
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active' && engine.playing) { engine.stop(); setPlaying(false); }
    });
    return () => sub.remove();
  }, [engine]);

  // Something to keep: a voice, a beat or an instrument. A song can be saved without a voice
  // (beats first, sing later); an untouched new one is not work to warn about.
  const hasContent = project.voices.length > 0 || project.synths.length > 0 || DRUM_IDS.some(id => project.pattern[id].some(Boolean));
  const unsaved = (hasContent || !!draft) && (project !== savedProject || diskStale);
  // A finished mix belongs to one version of the project; drop it as soon as that changes (it
  // is two full-length channels, and it kept the old project's takes reachable too).
  useEffect(() => {
    if (mix && mix.of !== project) setMix(null);
  }, [mix, project]);
  const hasWork = unsaved || !!pending;
  // "Discard and leave" must lift the guard with a RE-RENDER before navigating: usePreventRemove
  // reads its flag from the last render, so flipping a ref and calling goBack() in the same
  // tick was still blocked (the button did nothing). State → render → effect → goBack.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(hasWork && !leaving.current && !discarding, () => setConfirmExit(true));

  const leave = useCallback(() => {
    leaving.current = true;
    setConfirmExit(false);
    engine.stop();
    setDiscarding(true);
  }, [engine]);
  useEffect(() => {
    if (discarding) navigation.goBack();
  }, [discarding, navigation]);

  /**
   * ONE thing at a time for Save / Save draft / Create post. A ref, not state: while the phone is
   * busy, taps queue up and state from the last render is stale, so three taps on Save draft ran
   * three saves and showed three toasts (2026-11-02). Later taps are simply ignored.
   */
  const actionRef = useRef(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const exclusive = useCallback(async (label: string, fn: () => Promise<void>) => {
    if (actionRef.current) { console.log(`[LIVIL][POST] "${label}" ignored: another save/post is running`); return; }
    actionRef.current = true;
    setActionBusy(label);
    try { await fn(); } finally { actionRef.current = false; setActionBusy(null); }
  }, []);

  /** Saves to drafts on this phone. The draft (and its owner) when it worked, else null. */
  const save = useCallback(async (opts?: { quiet?: boolean }): Promise<(DraftMeta & { userId: string }) | null> => {
    if (!draftsAvailable()) {
      showToast('Drafts need the app rebuilt first.', { kind: 'error' });
      return null;
    }
    setSaving(true);
    try {
      const me = await owner();
      if (!me) throw new Error('Not signed in');
      const meta = draft ?? { id: newDraftId(), title: defaultDraftTitle(), createdAt: new Date().toISOString() };
      const r = songRange(project);
      await saveDraft(me, project, { ...meta, durationSec: r.end - r.start });
      setDraft(meta);
      setSavedProject(project);
      setDiskStale(false);
      if (!opts?.quiet) showToast('Saved to drafts on this phone', { kind: 'success' });
      return { ...meta, userId: me };
    } catch (e) {
      console.log('[LIVIL][DRAFTS] save failed', e);
      showToast(e instanceof Error && e.message.startsWith('Not enough space') ? e.message : "Couldn't save the draft.", { kind: 'error' });
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, project, showToast, owner]);

  const togglePlay = useCallback(() => {
    if (engine.playing) { engine.stop(); setPlayhead(engine.position()); setPlaying(false); }
    else { void engine.play(); setPlaying(true); }
  }, [engine]);

  const update = useCallback((fn: (p: Project) => Project, restart = false) => {
    if (restart) restartNext.current = true;
    setProject(fn);
  }, []);

  /** The voice whose background is being cleaned (or un-cleaned) from the Editor, and how far. */
  const [cleaning, setCleaning] = useState<{ laneId: string; progress: number } | null>(null);
  /** Per recording: its cleaned version and its pitch analysis, so flipping back is instant. */
  const cleanedOf = useRef(new WeakMap<Float32Array, Float32Array>());
  const analysisOf = useRef(new WeakMap<Float32Array, TuneAnalysis>());

  /** Cleaned by the current cleanup (with breaths), so its cleaned audio may be reused. */
  const cleanIsCurrent = (t: Take) => t.tune.clean && (t.tune.cleanVersion ?? 1) >= CLEAN_VERSION;

  /**
   * A take rebuilt from its recording with cleanup on or off, and Magic Tuned again with the
   * same settings when it was tuned. Shared by the Clean switch and by drafts whose cleanup is
   * out of date. Memory: +1 cleaned copy (kept per recording, so flipping back is instant),
   * +1 tuned copy; the take it replaces is released by the caller.
   */
  const rebuildTake = useCallback(async (t: Take, on: boolean, onProgress: (f: number) => void): Promise<Take> => {
    let base = t.original;
    if (on) {
      const hit = cleanedOf.current.get(t.original);
      base = hit ?? await cleanTake(t.original, t.sampleRate, f => onProgress(f * 0.6));
      cleanedOf.current.set(t.original, base);
    }
    let tuned: Float32Array | null = null;
    if (t.tune.key && t.tuned) {
      let a = analysisOf.current.get(t.original);
      if (!a) {
        a = await analyzeTake(base, t.sampleRate, f => onProgress(0.6 + f * 0.4));
        analysisOf.current.set(t.original, a);
      }
      tuned = applyMagicTune(base, a, { key: t.tune.key, strength: t.tune.strength }).tuned;
    }
    return { ...t, id: newId(), raw: base, tuned, tune: { ...t.tune, clean: on, cleanVersion: on ? CLEAN_VERSION : t.tune.cleanVersion } };
  }, []);

  /** The Editor's Clean switch. */
  const toggleClean = useCallback(async (lane: VoiceLane) => {
    if (cleaning) return;
    const t = lane.take;
    engine.stop();
    setPlaying(false);
    setCleaning({ laneId: lane.id, progress: 0 });
    try {
      // Keep the cleaned audio for flipping back — only if it is from the current cleanup.
      if (cleanIsCurrent(t)) cleanedOf.current.set(t.original, t.raw);
      const take = await rebuildTake(t, !t.tune.clean, f => setCleaning({ laneId: lane.id, progress: f }));
      update(p => ({
        ...p,
        voices: p.voices.map(v => (v.id === lane.id ? { ...v, take, level: autoLevel(take.raw, take.sampleRate), tuneOn: v.tuneOn && !!take.tuned } : v)),
      }), true);
      engine.logMemory('clean toggled');
    } catch (e) {
      console.log('[LIVIL][CLEANUP] editor toggle failed', e);
      showToast("Couldn't clean up this voice.", { kind: 'error' });
    } finally {
      setCleaning(null);
    }
  }, [cleaning, engine, update, showToast, rebuildTake]);

  const addTake = useCallback((take: RawTake, base: Float32Array, tuned: Float32Array | null, tuneOn: boolean, choice: TuneChoice) => {
    const n = project.voices.length + 1;
    const lane: VoiceLane = {
      id: newId(),
      name: `Voice ${n}`,
      take: { id: newId(), sampleRate: take.sampleRate, raw: base, tuned, original: take.samples, tune: choice, clickRepair: CLICK_REPAIR_VERSION },
      // Line the take up with the beat it was recorded against (see stopRecording).
      start: Math.max(0, take.offset),
      trimStart: Math.max(0, -take.offset),
      trimEnd: take.samples.length / take.sampleRate,
      loops: 1,
      volume: 1,
      level: autoLevel(base, take.sampleRate),
      tuneOn: tuneOn && !!tuned,
      fx: { ...DEFAULT_FX, reverb: { ...DEFAULT_FX.reverb } },
    };
    if (choice.key) console.log(`[LIVIL][MAGICTUNE] ${lane.name} key ${keyName(choice.key)}`);
    update(p => ({ ...p, voices: [...p.voices, lane] }));
    setPending(null);
    setPhase('editor');
  }, [project.voices.length, update]);

  /** Next: mix the song (once per version of the project) and show it as it will be posted. */
  const goFinal = useCallback(async () => {
    engine.stop();
    setPlaying(false);
    const r = songRange(project);
    if (r.end - r.start < MIN_TRACK_SECONDS) {
      showToast(`A song needs to be at least ${MIN_TRACK_SECONDS} seconds. Trim less, or loop a part.`, { kind: 'info' });
      return;
    }
    setPhase('final');
    if (mix?.of === project) return;
    setMix(null);
    setMixProgress(0);
    // Let React paint "Your song" with its spinner before the mix starts: the render's set-up is
    // synchronous, and started in the same tick it left the Editor on screen, frozen and
    // apparently still tappable, with no sign that Next had done anything.
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const t0 = Date.now();
      const m = await renderMix(project, setMixProgress);
      console.log(`[LIVIL][POST] ${m.seconds.toFixed(1)} s mixed in ${Date.now() - t0} ms`);
      setMix({ of: project, mix: m });
    } catch (e) {
      console.log('[LIVIL][POST] mix failed', e);
      showToast("Couldn't mix the song.", { kind: 'error' });
      setPhase('editor');
    }
  }, [engine, project, mix, showToast]);

  /**
   * Create post: keep the work as a draft first (a failed or cancelled post never loses it),
   * write the mix as lossless FLAC next to the draft, and hand it to Upload — which REPLACES
   * the Editor, so the Editor's audio engine is closed before Upload plays anything (one audio
   * owner at a time, ADR-0034).
   */
  const createPost = useCallback(async () => {
    console.log(`[LIVIL][POST] Create post tapped (busy=${!!posting}, mix=${!!mix}, draft=${draft?.id ?? 'none'}, saved=${savedProject === project})`);
    if (posting) { console.log('[LIVIL][POST] stopped: already posting'); return; }
    if (!mix) { console.log('[LIVIL][POST] stopped: no mix yet'); showToast('Your song is still getting ready. Try again in a moment.', { kind: 'info' }); return; }
    setPosting('Saving your draft…');
    try {
      const t0 = Date.now();
      // Already saved and unchanged: no need to write every take again.
      // Written out longhand ON PURPOSE. `cond ? { …, x: (await f()) ?? '' } : …` is miscompiled
      // by Hermes (RN 0.85.3): the whole object becomes the awaited value. Create post got the
      // user id string instead of the draft and stopped, silently, every time (2026-11-02).
      let saved: (DraftMeta & { userId: string }) | null;
      if (draft && savedProject === project) {
        const userId = await owner();
        saved = { ...draft, userId: userId ?? '' };
      } else {
        saved = await save({ quiet: true });
      }
      if (!saved || !saved.userId) {
        // Never silently: say why (save() already showed its own message when IT failed).
        console.log(`[LIVIL][POST] stopped: ${saved ? 'nobody signed in' : 'draft not saved'}`);
        if (saved) showToast('You seem to be signed out. Sign in again, then post — your draft is saved.', { kind: 'error' });
        return;
      }
      const t1 = Date.now();
      console.log('[LIVIL][POST] draft saved, encoding the song');
      setPosting('Getting your song ready… 0%');
      const bytes = await encodeFlac(mix.mix.channels, mix.mix.sampleRate, p => setPosting(`Getting your song ready… ${Math.round(p * 100)}%`));
      const t2 = Date.now();
      console.log(`[LIVIL][POST] song encoded (${(bytes.length / 1e6).toFixed(1)} MB), writing it`);
      // In line with any save still running (see writeDraftMix).
      const uri = await writeDraftMix(saved.userId, saved.id, bytes);
      console.log(`[LIVIL][POST] save ${t1 - t0} ms · FLAC ${t2 - t1} ms · write ${Date.now() - t2} ms · ${(bytes.length / 1e6).toFixed(1)} MB`);
      const named = !saved.title.startsWith('Draft · ');
      leaving.current = true;
      console.log('[LIVIL][POST] opening Upload');
      navigation.replace('Upload', {
        studio: {
          uri,
          name: `${named ? saved.title : 'Editor mix'}.flac`,
          size: bytes.length,
          durationSec: mix.mix.seconds,
          draftId: saved.id,
          title: named ? saved.title : null,
        },
      });
    } catch (e) {
      console.log('[LIVIL][POST] failed', e);
      showToast("Couldn't get the song ready. Your draft is saved.", { kind: 'error' });
    } finally {
      setPosting(null);
    }
  }, [posting, mix, save, showToast, navigation, draft, savedProject, project, owner]);

  if (phase === 'editor') seenEditor.current = true;

  if (!ready || opening) {
    return <StudioLoading title={opening ? 'Opening your draft' : 'Opening the Editor'} detail={opening ? loadStep.detail : 'Getting the studio ready…'} progress={opening ? loadStep.progress : null} />;
  }

  return (
    <View style={styles.root}>
      {phase === 'record' && (
        <RecordPanel
          engine={engine}
          takeNumber={project.voices.length + 1}
          overBacking={project.voices.length > 0 || project.pattern.kick.some(Boolean) || project.pattern.snare.some(Boolean)}
          onDone={t => { setPlaying(false); setPending(t); setPhase('tune'); }}
          onClose={() => {
            setPlaying(false);
            if (project.voices.length || seenEditor.current) setPhase('editor');
            else { leaving.current = true; navigation.goBack(); }
          }}
          onSkip={project.voices.length === 0 ? () => { setPlaying(false); setPhase('editor'); } : undefined}
          onError={msg => showToast(msg, { kind: 'error' })}
          bpm={project.bpm}
          onBpm={bpm => update(p => ({ ...p, bpm }))}
          metronome={metronome}
          onMetronome={setMetronome}
          autoTempo={autoTempo}
          onAutoTempo={setAutoTempo}
        />
      )}
      {phase === 'tune' && pending && (
        <TunePanel
          engine={engine}
          take={pending}
          title={`Take ${project.voices.length + 1}`}
          onBack={() => { setPending(null); setPhase('record'); }}
          onNext={({ base, tuned, tuneOn, choice }) => addTake(pending, base, tuned, tuneOn, choice)}
        />
      )}
      {phase === 'tune' && editing && (
        <TunePanel
          engine={engine}
          take={{ samples: editing.take.original, sampleRate: editing.take.sampleRate }}
          title={editing.name}
          editing={{ choice: editing.take.tune, cleaned: cleanIsCurrent(editing.take) ? editing.take.raw : null }}
          onBack={() => { setEditing(null); setPhase('editor'); }}
          onNext={({ base, tuned, tuneOn, choice }) => {
            // A new take id: the engine caches audio per take id, and the audio itself changed.
            const take = { ...editing.take, id: newId(), raw: base, tuned, tune: choice };
            update(p => ({ ...p, voices: p.voices.map(v => (v.id === editing.id ? { ...v, take, level: autoLevel(base, take.sampleRate), tuneOn: tuneOn && !!tuned } : v)) }), true);
            setEditing(null);
            setPhase('editor');
          }}
        />
      )}
      {phase === 'editor' && (
        <EditorPanel
          project={project}
          playing={playing}
          playhead={playhead}
          level={level}
          onTogglePlay={togglePlay}
          onSeek={sec => { engine.seek(sec); setPlayhead(sec); }}
          onLane={(lane, restart) => update(p => ({ ...p, voices: p.voices.map(v => (v.id === lane.id ? lane : v)) }), restart)}
          onRemoveLane={lane => update(p => ({ ...p, voices: p.voices.filter(v => v.id !== lane.id) }), true)}
          onOpenFx={lane => setFxLaneId(lane.id)}
          onToggleClean={lane => void toggleClean(lane)}
          cleaning={cleaning}
          onOpenTune={lane => { engine.stop(); setPlaying(false); setEditing(lane); setPhase('tune'); }}
          onBpm={bpm => update(p => ({ ...p, bpm }), true)}
          onRange={(range, length) => update(p => ({ ...p, range, length }), true)}
          onDrumVolume={v => update(p => ({ ...p, drumVolume: v }))}
          onMasterVolume={v => update(p => ({ ...p, masterVolume: v }))}
          onOpenBeats={() => setBeatsOpen(true)}
          onAddVoice={() => { engine.stop(); setPlaying(false); setPhase('record'); }}
          onAddInstrument={() => {
            const part: SynthPart = { id: newId(), sound: 'keys', key: voiceKey ?? { tonic: 0, mode: 'major' }, volume: 0.8, chords: null, notes: [] };
            update(p => ({ ...p, synths: [...p.synths, part] }));
            setSynthId(part.id);
          }}
          onOpenSynth={s => setSynthId(s.id)}
          onSynth={s => update(p => ({ ...p, synths: p.synths.map(x => (x.id === s.id ? s : x)) }))}
          onRemoveSynth={s => update(p => ({ ...p, synths: p.synths.filter(x => x.id !== s.id) }))}
          onClose={() => (hasWork ? setConfirmExit(true) : leave())}
          draftTitle={draft ? displayTitle(draft.title) : null}
          unsaved={unsaved}
          saving={saving}
          onSave={() => void exclusive('Saving your draft…', async () => { await save(); })}
          onNext={() => void goFinal()}
        />
      )}


      {phase === 'final' && (
        <FinalPanel
          engine={engine}
          project={project}
          mix={mix?.of === project ? mix.mix : null}
          mixProgress={mixProgress}
          busy={posting ?? actionBusy}
          onBack={() => setPhase('editor')}
          onSaveDraft={() => void exclusive('Saving your draft…', async () => { if (await save()) leave(); })}
          onCreatePost={() => void exclusive('Getting your song ready…', createPost)}
        />
      )}

      <BeatsSheet
        visible={beatsOpen}
        onClose={() => setBeatsOpen(false)}
        engine={engine}
        playing={playing}
        onTogglePlay={togglePlay}
        playhead={playhead}
        pattern={project.pattern}
        bpm={project.bpm}
        drumVolume={project.drumVolume}
        onPattern={pattern => update(p => ({ ...p, pattern }))}
        onPreset={pattern => update(p => ({ ...p, pattern }))}
        onVolume={v => update(p => ({ ...p, drumVolume: v }))}
      />

      <SynthSheet
        visible={!!synthPart}
        onClose={() => {
          // A part left with nothing in it isn't kept.
          if (synthPart && !synthPart.chords && synthPart.notes.length === 0) {
            update(p => ({ ...p, synths: p.synths.filter(x => x.id !== synthPart.id) }));
          }
          setSynthId(null);
        }}
        engine={engine}
        playing={playing}
        onTogglePlay={togglePlay}
        playhead={playhead}
        bpm={project.bpm}
        part={synthPart}
        voiceKey={voiceKey}
        onPart={s => update(p => ({ ...p, synths: p.synths.map(x => (x.id === s.id ? s : x)) }))}
      />

      <EffectsSheet
        visible={!!fxLane}
        onClose={() => setFxLaneId(null)}
        name={fxLane?.name ?? ''}
        fx={fxLane?.fx ?? null}
        playing={playing}
        onTogglePlay={togglePlay}
        onFx={(fx, restart) => fxLane && update(p => ({ ...p, voices: p.voices.map(v => (v.id === fxLane.id ? { ...v, fx } : v)) }), restart)}
      />

      <ConfirmActionModal
        visible={confirmExit}
        title="Save this as a draft?"
        message="Drafts stay on this phone. Only you can see them."
        tone="primary"
        icon="mic"
        confirmLabel="Save draft"
        altLabel="Discard"
        onAlt={leave}
        cancelLabel="Keep editing"
        busy={saving}
        onConfirm={() => void exclusive('Saving your draft…', async () => { if (await save()) leave(); })}
        onCancel={() => setConfirmExit(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

});
