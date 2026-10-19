import { useCallback, useMemo, useState } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';
import { detectMentionTrigger, renderInputMentions } from '../utils/mentions';
import type { MentionProfile } from '../services/comments';

/**
 * `@` suggestions for any text box (captions; comments do the same inline in CommentsSheet).
 * Wire `onSelectionChange` to the input and render `<MentionSuggestions query={query}
 * onSelect={select} />`. A pick replaces the typed `@partial` with `@username ` — always the
 * username, even when the person was found by their name.
 *
 * `styled` is the text with its @tags in the tag colour: give it to the input as CHILDREN in
 * place of `value` (owner, 2026-10-19: a tag should look like a tag while you type).
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

  const styled = useMemo(() => renderInputMentions(value), [value]);

  return { onSelectionChange, query: trigger?.partial ?? null, select, styled };
}
