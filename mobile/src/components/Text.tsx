import { forwardRef } from "react";
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from "react-native";
import { FONT } from "./theme";

// Text and TextInput in Patrick Hand. The font has a single weight, and iOS
// would fall back to the system font for a bold weight, so weights are dropped.

function handStyle(style: TextProps["style"]) {
  const { fontWeight: _weight, ...rest } = StyleSheet.flatten(style) ?? {};
  return [{ fontFamily: FONT }, rest];
}

export function Text({ style, ...rest }: TextProps) {
  return <RNText {...rest} style={handStyle(style)} />;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...rest }, ref) {
  return <RNTextInput ref={ref} {...rest} style={handStyle(style)} />;
});
