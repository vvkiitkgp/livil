import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { COLORS } from '../theme/colors';

export type CommentChunk =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string };

const MENTION_REGEX = /@([a-z0-9_]{2,30})/gi;

/**
 * Split a comment body into text and mention chunks. Mention `value` is the
 * username (without the leading `@`). Usernames are 2–30 chars of alphanum +
 * underscore (matches the profile signup constraints).
 */
export function parseMentions(body: string): CommentChunk[] {
  const chunks: CommentChunk[] = [];
  let lastIndex = 0;
  const re = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      chunks.push({ type: 'text', value: body.slice(lastIndex, match.index) });
    }
    chunks.push({ type: 'mention', value: match[1]! });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    chunks.push({ type: 'text', value: body.slice(lastIndex) });
  }
  return chunks;
}

/**
 * Render a comment body with @mentions as tappable purple <Text>. Caller
 * provides `onMentionPress(username)` to navigate to the profile.
 */
export function renderCommentBody(
  body: string,
  onMentionPress: (username: string) => void,
  baseStyle?: StyleProp<TextStyle>,
): React.ReactNode {
  const chunks = parseMentions(body);
  return chunks.map((c, i) => {
    if (c.type === 'text') {
      return React.createElement(Text, { key: i, style: baseStyle }, c.value);
    }
    return React.createElement(
      Text,
      {
        key: i,
        style: [baseStyle, { color: COLORS.purpleLight, fontWeight: '600' }],
        onPress: () => onMentionPress(c.value),
      },
      `@${c.value}`,
    );
  });
}

export type MentionTrigger = {
  /** The character index where `@` starts. */
  start: number;
  /** The text after `@` (may be empty when caret sits right after the @). */
  partial: string;
};

/**
 * If the caret is currently inside an `@mention` token, return the trigger
 * position + the partial text typed so far. Otherwise null.
 *
 * Rules:
 *  - The `@` must be at the start of the text or preceded by whitespace.
 *  - The partial after `@` must contain only [a-z0-9_] (matches username regex).
 *  - The caret must be at or after the `@`.
 */
export function detectMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret <= 0 || caret > text.length) {
    return null;
  }
  // Scan backwards from caret-1 looking for '@'.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (ch === '@') {
      // Must be at start or after whitespace.
      if (i > 0 && !/\s/.test(text[i - 1]!)) {
        return null;
      }
      const partial = text.slice(i + 1, caret);
      // Stop if the partial contains invalid chars (means we passed a non-mention `@`).
      if (!/^[a-z0-9_]*$/i.test(partial)) {
        return null;
      }
      return { start: i, partial };
    }
    // Stop scanning if we hit whitespace or a non-username char — no mention here.
    if (/\s/.test(ch)) {
      return null;
    }
    if (!/[a-z0-9_]/i.test(ch)) {
      return null;
    }
  }
  return null;
}
