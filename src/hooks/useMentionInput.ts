import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';
import type { KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
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

/**
 * Room for the @ list under a caption box. The list opens BELOW the field (above it, it
 * pushed the box down), which on a phone is where the keyboard is — so while it is open the
 * scroll view keeps `base + its height` between the field and the keyboard, and scrolls to
 * honour that. Wire `bottomOffset` to the KeyboardAwareScrollView and `onHeightChange` to
 * MentionSuggestions.
 */
export function useMentionListRoom(scrollRef: RefObject<KeyboardAwareScrollViewRef | null>, base: number) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (height <= 0) { return; }
    // After the new bottomOffset has reached the scroll view.
    const t = setTimeout(() => { scrollRef.current?.assureFocusedInputVisible(); }, 50);
    return () => clearTimeout(t);
  }, [height, scrollRef]);
  return { bottomOffset: base + height, onHeightChange: setHeight };
}
