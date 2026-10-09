/**
 * When an incoming share link (a post or a profile) may be OPENED.
 *
 * A shared post or profile is only ever shown to someone who is all the way into the app —
 * signed in, terms accepted, username chosen, first-run guide done — because that is the
 * only place the navigator that shows profiles is mounted. A link that arrives before then
 * (a signed-out tap, a tap during onboarding, a cold start still on the splash) is HELD and
 * handed back the moment the app becomes ready.
 *
 * ONE signal decides both directions, on purpose. An earlier version held a link when
 * there was no session but released it when the app was ready; between those two (signed
 * in, still onboarding) a link was neither held nor openable and vanished silently — and a
 * session that failed to refresh made a fully signed-in user's link wait for a sign-in that
 * was never coming. Readiness is the only question that matters, so it is the only input.
 *
 * Latest wins: two taps before the app is ready open the second. In memory only — a link
 * tapped before the app was killed is not worth persisting.
 */
export type ShareLinkGate = {
  /** A share link arrived. 'open' it now, or it has been 'held' until the app is ready. */
  offer(url: string): 'open' | 'held';
  /** The app's readiness changed. Returns a held link to open now, at most once. */
  setReady(ready: boolean): string | null;
};

export function createShareLinkGate(): ShareLinkGate {
  let ready = false;
  let held: string | null = null;
  return {
    offer(url) {
      if (ready) { return 'open'; }
      held = url;
      return 'held';
    },
    setReady(next) {
      ready = next;
      if (!ready || held === null) { return null; }
      const url = held;
      held = null;
      return url;
    },
  };
}
