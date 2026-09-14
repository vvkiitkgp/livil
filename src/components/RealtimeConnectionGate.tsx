import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useJam } from '../contexts/JamContext';

/**
 * Closes the Supabase realtime websocket while the app is backgrounded, and
 * reopens it on return.
 *
 * WHY
 * Every realtime feature — chat, activity, friendships, jam — multiplexes over a
 * SINGLE socket, which sends a keepalive every ~25s for as long as it is open.
 * That poll costs nothing while the app is frozen (Android stops React Native's
 * timer clock at `onHostPause`, so the heartbeat interval simply does not fire),
 * but there is one case where the app is backgrounded and NOT frozen: playing
 * music. The playback service holds the process up for the whole listening
 * session, so a two-hour listen was ~290 heartbeat round-trips plus every
 * postgres_changes event, on a radio that would otherwise idle between audio
 * buffer fills.
 *
 * Backgrounded is also exactly when we do not need the socket: message and
 * activity delivery to a backgrounded app is push notifications' job (FCM →
 * `displayPushNotification`), not realtime's.
 *
 * WHY THERE IS NO GRACE PERIOD
 * The obvious refinement — wait ~30s before disconnecting, so app-switching does
 * not churn — cannot work. A `setTimeout` scheduled as the app backgrounds is
 * frozen by the same timer clock, so it would fire on RETURN rather than while
 * away. Disconnect is therefore immediate, and the reconnect is cheap: one
 * websocket handshake plus the channels' own rejoin.
 *
 * HOW THE REJOIN WORKS (do not "help" it by re-subscribing)
 * `disconnect()` closes the socket, which errors every channel and schedules its
 * rejoin timer. Those timers are frozen with everything else and fire on resume,
 * putting each channel into `joining`; our `connect()` then opens the socket and
 * `_onConnOpen` re-sends the join for anything in that state. Calling
 * `channel.subscribe()` again would NOT help — it only rejoins a channel in
 * `closed` state, and a socket drop leaves them `errored`.
 */
export default function RealtimeConnectionGate() {
  const { activeJam } = useJam();

  // A jam is a live listen-together session: dropping its socket would desync
  // every participant the moment the host checks another app. Read through a ref
  // so the AppState subscription is registered exactly once.
  const keepAliveRef = useRef(false);
  keepAliveRef.current = activeJam != null;

  // Whether WE closed the socket, so we never "reconnect" one we did not touch.
  const suspendedRef = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        if (!suspendedRef.current) { return; }
        suspendedRef.current = false;
        console.log('[realtime] foreground → reconnecting socket');
        supabase.realtime.connect();
        return;
      }

      // 'background' only — NOT 'inactive'. iOS reports inactive for transient
      // interruptions (app switcher, notification shade, an incoming call
      // banner), and tearing the socket down for those would churn constantly.
      if (state !== 'background') { return; }
      if (keepAliveRef.current) {
        console.log('[realtime] background but jam active → keeping socket open');
        return;
      }
      if (suspendedRef.current) { return; }
      suspendedRef.current = true;
      console.log('[realtime] background → closing socket');
      supabase.realtime.disconnect();
    });

    return () => {
      sub.remove();
      // Deliberately NOT reconnecting here. This unmounts on sign-out, where a
      // socket is exactly what we do not want; and `channel.subscribe()` calls
      // `socket.connect()` itself, so the next subscriber reopens it anyway.
      suspendedRef.current = false;
    };
  }, []);

  return null;
}
