import React, { useState, ReactNode, forwardRef } from 'react';
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
  /** Fixed content before the text, outside the editable value (e.g. the tag field's "#"). */
  leading?: ReactNode;
  trailing?: ReactNode;
  wrapperStyle?: StyleProp<ViewStyle>;
};

const FormInput = forwardRef<TextInput, Props>(function FormInputInner(
  { leading, trailing, wrapperStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrapper, focused && styles.wrapperFocused, wrapperStyle]}>
      {leading}
      <TextInput
        ref={ref}
        {...rest}
        style={[
          styles.input,
          leading ? styles.inputWithLeading : null,
          trailing ? styles.inputWithTrailing : null,
          style,
        ]}
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
});

export default FormInput;

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
  // Like trailing: the leading element owns the gap to the field's edge.
  inputWithLeading: {
    paddingLeft: 0,
  },
  inputWithTrailing: {
    paddingRight: 0,
  },
});
