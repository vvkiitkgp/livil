import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useJam } from '../contexts/JamContext';

/**
 * iOS only: closes the realtime socket while the app is backgrounded (a background listen
 * otherwise keeps a heartbeat going) and reopens it on return. Never on Android: there
 * 'background' fires on every pause, and `disconnect()` destroys every channel's listeners.
 * See kb/architecture/realtime.md, "The socket while the app is backgrounded".
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
    if (Platform.OS !== 'ios') { return; }

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
