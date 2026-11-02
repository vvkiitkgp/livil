// Instagram-style chat timestamp helpers used by both ConversationScreen
// (DMs/groups) and ActivityCenterScreen (livil Bot feed). The two screens
// render their data in opposite directions — ConversationScreen uses an
// inverted FlatList where the chronologically earlier neighbour is at
// `data[i + 1]`, while ActivityCenter renders oldest→newest where the
// earlier neighbour is `data[i - 1]`. The helpers below stay neutral on
// direction — the caller passes the "previous" (chronologically earlier)
// timestamp explicitly.

// Gap above which a separator should appear between two consecutive
// messages. Tuned to roughly match Instagram's behaviour — short bursts
// of back-and-forth render without separators, then the next group is
// labelled. One hour is a forgiving default; tighten if you want denser
// labels.
export const CHAT_TIME_GAP_MS = 60 * 60 * 1000;

export function shouldShowTimeSeparator(
  currentIso: string,
  prevIso: string | null,
  gapMs: number = CHAT_TIME_GAP_MS,
): boolean {
  if (!prevIso) { return true; }  // first message in the thread always gets a label
  const a = new Date(prevIso).getTime();
  const b = new Date(currentIso).getTime();
  return Math.abs(b - a) >= gapMs;
}

/**
 * Whether `later` continues `earlier`'s run of bubbles — the same person, back to back, with
 * no time separator between them. A run shows its sender's name once, on its first bubble,
 * and their photo once, beside its last (Instagram). System lines and jam invites are drawn
 * without either, so they break a run instead of swallowing its name or photo.
 */
export function sameChatRun(
  earlier: { senderId: string | null; kind: string; createdAt: string },
  later: { senderId: string | null; kind: string; createdAt: string },
): boolean {
  const plain = (m: { kind: string }) => m.kind !== 'system' && m.kind !== 'jam_invite';
  return (
    plain(earlier)
    && plain(later)
    && earlier.senderId === later.senderId
    && !shouldShowTimeSeparator(later.createdAt, earlier.createdAt)
  );
}

function formatTimeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Time-of-day only, e.g. "12:34 PM". Used by the swipe-to-reveal row, where the
// date would be redundant — the centered ChatTimeSeparator already labels each
// group's date. Matches Instagram, whose swipe gesture reveals only the time
// (and keeps it from truncating in the narrow reveal slot).
export function formatChatTimeOnly(iso: string): string {
  return cachedTimeOfDay(iso);
}

// toLocaleTimeString is slow on the phone (Hermes on Android: ~7% of a chat's open time in a
// CPU profile, 2026-11-03), and a chat formats every bubble's time on every render. A
// message's time of day never changes, so each one is formatted once.
const timeOfDay = new Map<string, string>();
function cachedTimeOfDay(iso: string): string {
  let text = timeOfDay.get(iso);
  if (text === undefined) {
    if (timeOfDay.size >= 2000) { timeOfDay.clear(); }
    text = formatTimeOfDay(new Date(iso));
    timeOfDay.set(iso, text);
  }
  return text;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Recency-scaled label, modelled on Instagram's separators:
//   - today                  →  "12:34 PM"
//   - yesterday              →  "Yesterday 12:34 PM"
//   - within last 7 days     →  "Thu 12:34 PM"
//   - older, same year       →  "Mar 5, 12:34 PM"
//   - older, different year  →  "Mar 5, 2024, 12:34 PM"
export function formatChatTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = cachedTimeOfDay(iso);

  if (isSameCalendarDay(d, now)) {
    return time;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(d, yesterday)) {
    return `Yesterday ${time}`;
  }

  // Within the last 7 days but not yesterday: weekday + time.
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (d > sevenDaysAgo) {
    const weekday = d.toLocaleDateString([], { weekday: 'short' });
    return `${weekday} ${time}`;
  }

  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = sameYear
    ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${datePart}, ${time}`;
}
