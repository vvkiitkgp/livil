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
import { useJamRealtime } from './JamRealtimeContext';
import { usePlayback, type NowPlayingInfo } from './PlaybackContext';
import { useToast } from './ToastContext';
import { feedPostToNowPlaying } from '../services/posts';
import {
  dismissJamSuggestion,
  listJamSuggestions,
  setJamSuggestionStatus,
  suggestToJam,
  type JamSuggestionGroup,
  type JamSuggestionRow,
} from '../services/jamSuggestions';

type JamSuggestionsValue = {
  groups: JamSuggestionGroup[];
  /** Suggestions by OTHER people newer than this phone last opened the Suggests tab. */
  unreadCount: number;
  /** The Suggests tab is on screen: everything so far counts as seen. */
  markSeen: () => void;
  suggest: (postId: string) => Promise<void>;
  /** Host only. */
  playNow: (group: JamSuggestionGroup) => void;
  addToQueue: (group: JamSuggestionGroup) => void;
  dismiss: (group: JamSuggestionGroup) => void;
};

const JamSuggestionsContext = createContext<JamSuggestionsValue | null>(null);

/**
 * The running jam's Suggests list (ADR-0022/0023).
 *
 * Mounted app-wide (inside JamRealtimeProvider) for as long as you are in a jam, not
 * just while the jam screen is open, so the badge keeps counting while you browse.
 *
 * As a LISTENER it also registers the playback guard's tap handler: a tap on any song
 * anywhere becomes a suggestion here ("Suggested to current Jam") instead of playing.
 */
export function JamSuggestionsProvider({ children }: { children: React.ReactNode }) {
  const { activeJam } = useJam();
  const { isHost } = useJamRealtime();
  const {
    registerListenerTapHandler,
    setNowPlaying,
    markSeekTarget,
    requestPlay,
    addToQueue: addToPlaybackQueue,
    nowPlaying,
  } = usePlayback();
  const { showToast } = useToast();

  const [groups, setGroups] = useState<JamSuggestionGroup[]>([]);
  const [rows, setRows] = useState<JamSuggestionRow[]>([]);
  const [seenAt, setSeenAt] = useState<string>(() => new Date().toISOString());
  const [meId, setMeId] = useState<string>('');
  const jamRoomId = activeJam?.jamRoomId ?? null;

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMeId(data?.user?.id ?? ''));
  }, []);

  // Load + live updates for the active jam. Any change reloads (debounced): the list is
  // small, and a reload also re-reads posts, so a song taken down mid-jam drops out.
  useEffect(() => {
    setGroups([]);
    setRows([]);
    setSeenAt(new Date().toISOString());
    if (!jamRoomId) { return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reload = () => {
      listJamSuggestions(jamRoomId)
        .then(r => { if (!cancelled) { setGroups(r.groups); setRows(r.rows); } })
        .catch(e => console.warn('[JamSuggestions] load failed', e));
    };
    const scheduleReload = () => {
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(reload, 250);
    };
    reload();
    const channel = supabase
      .channel(`jam:suggestions:${jamRoomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jam_suggestions', filter: `jam_room_id=eq.${jamRoomId}` },
        scheduleReload,
      )
      .subscribe();
    return () => {
      cancelled = true;
      if (timer) { clearTimeout(timer); }
      void supabase.removeChannel(channel);
    };
  }, [jamRoomId]);

  const unreadCount = useMemo(
    () => rows.filter(r => r.suggestedBy !== meId && r.createdAt > seenAt).length,
    [rows, meId, seenAt],
  );

  const markSeen = useCallback(() => {
    setSeenAt(new Date().toISOString());
  }, []);

  const suggest = useCallback(async (postId: string) => {
    if (!jamRoomId) { return; }
    try {
      const result = await suggestToJam(jamRoomId, postId);
      if (result === 'suggested') { showToast('Suggested to current Jam', { kind: 'success' }); }
      else if (result === 'already') { showToast('You already suggested this song', { kind: 'info' }); }
      else { showToast('This jam has too many suggestions waiting', { kind: 'info' }); }
    } catch {
      showToast("Couldn't suggest that song", { kind: 'error' });
    }
  }, [jamRoomId, showToast]);

  // Listener: every "play this" in the app becomes a suggestion.
  useEffect(() => {
    if (!jamRoomId || isHost) {
      registerListenerTapHandler(null);
      return;
    }
    registerListenerTapHandler((info: NowPlayingInfo) => { void suggest(info.postId); });
    return () => registerListenerTapHandler(null);
  }, [jamRoomId, isHost, suggest, registerListenerTapHandler]);

  const markStatus = useCallback((postId: string, status: 'queued' | 'played') => {
    if (!jamRoomId) { return; }
    setJamSuggestionStatus(jamRoomId, postId, status)
      .catch(e => console.warn('[JamSuggestions] status update failed', e));
  }, [jamRoomId]);

  const playNow = useCallback((group: JamSuggestionGroup) => {
    const info = feedPostToNowPlaying(group.post);
    setNowPlaying(info);
    markSeekTarget(info.clipStartSec ?? 0);
    requestPlay(info.postId);
    markStatus(group.postId, 'played');
  }, [setNowPlaying, markSeekTarget, requestPlay, markStatus]);

  const addToQueue = useCallback((group: JamSuggestionGroup) => {
    addToPlaybackQueue(feedPostToNowPlaying(group.post));
    markStatus(group.postId, 'queued');
    showToast(`Added “${group.post.track.title}” to the queue`, { kind: 'success' });
  }, [addToPlaybackQueue, markStatus, showToast]);

  const dismiss = useCallback((group: JamSuggestionGroup) => {
    if (!jamRoomId) { return; }
    dismissJamSuggestion(jamRoomId, group.postId)
      .catch(() => showToast("Couldn't remove that suggestion", { kind: 'error' }));
  }, [jamRoomId, showToast]);

  // Host: a queued suggestion that comes up in the queue becomes "played" for everyone.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    if (!isHost || !nowPlaying?.postId) { return; }
    const g = groupsRef.current.find(x => x.postId === nowPlaying.postId);
    if (g && g.status !== 'played') { markStatus(g.postId, 'played'); }
  }, [isHost, nowPlaying?.postId, markStatus]);

  const value = useMemo<JamSuggestionsValue>(
    () => ({ groups, unreadCount, markSeen, suggest, playNow, addToQueue, dismiss }),
    [groups, unreadCount, markSeen, suggest, playNow, addToQueue, dismiss],
  );

  return (
    <JamSuggestionsContext.Provider value={value}>{children}</JamSuggestionsContext.Provider>
  );
}

export function useJamSuggestions(): JamSuggestionsValue {
  const ctx = useContext(JamSuggestionsContext);
  if (!ctx) { throw new Error('useJamSuggestions must be used inside <JamSuggestionsProvider>'); }
  return ctx;
}
