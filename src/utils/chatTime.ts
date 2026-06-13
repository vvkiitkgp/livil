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

function formatTimeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Time-of-day only, e.g. "12:34 PM". Used by the swipe-to-reveal row, where the
// date would be redundant — the centered ChatTimeSeparator already labels each
// group's date. Matches Instagram, whose swipe gesture reveals only the time
// (and keeps it from truncating in the narrow reveal slot).
export function formatChatTimeOnly(iso: string): string {
  return formatTimeOfDay(new Date(iso));
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
  const time = formatTimeOfDay(d);

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
