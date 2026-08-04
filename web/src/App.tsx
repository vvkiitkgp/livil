import { useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { useAuthState } from './auth/session';
import { Button } from './components/Button';
import { AppShell } from './components/AppShell';
import { SignIn } from './screens/SignIn';
import { ForgotPassword } from './screens/ForgotPassword';
import { ResetPassword } from './screens/ResetPassword';
import { FinishInApp } from './screens/FinishInApp';
import { Overview } from './screens/Overview';
import { Catalogue } from './screens/Catalogue';
import { Analytics } from './screens/Analytics';
import { TrackDetail } from './screens/TrackDetail';
import { Upload } from './screens/Upload';
import { Profile } from './screens/Profile';
import type { Session } from '@supabase/supabase-js';

/**
 * Routing.
 *
 * The auth gate sits OUTSIDE the router on purpose. The four signed-out states in
 * `auth/session.ts` are states of the shell, not pages — making `needs-onboarding`
 * bookmarkable would be wrong, and the deliberately-designed failure model there (a read
 * error is its own state, neither open nor closed) is not something a route can express.
 *
 * A router at all, rather than view state, because the about page on livil-music.com has to
 * link INTO the dashboard. Once one URL must be addressable from outside, hand-rolling
 * pushState is writing a router badly. Browser back also stops being optional in a desktop
 * tool the way it is on a phone.
 *
 * NOTE: `/upload` and the rest 404 on a hard load until a `vercel.json` SPA rewrite ships.
 * That is a deploy-time concern and is on the checklist.
 */
function routerFor(session: Session) {
  return createBrowserRouter([
    {
      path: '/',
      element: <AppShell session={session} />,
      children: [
        { index: true, element: <Overview /> },
        { path: 'tracks', element: <Catalogue /> },
        { path: 'tracks/:postId', element: <TrackDetail /> },
        { path: 'analytics', element: <Analytics /> },
        { path: 'upload', element: <Upload /> },
        { path: 'profile', element: <Profile /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ]);
}

export function App() {
  const state = useAuthState();
  const [forgot, setForgot] = useState(false);
  const [path, setPath] = useState(() => window.location.pathname);

  /**
   * `/reset` is handled BEFORE the auth gate, and that ordering is the whole point.
   *
   * Following a recovery link SIGNS YOU IN — Supabase exchanges the code and emits a
   * session. So the gate would see `signed-in` and drop the user into the dashboard with
   * their old password still set and no sign the reset never happened. Checking the path
   * first is what keeps them on the screen they came for.
   *
   * Read from `window.location` rather than the router because the router only exists once
   * signed in, and this has to work before that.
   */
  if (path === '/reset') {
    return (
      <ResetPassword
        onDone={() => {
          window.history.replaceState({}, '', '/');
          setPath('/');
          setForgot(false);
        }}
      />
    );
  }

  switch (state.status) {
    case 'loading':
      // No spinner: the session read is a synchronous localStorage hit in the common case,
      // and a flashed spinner reads worse than a beat of nothing.
      return <main className="auth bg-stage" aria-busy="true" />;
    case 'signed-out':
      return forgot ? (
        <ForgotPassword onBack={() => setForgot(false)} />
      ) : (
        <SignIn onForgotPassword={() => setForgot(true)} />
      );
    case 'needs-onboarding':
      return <FinishInApp />;
    case 'signed-in':
      return <RouterProvider router={routerFor(state.session)} />;
    case 'error':
      // The session is intact — we simply could not read the profile. Offering a retry is
      // why this is not folded into signed-out.
      return (
        <main className="auth bg-stage">
          <header className="auth__head">
            <p className="kicker">Backstage door</p>
            <h1 className="display auth__title">Can&apos;t reach Livil</h1>
            <p className="tagline">Your sign-in is fine — we couldn&apos;t load your profile.</p>
          </header>
          <section className="card">
            <Button type="button" size="lg" onClick={state.retry}>
              Try again
            </Button>
          </section>
        </main>
      );
  }
}
