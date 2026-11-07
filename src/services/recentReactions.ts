import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'livil.recentReactions.v1';
const MAX_RECENT = 24;

/** `emoji` first, without a second copy, and never more than MAX_RECENT. */
export function withRecent(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter(e => e !== emoji)].slice(0, MAX_RECENT);
}

/** The emoji this phone last reacted with from the sheet, newest first. Empty if unreadable. */
export async function getRecentReactions(): Promise<string[]> {
  try {
    const saved: unknown = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

export async function noteRecentReaction(emoji: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(withRecent(await getRecentReactions(), emoji)));
  } catch {
    // A convenience: losing it only empties "Recent".
  }
}
