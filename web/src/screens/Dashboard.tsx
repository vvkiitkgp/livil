import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Button } from '../components/Button';
import { signOut } from '../auth/session';
import { supabase } from '../supabase';

/**
 * Signed-in shell. The uploader lands here in Phase 2 (ADR-0015).
 *
 * Scoped to publishing on purpose — no feed, no chat, no jam rooms. The decision record
 * calls that out as the line that keeps this from becoming a second Livil.
 */
export function Dashboard({ session }: { session: Session }) {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setHandle(data.display_name || data.username);
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__mark">Livil for Creators</span>
        <div className="topbar__right">
          <span className="hint">{handle ?? session.user.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="app__body">
        <section className="card card--center">
          <h2 className="card__title">Uploads land here next</h2>
          <p className="hint">
            Resumable uploads up to 2&nbsp;GB, whole-folder batches, artwork and metadata.
            You're signed in and the dashboard is wired — Phase 2 fills this panel.
          </p>
        </section>
      </main>
    </div>
  );
}
