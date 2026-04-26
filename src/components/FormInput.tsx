import React, { useState, ReactNode } from 'react';
import {
  View,
  TextInput,
  TextInputProps,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { COLORS } from '../theme/colors';

type Props = TextInputProps & {
  trailing?: ReactNode;
  wrapperStyle?: StyleProp<ViewStyle>;
};

export default function FormInput({
  trailing,
  wrapperStyle,
  style,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrapper, focused && styles.wrapperFocused, wrapperStyle]}>
      <TextInput
        {...rest}
        style={[styles.input, trailing ? styles.inputWithTrailing : null, style]}
        placeholderTextColor={rest.placeholderTextColor ?? COLORS.textMuted}
        onFocus={e => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  wrapperFocused: {
    borderColor: COLORS.purple,
  },
  input: {
    flex: 1,
    paddingVertical: 15,
    paddingHorizontal: 14,
    fontSize: 15,
    color: COLORS.white,
  },
  inputWithTrailing: {
    paddingRight: 0,
  },
});
