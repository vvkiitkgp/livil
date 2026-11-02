import {
  activityOpenPoint,
  openOffsetFor,
  readBoundaryAt,
  type ReadableActivity,
} from '../activitySeen';

// Newest first, as activity_list returns them: 3 new likes on top of 3 already read.
const at = (min: number) => `2026-11-02T10:${String(min).padStart(2, '0')}:00.000Z`;
const item = (min: number, isRead: boolean): ReadableActivity => ({ isRead, updatedAt: at(min) });
const THREE_NEW = [item(50, false), item(40, false), item(30, false), item(20, true), item(10, true), item(5, true)];

describe('readBoundaryAt', () => {
  it('is the newest notification already read', () => {
    expect(readBoundaryAt(THREE_NEW)).toBe(at(20));
  });

  it('is null when nothing was read yet', () => {
    expect(readBoundaryAt([item(50, false), item(40, false)])).toBeNull();
    expect(readBoundaryAt([])).toBeNull();
  });
});

describe('activityOpenPoint', () => {
  it('3 new: "Seen" under the 4th from the end, open at the oldest new one', () => {
    expect(activityOpenPoint(THREE_NEW, at(20))).toEqual({ seenIndex: 3, firstUnseenIndex: 2 });
  });

  it('everything seen (leave and come back): "Seen" under the newest, open at rest', () => {
    const allRead = THREE_NEW.map(i => ({ ...i, isRead: true }));
    expect(activityOpenPoint(allRead, readBoundaryAt(allRead))).toEqual({ seenIndex: 0, firstUnseenIndex: null });
  });

  it('nothing read before: no label, open at the oldest', () => {
    const fresh = THREE_NEW.map(i => ({ ...i, isRead: false }));
    expect(activityOpenPoint(fresh, readBoundaryAt(fresh))).toEqual({ seenIndex: null, firstUnseenIndex: 5 });
  });

  it('keeps the boundary from the open: a refresh that returns everything read moves nothing', () => {
    const refreshed = THREE_NEW.map(i => ({ ...i, isRead: true }));
    expect(activityOpenPoint(refreshed, at(20))).toEqual({ seenIndex: 3, firstUnseenIndex: 2 });
  });

  it('a read notification bumped by a newer like counts as new again', () => {
    // The 10:20 like got another like at 10:55: it moved to the top, unread.
    const bumped = [item(55, false), item(50, false), item(40, false), item(30, false), item(10, true), item(5, true)];
    expect(activityOpenPoint(bumped, at(20))).toEqual({ seenIndex: 4, firstUnseenIndex: 3 });
  });

  it('an empty bot has nowhere to open', () => {
    expect(activityOpenPoint([], null)).toEqual({ seenIndex: null, firstUnseenIndex: null });
  });
});

describe('openOffsetFor', () => {
  // Rows newest first; 200 under the newest at rest; an 800-high screen.
  const H = [80, 120, 100, 90, 300, 300];

  it('0 when the first new row already fits with the newest at rest', () => {
    // far edge of row 2 = 200 + 80 + 120 + 100 = 500; + 56 margin < 800.
    expect(openOffsetFor(H, 2, 200, 800)).toBe(0);
  });

  it('scrolls so the first new row sits at the top with the margin above it', () => {
    // far edge of row 4 = 200 + 80 + 120 + 100 + 90 + 300 = 890; + 56 − 800 = 146.
    expect(openOffsetFor(H, 4, 200, 800)).toBe(146);
  });

  it('never past the end of the content', () => {
    // far edge of row 5 = 1190; + 56 − 800 = 446, but the content ends at 1198 → 398.
    expect(openOffsetFor(H, 5, 200, 800, 56, 1198)).toBe(398);
  });

  it('waits (null) while a row up to the target is unmeasured', () => {
    expect(openOffsetFor([80, undefined, 100], 2, 200, 800)).toBeNull();
    expect(openOffsetFor(H, 2, 200, 0)).toBeNull();
  });
});
