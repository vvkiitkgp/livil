import {
  CLOSE_TARGET_SIZE,
  closeHintRemainingMs,
  closeTargetBottom,
  closeTargetTravel,
  isOverCloseTarget,
  shouldRevealCloseTarget,
} from '../playerCloseGesture';

describe('closeTargetTravel', () => {
  it('is the distance from the resting circle to the centre of the X', () => {
    // iPhone: player 140 up, radius 30, home-indicator inset 34.
    const travel = closeTargetTravel(140, 30, 34);
    expect(140 + 30 - travel).toBe(closeTargetBottom(34) + CLOSE_TARGET_SIZE / 2);
    expect(travel).toBe(82);
  });
});

describe('shouldRevealCloseTarget', () => {
  it('shows the X for a pull down', () => {
    expect(shouldRevealCloseTarget(0, 24)).toBe(true);
    expect(shouldRevealCloseTarget(10, 40)).toBe(true);
  });

  it('stays hidden for a small movement', () => {
    expect(shouldRevealCloseTarget(0, 23)).toBe(false);
  });

  it('stays hidden for a drag up, which opens full screen', () => {
    expect(shouldRevealCloseTarget(0, -120)).toBe(false);
  });

  it('stays hidden for a sideways flick that drifts down, which skips a song', () => {
    expect(shouldRevealCloseTarget(60, 30)).toBe(false);
    expect(shouldRevealCloseTarget(-30, 30)).toBe(false);
  });
});

describe('closeHintRemainingMs', () => {
  it('keeps the hint up for what is left of 1.5 seconds after a quick pull', () => {
    expect(closeHintRemainingMs(1000, 1000)).toBe(1500);
    expect(closeHintRemainingMs(1000, 1400)).toBe(1100);
  });

  it('adds no wait once the hint has been up long enough', () => {
    expect(closeHintRemainingMs(1000, 2500)).toBe(0);
    expect(closeHintRemainingMs(1000, 9000)).toBe(0);
  });
});

describe('isOverCloseTarget', () => {
  const travel = 82;

  it('snaps on within the entry distance', () => {
    expect(isOverCloseTarget(0, travel, travel, false)).toBe(true);
    expect(isOverCloseTarget(0, travel - 43, travel, false)).toBe(true);
  });

  it('does not snap on from further away', () => {
    expect(isOverCloseTarget(0, travel - 44, travel, false)).toBe(false);
    expect(isOverCloseTarget(50, travel, travel, false)).toBe(false);
  });

  // A finger never holds still for 3 seconds. Wobbling around the entry distance must not
  // keep dropping off the X, because each drop restarts the countdown.
  it('keeps holding through a wobble past the entry distance', () => {
    expect(isOverCloseTarget(0, travel - 50, travel, true)).toBe(true);
    expect(isOverCloseTarget(30, travel + 30, travel, true)).toBe(true);
  });

  it('lets go once the finger really leaves', () => {
    expect(isOverCloseTarget(0, travel - 64, travel, true)).toBe(false);
  });
});
