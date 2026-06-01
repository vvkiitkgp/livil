import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../../lib/supabase';
import { useJam } from './JamContext';
import { usePlayback, type NowPlayingInfo } from './PlaybackContext';
import {
  joinJamRoom,
  type JamRoomState,
} from '../services/jamRooms';
import {
  subscribeToJam,
  unsubscribeFromJam,
  broadcastPlaybackState,
  type PlaybackBroadcast,
  type PresenceMember,
} from '../services/jamRealtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Snapshot of the host's playback that listeners render in their UI.
 * Position is lag-adjusted at receive time so it's directly displayable.
 */
export type RemotePlayback = {
  isPlaying: boolean;
  positionMs: number;
  trackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackCoverArt: string | null;
  mediaKind: 'audio' | 'video' | null;
};

type JamRealtimeContextValue = {
  isHost: boolean;
  hostId: string | null;
  hostUsername: string | null;
  presenceMembers: PresenceMember[];
  remotePlayback: RemotePlayback | null;
  jamState: JamRoomState | null;
  synced: boolean;
};

const JamRealtimeContext = createContext<JamRealtimeContextValue | null>(null);

/**
 * Global jam realtime provider.
 *
 * Whenever `activeJam` is set in JamContext, this provider:
 *   - Calls joinJamRoom to mark server-side membership and learn the host id.
 *   - Subscribes to the jam channel (presence + PLAYBACK_STATE broadcast).
 *   - If the user IS the host: watches `nowPlaying` / `activePostId` and
 *     broadcasts every time they change, plus a 2s heartbeat for drift sync.
 *     Falls back to a `tracks` table lookup for audio_url when nowPlaying lacks
 *     it (PostCard-driven playback intentionally omits the URL).
 *   - If the user is a listener: when broadcasts arrive it loads the host's
 *     track into the listener's GlobalAudioPlayer via setNowPlaying, then
 *     applies drift-aware seek (>1s) and play/pause mirroring.
 *
 * Living at the root means the host can navigate freely (home → search →
 * playlist → profile) and every track change still propagates to listeners.
 * Listeners likewise keep hearing the host on any screen.
 */
