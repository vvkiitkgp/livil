import { useCallback, useMemo, useState } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';
import { detectMentionTrigger } from '../utils/mentions';
import type { MentionProfile } from '../services/comments';

/**
 * `@` suggestions for any text box (captions; comments do the same inline in CommentsSheet).
 * Wire `onSelectionChange` to the input and render `<MentionSuggestions query={query}
 * onSelect={select} />`. A pick replaces the typed `@partial` with `@username ` — always the
 * username, even when the person was found by their name.
 */
export function useMentionInput(value: string, setValue: (next: string) => void) {
  const [caret, setCaret] = useState(0);

  const onSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setCaret(e.nativeEvent.selection.end);
    },
    [],
  );

  const trigger = useMemo(() => detectMentionTrigger(value, caret), [value, caret]);

  const select = useCallback((profile: MentionProfile) => {
    if (!trigger) { return; }
    const before = value.slice(0, trigger.start);
    const after = value.slice(caret);
    const insertion = `@${profile.username} `;
    setValue(`${before}${insertion}${after}`);
    setCaret(before.length + insertion.length);
  }, [value, caret, trigger, setValue]);

  return { onSelectionChange, query: trigger?.partial ?? null, select };
}
