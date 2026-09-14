/**
 * The tag input — chips plus a field that turns typing into one of them.
 *
 * The web dashboard's `TagField` in mobile idiom, deliberately: both commit the NORMALIZED
 * tag the moment it is created, so what the artist sees on screen is exactly the string that
 * reaches `tracks.tags`. A plain text field would show what was typed and store something
 * else, and the gap only ever surfaces later, as a search that does not find the track.
 *
 * Commit happens on the separator, not on a key event. `onKeyPress` does not fire reliably
 * for printable characters on Android, so the separator is read out of the text itself —
 * which also makes paste behave, since a pasted "lofi, latenight" arrives as one change.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import FormInput from './FormInput';
import { Icon } from './Icon';
import { COLORS } from '../theme/colors';
import {
  MAX_TAGS_PER_TRACK,
  TAG_MAX_LENGTH,
  addTags,
  formatTag,
} from '../../shared/constants/tags';

/** Space, comma, newline and semicolon all end a tag. A tag can contain none of them. */
const ENDS_A_TAG = /[\s,;]/;

type Props = {
  tags: string[];
  onChange: (tags: string[]) => void;
  editable?: boolean;
  placeholder?: string;
};

export default function TagInput({
  tags,
  onChange,
  editable = true,
  placeholder = 'lofi, latenight, tabla',
}: Props) {
  // Held here, not lifted. Lifting the draft to the parent re-renders the screen on every
  // keystroke and remounts the TextInput on Android 15 + Fabric — the keyboard-dismiss bug
  // FormInput exists to prevent.
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const result = addTags(tags, raw);
    setError(result.error);
    if (result.tags.length !== tags.length) {
      onChange(result.tags);
    }
    setDraft('');
  };

  const handleChange = (text: string) => {
    if (error) {
      setError(null);
    }
    if (ENDS_A_TAG.test(text)) {
      // Everything up to the separator becomes tags; whatever follows it stays in the field,
      // so typing straight through a pasted list does not lose the last word.
      const lastSeparator = text.search(/[\s,;](?=[^\s,;]*$)/);
      const done = text.slice(0, lastSeparator + 1);
      const rest = text.slice(lastSeparator + 1);
      const result = addTags(tags, done);
      setError(result.error);
      if (result.tags.length !== tags.length) {
        onChange(result.tags);
      }
      setDraft(rest);
      return;
    }
    setDraft(text);
  };

  const full = tags.length >= MAX_TAGS_PER_TRACK;

  return (
    <View>
      {tags.length > 0 && (
        <View style={styles.chips}>
          {tags.map(tag => (
            <View key={tag} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {formatTag(tag)}
              </Text>
              {editable && (
                <TouchableOpacity
                  onPress={() => {
                    setError(null);
                    onChange(tags.filter(t => t !== tag));
                  }}
                  activeOpacity={0.7}
                  style={styles.chipRemove}
                  accessibilityLabel={`Remove tag ${tag}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close" size={16} color={COLORS.purpleLight} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {!full && (
        <FormInput
          value={draft}
          onChangeText={handleChange}
          onSubmitEditing={() => commit(draft)}
          // Saves the tag someone typed and then tapped away from, which would otherwise
          // vanish at publish with nothing on screen having said so.
          onBlur={() => commit(draft)}
          placeholder={placeholder}
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          // Never a submit: this field belongs to a form whose submit publishes a track.
          blurOnSubmit={false}
          maxLength={TAG_MAX_LENGTH * 2}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  // Purple outline, no fill — a tag is not an indicator, so the no-solid-fill rule applies.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.purpleDeep,
    backgroundColor: COLORS.purpleDim,
    maxWidth: '100%',
  },
  chipText: {
    color: COLORS.purpleLight,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  chipRemove: {
    marginLeft: 2,
  },
  error: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.warning,
  },
});