export function JamRealtimeProvider({ children }: { children: React.ReactNode }) {
  const { activeJam, clearActiveJam } = useJam();
  const {
    nowPlaying,
    activePostId,
    positionRef,
    handlersRef,
    setNowPlaying,
    clearNowPlaying,
    requestPlay,
    pauseAll,
    setJamLocked,
  } = usePlayback();

  const [isHost, setIsHost] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [hostUsername, setHostUsername] = useState<string | null>(null);
  const [jamState, setJamState] = useState<JamRoomState | null>(null);
  const [presenceMembers, setPresenceMembers] = useState<PresenceMember[]>([]);
  const [remotePlayback, setRemotePlayback] = useState<RemotePlayback | null>(null);
  const [synced, setSynced] = useState(false);

  // Host side: URLs to broadcast — taken from nowPlaying if present, else
  // looked up from the tracks table by trackId.
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | null>(null);
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState<string | null>(null);

  // Refs so the broadcast handler (set up once per activeJam) can read latest
  // values without re-subscribing on every render.
  const isHostRef = useRef(false);
  const nowPlayingRef = useRef<NowPlayingInfo | null>(nowPlaying);
  const activePostIdRef = useRef<string | null>(activePostId);
  const resolvedAudioUrlRef = useRef<string | null>(null);
  const resolvedVideoUrlRef = useRef<string | null>(null);
  // True once we (as a listener) have loaded the host's track — used to clear
  // playback on leave so we don't keep streaming the host's audio.
  const loadedFromJamRef = useRef(false);

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { nowPlayingRef.current = nowPlaying; }, [nowPlaying]);
  useEffect(() => { activePostIdRef.current = activePostId; }, [activePostId]);
  useEffect(() => { resolvedAudioUrlRef.current = resolvedAudioUrl; }, [resolvedAudioUrl]);
  useEffect(() => { resolvedVideoUrlRef.current = resolvedVideoUrl; }, [resolvedVideoUrl]);

  // ── Broadcast (host-only) ───────────────────────────────────────────────
  const broadcast = useCallback(() => {
    if (!activeJam || !isHostRef.current) { return; }
    const np = nowPlayingRef.current;
    void broadcastPlaybackState(activeJam.jamRoomId, {
      is_playing: !!activePostIdRef.current,
      position_ms: positionRef.current * 1000,
      track_id: np?.trackId ?? '',
      track_title: np?.title,
      track_artist: np?.artistName,
      track_cover_art: np?.coverArtUrl,
      audio_url: np?.audioUrl ?? resolvedAudioUrlRef.current ?? undefined,
      video_url: np?.videoUrl ?? resolvedVideoUrlRef.current ?? undefined,
      media_kind: np?.mediaKind,
      post_id: np?.postId,
      author_id: np?.authorId,
      author_username: np?.authorUsername,
      author_avatar_url: np?.authorAvatarUrl,
    });
  }, [activeJam, positionRef]);

  const broadcastRef = useRef(broadcast);
  useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);

  // ── Subscribe lifecycle: tied to activeJam.jamRoomId ────────────────────
  useEffect(() => {
    if (!activeJam) {
      // No jam — reset everything.
      setIsHost(false);
      setHostId(null);
      setHostUsername(null);
      setJamState(null);
      setPresenceMembers([]);
      setRemotePlayback(null);
      setSynced(false);
      setResolvedAudioUrl(null);
      setResolvedVideoUrl(null);
      setJamLocked(false);
      if (loadedFromJamRef.current) {
        pauseAll();
        clearNowPlaying();
        loadedFromJamRef.current = false;
      }
      return;
    }

    let cancelled = false;
    const jamRoomId = activeJam.jamRoomId;

    (async () => {
      // Resolve identity + host info.
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? '';

      let state: JamRoomState;
      try {
        state = await joinJamRoom(jamRoomId);
      } catch {
        // If we can't join (e.g. jam ended), clear the activeJam so banners /
        // listeners stop showing it.
        if (!cancelled) { clearActiveJam(); }
        return;
      }

      if (cancelled) { return; }

      const host = state.hostId === uid;
      setIsHost(host);
      setHostId(state.hostId);
      setHostUsername(state.hostUsername);
      setJamState(state);

      // Listeners can't drive playback themselves while in a jam.
      if (!host) { setJamLocked(true); }

      // Profile lookup for presence row.
      const { data: prof } = await db
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', uid)
        .maybeSingle();
      const username = (prof as { username?: string } | null)?.username ?? 'User';
      const avatarUrl = (prof as { avatar_url?: string | null } | null)?.avatar_url ?? null;

      if (cancelled) { return; }

      subscribeToJam(jamRoomId, uid, username, avatarUrl, {
        onPlaybackState: (bc: PlaybackBroadcast) => {
          if (cancelled) { return; }
          const adjustedMs = bc.position_ms + (Date.now() - bc.host_ts);

          setRemotePlayback({
            isPlaying: bc.is_playing,
            positionMs: adjustedMs,
            trackId: bc.track_id || null,
            trackTitle: bc.track_title ?? null,
            trackArtist: bc.track_artist ?? null,
            trackCoverArt: bc.track_cover_art ?? null,
            mediaKind: bc.media_kind ?? null,
          });

          if (!isHostRef.current) {
            const currentNp = nowPlayingRef.current;

            // Track changed (or first load) — load it into the listener's
            // GlobalAudioPlayer. setNowPlaying with audioUrl set causes
            // GlobalAudioPlayer to mount, stream, and autoplay.
            if (
              bc.audio_url &&
              bc.track_id &&
              (!currentNp || currentNp.trackId !== bc.track_id)
            ) {
              setNowPlaying({
                postId: bc.post_id ?? '',
                trackId: bc.track_id,
                title: bc.track_title ?? 'Unknown',
                artistName: bc.track_artist ?? '',
                authorId: bc.author_id ?? '',
                authorUsername: bc.author_username ?? '',
                authorAvatarUrl: bc.author_avatar_url ?? null,
                coverArtUrl: bc.track_cover_art ?? null,
                mediaKind: bc.media_kind ?? 'audio',
                audioUrl: bc.audio_url,
                videoUrl: bc.video_url,
                likesCount: 0, commentsCount: 0, repostsCount: 0, viewsCount: 0,
                viewerHasLiked: false, clipStartSec: null, clipEndSec: null,
                kind: 'upload', originalPostId: null,
              });
              if (bc.post_id) { requestPlay(bc.post_id); }
              loadedFromJamRef.current = true;
              setSynced(true);
              return;
            }

            // Host stopped playing entirely — pause listener and clear.
            if (!bc.track_id) {
              if (loadedFromJamRef.current) {
                pauseAll();
                clearNowPlaying();
                loadedFromJamRef.current = false;
              }
              setSynced(true);
              return;
            }

            // Same track — drift correct, play/pause mirror.
            const localMs = positionRef.current * 1000;
            if (handlersRef.current && Math.abs(localMs - adjustedMs) > 1000) {
              handlersRef.current.seek(adjustedMs / 1000);
            }
            // Mirror play/pause every tick. We don't guard on activePostId
            // because PostCard's pause() doesn't call reportPaused, so the
            // activePostId state would stay set after a remote pause — making
            // the next remote-play silently skip the play() call. The handler
            // setPaused calls are idempotent, so calling them every 2s is fine.
            if (bc.is_playing) {
              handlersRef.current?.play();
            } else {
              handlersRef.current?.pause();
            }
          }

          setSynced(true);
        },
        onPresenceChange: (members: PresenceMember[]) => {
          if (cancelled) { return; }
          setPresenceMembers(members);
          // Host re-broadcasts on presence sync so latecomers immediately get
          // current state without waiting for the next heartbeat.
          if (isHostRef.current) {
            broadcastRef.current();
          }
        },
      });
    })();

    return () => {
      cancelled = true;
      unsubscribeFromJam(jamRoomId);
    };
  // We deliberately key off jamRoomId only — re-running on every callback
  // change would tear down and re-subscribe the channel constantly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJam?.jamRoomId]);

  // ── Host: resolve audio/video URLs when nowPlaying lacks them ───────────
  useEffect(() => {
    if (!isHost) { return; }
    const trackId = nowPlaying?.trackId;
    if (!trackId) {
      setResolvedAudioUrl(null);
      setResolvedVideoUrl(null);
      return;
    }
    if (nowPlaying?.audioUrl || nowPlaying?.videoUrl) {
      setResolvedAudioUrl(nowPlaying.audioUrl ?? null);
      setResolvedVideoUrl(nowPlaying.videoUrl ?? null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await db
        .from('tracks')
        .select('audio_url, video_url')
        .eq('id', trackId)
        .maybeSingle();
      if (cancelled || !data) { return; }
      const row = data as { audio_url: string | null; video_url: string | null };
      setResolvedAudioUrl(row.audio_url);
      setResolvedVideoUrl(row.video_url);
    })();
    return () => { cancelled = true; };
  }, [isHost, nowPlaying?.trackId, nowPlaying?.audioUrl, nowPlaying?.videoUrl]);

  // ── Host: broadcast immediately on meaningful changes ───────────────────
  // Fires whenever the host plays/pauses (activePostId), changes track, or
  // a URL just got resolved. Listeners get the change in <200ms.
  useEffect(() => {
    if (!isHost) { return; }
    broadcastRef.current();
  }, [
    isHost,
    activePostId,
    nowPlaying?.trackId,
    resolvedAudioUrl,
    resolvedVideoUrl,
  ]);

  // ── Host: heartbeat every 2s for drift + late-joiner sync ───────────────
  useEffect(() => {
    if (!isHost || !activeJam) { return; }
    const id = setInterval(() => {
      broadcastRef.current();
    }, 2000);
    return () => clearInterval(id);
  }, [isHost, activeJam]);

  const value = useMemo<JamRealtimeContextValue>(
    () => ({
      isHost,
      hostId,
      hostUsername,
      presenceMembers,
      remotePlayback,
      jamState,
      synced,
    }),
    [isHost, hostId, hostUsername, presenceMembers, remotePlayback, jamState, synced],
  );

  return (
    <JamRealtimeContext.Provider value={value}>{children}</JamRealtimeContext.Provider>
  );
}

export function useJamRealtime(): JamRealtimeContextValue {
  const ctx = useContext(JamRealtimeContext);
  if (!ctx) { throw new Error('useJamRealtime must be used inside <JamRealtimeProvider>'); }
  return ctx;
}
