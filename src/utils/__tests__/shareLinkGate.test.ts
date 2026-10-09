import { createShareLinkGate } from '../shareLinkGate';

const POST = 'https://livil-music.com/p/8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e';
const PROFILE = 'https://livil-music.com/@riya';

describe('createShareLinkGate', () => {
  it('holds a link that arrives before the app is ready, and releases it once', () => {
    const gate = createShareLinkGate();
    expect(gate.offer(PROFILE)).toBe('held');
    expect(gate.setReady(true)).toBe(PROFILE);
    // Released exactly once — a re-render reporting "ready" again must not reopen it.
    expect(gate.setReady(true)).toBeNull();
  });

  it('opens straight away once the app is ready', () => {
    const gate = createShareLinkGate();
    gate.setReady(true);
    expect(gate.offer(PROFILE)).toBe('open');
    expect(gate.setReady(true)).toBeNull();
  });

  it('keeps holding through onboarding — signed in but not ready is still not ready', () => {
    // The bug this replaced: a link tapped on the username or guide screen was dropped.
    const gate = createShareLinkGate();
    gate.setReady(false); // signed in, ChooseUsername showing
    expect(gate.offer(PROFILE)).toBe('held');
    expect(gate.setReady(false)).toBeNull(); // guide showing
    expect(gate.setReady(true)).toBe(PROFILE); // Home
  });

  it('holds again after sign-out, and does not release while not ready', () => {
    const gate = createShareLinkGate();
    gate.setReady(true);
    gate.setReady(false);
    expect(gate.offer(POST)).toBe('held');
    expect(gate.setReady(false)).toBeNull();
    expect(gate.setReady(true)).toBe(POST);
  });

  it('opens the latest of several taps made before the app was ready', () => {
    const gate = createShareLinkGate();
    gate.offer(POST);
    gate.offer(PROFILE);
    expect(gate.setReady(true)).toBe(PROFILE);
  });
});
