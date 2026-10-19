import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { renderCommentBody } from '../utils/mentions';
import { useOpenMention } from '../hooks/useOpenMention';

/**
 * A caption with its @usernames tappable (purple), opening that profile — as comments
 * already do. The rest of the text is untouched.
 */
export default function MentionText({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const openMention = useOpenMention();
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {renderCommentBody(text, openMention)}
    </Text>
  );
}
