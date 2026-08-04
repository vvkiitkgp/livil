import { useEffect, useState } from 'react';
import { supabase } from './supabase';

type Probe =
  | { state: 'checking' }
  | { state: 'ok'; signedIn: boolean }
  | { state: 'error'; message: string };

/**
 * Phase 0 shell.
 *
 * Deliberately not the sign-in screen — that is Phase 1. What this proves is the seam:
 * shared design tokens reach the browser, the injected Supabase client is installed, and
 * the project answers. Auth, upload and the dashboard build on top of exactly this.
 */
export function App() {
  const [probe, setProbe] = useState<Probe>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;

    // getSession() needs no table and no RLS grant, so it verifies the client is wired
    // without depending on any schema being readable.
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setProbe({ state: 'error', message: error.message });
          return;
        }
        setProbe({ state: 'ok', signedIn: data.session !== null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProbe({
          state: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1 className="wordmark">Livil for Creators</h1>
      <p className="tagline">Upload your music from the machine you made it on.</p>

      <span
        className="status"
        data-state={probe.state === 'checking' ? 'idle' : probe.state}
      >
        <span className="dot" />
        {probe.state === 'checking' && 'Connecting…'}
        {probe.state === 'ok' &&
          (probe.signedIn ? 'Connected — session found' : 'Connected — signed out')}
        {probe.state === 'error' && `Connection failed — ${probe.message}`}
      </span>
    </main>
  );
}
