import {
  MAX_FACES,
  baseLayout,
  bumpSender,
  clusterLayout,
  faceInitials,
  hashString,
  type GroupFace,
} from '../groupFaces';

const face = (userId: string, lastSentAt: string | null = null): GroupFace =>
  ({ userId, username: userId, displayName: null, avatarUrl: null, lastSentAt });

describe('baseLayout', () => {
  for (let n = 1; n <= MAX_FACES; n++) {
    it(`n=${n}: has n slots, all inside the circle, largest first`, () => {
      const slots = baseLayout(n);
      expect(slots).toHaveLength(n);
      for (const s of slots) {
        // The whole face, not just its centre, must fit in the frame.
        expect(Math.hypot(s.x, s.y) + s.r).toBeLessThanOrEqual(1.0001);
        expect(s.r).toBeGreaterThan(0);
      }
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i]!.r).toBeLessThanOrEqual(slots[i - 1]!.r);
      }
    });
  }

  it('n=6: no two faces overlap by more than a sliver', () => {
    const slots = baseLayout(6);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]!;
        const b = slots[j]!;
        const overlap = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
        expect(overlap).toBeLessThan(0.1);
      }
    }
  });

  it('clamps to 1..6', () => {
    expect(baseLayout(0)).toHaveLength(1);
    expect(baseLayout(9)).toHaveLength(MAX_FACES);
  });
});

describe('clusterLayout', () => {
  it('is stable for the same group and visit — re-renders never move anything', () => {
    expect(clusterLayout(6, 'g1', 42)).toEqual(clusterLayout(6, 'g1', 42));
  });

  it('shuffles on a new visit', () => {
    expect(clusterLayout(6, 'g1', 42)).not.toEqual(clusterLayout(6, 'g1', 43));
  });

  it('differs between groups within one visit', () => {
    expect(clusterLayout(6, 'g1', 42)).not.toEqual(clusterLayout(6, 'g2', 42));
  });

  it('every shuffle still fits inside the circle and keeps the sizes', () => {
    const base = baseLayout(6);
    for (let seed = 0; seed < 200; seed++) {
      const slots = clusterLayout(6, 'group', seed);
      slots.forEach((s, i) => {
        expect(Math.hypot(s.x, s.y) + s.r).toBeLessThanOrEqual(1.0001);
        expect(s.r).toBe(base[i]!.r);
      });
    }
  });
});

describe('bumpSender', () => {
  const faces = [face('riya', 't3'), face('arjun', 't2'), face('me', 't1'), face('sam')];

  it('moves a new speaker to the front, keeping everyone else in order', () => {
    expect(bumpSender(faces, 'sam', 't4')!.map(f => f.userId)).toEqual(['sam', 'riya', 'arjun', 'me']);
    expect(bumpSender(faces, 'sam', 't4')![0]!.lastSentAt).toBe('t4');
  });

  it('moves someone from the middle', () => {
    expect(bumpSender(faces, 'arjun', 't4')!.map(f => f.userId)).toEqual(['arjun', 'riya', 'me', 'sam']);
  });

  it('returns the same array when the latest speaker speaks again with the same stamp', () => {
    expect(bumpSender(faces, 'riya', 't3')).toBe(faces);
  });

  it('keeps the order but updates the stamp when the latest speaker speaks again', () => {
    const next = bumpSender(faces, 'riya', 't9')!;
    expect(next.map(f => f.userId)).toEqual(['riya', 'arjun', 'me', 'sam']);
    expect(next[0]!.lastSentAt).toBe('t9');
  });

  it('returns null for a sender with no face yet, so the caller refetches', () => {
    expect(bumpSender(faces, 'meera', 't4')).toBeNull();
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(faces));
    bumpSender(faces, 'sam', 't4');
    expect(faces).toEqual(copy);
  });
});

describe('faceInitials', () => {
  it('uses two words when there are two', () => {
    expect(faceInitials({ displayName: 'Riya Sharma', username: 'riya' })).toBe('RS');
  });
  it('falls back to the username', () => {
    expect(faceInitials({ displayName: null, username: 'arjun' })).toBe('A');
  });
  it('never returns empty', () => {
    expect(faceInitials({ displayName: '  ', username: null })).toBe('?');
  });
});

describe('hashString', () => {
  it('is deterministic and spreads nearby ids', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
