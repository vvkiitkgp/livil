import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useRelationships } from './RelationshipContext';
import { listConversations } from '../services/conversations';
import { getActivityUnreadCount } from '../services/activity';
import {
  setAppBadgeCount,
  resyncAppBadgeCount,
  onBadgeRefreshRequested,
} from '../services/appBadge';
import { retryOnce } from '../utils/retryOnce';

/**
 * The live "needs you" total: unread messages + incoming friend requests + unread livil Bot
 * activity. Shown on the Messages tab and mirrored onto the app icon.
 *
 * Mounted inside AppNavigator, so it lives exactly as long as the signed-in session and the
 * next account starts from a fresh count. A number on its own context: only the tab icon reads
 * it, so a new message re-renders that icon and nothing else.
 */
const UnreadBadgeContext = createContext(0);

export function UnreadBadgeProvider({ children }: { children: React.ReactNode }) {
  const { pendingIncomingCount } = useRelationships();
  const [totalUnread, setTotalUnread] = useState(0);
  // Unread livil Bot activity (likes/comments/reposts/milestones/friend outcomes).
  // These live in `activity_notifications` (services/activity), NOT the messages
  // table — so they must be counted separately from `totalUnread`.
  const [activityUnread, setActivityUnread] = useState(0);
  const count = totalUnread + pendingIncomingCount + activityUnread;

  // Mirror the in-app badge onto the home-screen icon.
  //
  // iOS gets the exact number. Android cannot be told a number at all and instead
  // clears when this reaches zero; the rest of the time its launcher sums the
  // notifications in the tray. See src/services/appBadge.ts.
  useEffect(() => {
    void setAppBadgeCount(count);
  }, [count]);

  // Read by the re-count below without making it re-subscribe on every change.
  const pendingIncomingRef = useRef(pendingIncomingCount);
  pendingIncomingRef.current = pendingIncomingCount;

  // Only the newest re-count may write. Leaving a chat fires two at once (the read being saved,
  // and Messages regaining focus), and the one that read BEFORE the save must not land last and
  // put the old number back. Bumped on unmount too: a re-count still running at sign-out must
  // not write the old account's total onto the icon.
  const latestRecount = useRef(0);

  // Re-fetch the unread counts from the server, then re-write the iOS icon with
  // the result EVEN IF NOTHING CHANGED. The effect above only fires on a change,
  // but a push may have set the icon behind the app's back while it was
  // backgrounded — see resyncAppBadgeCount.
  //
  // The icon is only re-written when both reads succeed: a partial total could
  // clear a number that is still correct.
  const recount = useCallback(async () => {
    latestRecount.current += 1;
    const mine = latestRecount.current;
    const isStale = () => mine !== latestRecount.current;
    let messages: number | null = null;
    let activity: number | null = null;
    try {
      // Retried: the foreground path fires this the instant iOS resumes the
      // app, when the first request typically fails — and a failed read means
      // the icon is left as it is.
      const convs = await retryOnce(listConversations);
      messages = convs.reduce((sum, c) => sum + c.unreadCount, 0);
      if (!isStale()) { setTotalUnread(messages); }
    } catch {
      // ignore
    }
    // livil Bot activity is a separate table — refetch its unread count too.
    try {
      activity = await retryOnce(getActivityUnreadCount);
      if (!isStale()) { setActivityUnread(activity); }
    } catch {
      // ignore
    }
    if (isStale() || messages === null || activity === null) { return; }
    void resyncAppBadgeCount(messages + pendingIncomingRef.current + activity);
  }, []);

  // Count once at sign-in, then whenever something asks (Home and Messages on focus, a chat that
  // just marked its messages read — see requestBadgeRefresh) and when the app returns to the
  // foreground. Focus does not fire then, realtime was paused while backgrounded so the totals
  // may have missed messages, and a push may have changed the icon. Opening the app from a push
  // is exactly this path.
  //
  // The first count is here rather than left to Home's focus: a child's effects run before its
  // parent's, so Home's first request goes out before this has subscribed to it.
  useEffect(() => {
    void recount();
    const off = onBadgeRefreshRequested(() => { void recount(); });
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { void recount(); }
    });
    return () => {
      latestRecount.current += 1;
      off();
      sub.remove();
    };
  }, [recount]);

  // Live: increment unread when a new message arrives in any of my conversations.
  // RLS lets the realtime worker filter to messages I can SELECT (i.e. ones in
  // conversations I'm a member of), so we don't need a per-conversation filter here.
  // Decrement on read is handled by the re-count above.
  useEffect(() => {
    let myId: string | null = null;
    let mounted = true;

    void supabase.auth.getUser().then(({ data }) => {
      myId = data?.user?.id ?? null;
    });

    console.log('[realtime] subscribing to unread-badge');
    const channel = supabase
      .channel('unread-badge')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: { new: { sender_id?: string | null; kind?: string; deleted_at?: string | null } }) => {
          console.log('[realtime] unread-badge got messages INSERT');
          if (!mounted) { return; }
          const row = payload.new;
          if (!row) { return; }
          if (row.kind === 'system') { return; }
          if (row.deleted_at) { return; }
          if (myId && row.sender_id === myId) { return; }
          setTotalUnread(n => n + 1);
        },
      )
      .subscribe(status => {
        console.log(`[realtime] unread-badge status=${status}`);
      });

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  // Live: keep the livil Bot activity contribution to the badge current. Any
  // insert/update/delete on activity_notifications for me → refetch the count.
  // Refetch (not increment) because likes aggregate into an existing row (an
  // arriving like is an UPDATE, not always an INSERT), and mark-read is an
  // UPDATE too — a naive +1 would drift. `recipient_id` filter mirrors the
  // ActivityCenterScreen subscription; the channel is gated on the resolved id.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data }) => {
      const myId = data?.user?.id;
      if (!myId || cancelled) { return; }
      channel = supabase
        .channel(`unread-badge:activity:${myId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'activity_notifications',
            filter: `recipient_id=eq.${myId}`,
          },
          () => {
            void getActivityUnreadCount()
              .then(n => { if (!cancelled) { setActivityUnread(n); } })
              .catch(() => { /* ignore */ });
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) { void supabase.removeChannel(channel); }
    };
  }, []);

  return <UnreadBadgeContext.Provider value={count}>{children}</UnreadBadgeContext.Provider>;
}

export function useUnreadBadgeCount(): number {
  return useContext(UnreadBadgeContext);
}
