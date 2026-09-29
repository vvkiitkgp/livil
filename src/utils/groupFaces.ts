/**
 * Pure logic for the group picture: up to six members' faces packed into a circle,
 * the most recent speaker largest (see supabase/migrations/20260925020000_group_faces.sql).
 *
 * Layout model. For each member count there is ONE hand-packed arrangement of SLOTS in
 * the unit circle, sorted largest first — slot 0 is the latest speaker. The per-visit
 * "shuffle" is a random rotation (and optional mirror) of the whole arrangement about
 * the centre: a rotation cannot push a slot outside the circle, so every shuffle is
 * guaranteed to fit, and sizes never change with it. When someone new speaks, members
 * change SLOTS; the slots themselves do not move.
 */

export type GroupFace = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** When they last sent a (non-system, non-deleted) message here; null = never. */
  lastSentAt: string | null;
};

/** A circle in the unit disc: centre (x, y) in [-1, 1], radius r. */
export type Slot = { x: number; y: number; r: number };

export const MAX_FACES = 6;

/**
 * Hand-packed arrangements, largest slot first. Neighbours may overlap slightly — with
 * the dark stroke drawn around each face that reads as a deliberate cluster. Pinned by
 * tests: every slot stays inside the unit circle and radii never increase.
 */
const LAYOUTS: Record<number, Slot[]> = {
  1: [{ x: 0, y: 0, r: 0.9 }],
  2: [
    { x: -0.28, y: -0.18, r: 0.56 },
    { x: 0.46, y: 0.36, r: 0.4 },
  ],
  3: [
    { x: -0.22, y: -0.2, r: 0.5 },
    { x: 0.56, y: -0.02, r: 0.36 },
    { x: 0.18, y: 0.58, r: 0.32 },
  ],
  4: [
    { x: -0.2, y: -0.2, r: 0.46 },
    { x: 0.52, y: -0.24, r: 0.34 },
    { x: 0.36, y: 0.5, r: 0.3 },
    { x: -0.42, y: 0.5, r: 0.26 },
  ],
  5: [
    { x: -0.2, y: -0.16, r: 0.46 },
    { x: 0.48, y: -0.4, r: 0.34 },
    { x: 0.4, y: 0.36, r: 0.3 },
    { x: -0.24, y: 0.54, r: 0.26 },
    { x: -0.68, y: 0.24, r: 0.2 },
  ],
  6: [
    { x: -0.2, y: -0.16, r: 0.44 },
    { x: 0.48, y: -0.4, r: 0.34 },
    { x: 0.4, y: 0.36, r: 0.28 },
    { x: -0.24, y: 0.52, r: 0.24 },
    { x: -0.68, y: 0.24, r: 0.2 },
    { x: -0.08, y: -0.78, r: 0.16 },
  ],
};

/** The unrotated arrangement for `n` faces (clamped to 1..MAX_FACES). */
export function baseLayout(n: number): Slot[] {
  const k = Math.max(1, Math.min(MAX_FACES, Math.floor(n)));
  return LAYOUTS[k]!;
}

/* eslint-disable no-bitwise -- a hash and a PRNG are bit arithmetic by definition */
/** Deterministic 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* eslint-enable no-bitwise */

/**
 * The arrangement for this group on this visit. `visitSeed` changes each time the
 * screen is (re)visited; mixing in the conversation id makes different groups land
 * differently within the same visit. Same inputs → same output, so re-renders while
 * the screen is open never move anything.
 */
export function clusterLayout(n: number, conversationId: string, visitSeed: number): Slot[] {
  // eslint-disable-next-line no-bitwise
  const rand = seededRandom(hashString(conversationId) ^ (visitSeed >>> 0));
  const theta = rand() * Math.PI * 2;
  const mirror = rand() < 0.5 ? -1 : 1;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return baseLayout(n).map(({ x, y, r }) => {
    const mx = x * mirror;
    return { x: mx * cos - y * sin, y: mx * sin + y * cos, r };
  });
}

/**
 * A message from `senderId` arrived at `at`: move them to the front (the largest slot).
 * Returns `null` when the sender is not among the known faces — the caller must refetch,
 * since it has no photo for them (they were the 7th+ member, or just joined).
 * Returns the SAME array when nothing changes, so callers can skip a re-render.
 */
export function bumpSender(faces: GroupFace[], senderId: string, at: string): GroupFace[] | null {
  const i = faces.findIndex(f => f.userId === senderId);
  if (i === -1) { return null; }
  if (i === 0) {
    return faces[0]!.lastSentAt === at ? faces : [{ ...faces[0]!, lastSentAt: at }, ...faces.slice(1)];
  }
  const moved = { ...faces[i]!, lastSentAt: at };
  return [moved, ...faces.slice(0, i), ...faces.slice(i + 1)];
}

/** One or two letters for a face with no photo. */
export function faceInitials(face: Pick<GroupFace, 'displayName' | 'username'>): string {
  const n = face.displayName?.trim() || face.username?.trim() || '?';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) { return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase(); }
  return n.slice(0, 1).toUpperCase();
}
