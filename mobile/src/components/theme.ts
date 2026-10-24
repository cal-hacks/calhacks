import { useColorScheme } from "react-native";

const light = {
  bg: "#f5f5f2",
  surface: "#fcfcfb",
  surface2: "#f0efeb",
  border: "#e2e1dc",
  text: "#0b0b0b",
  text2: "#52514e",
  text3: "#75746f",
  accent: "#2a78d6",
  accentInk: "#ffffff",
  accentSoft: "#e3eefb",
  series1: "#2a78d6",
  grid: "#e6e5e0",
  good: "#1a7f37",
  goodSoft: "#dcf3e2",
  warn: "#9a6700",
  warnSoft: "#fff4d6",
  danger: "#c62828",
  dangerSoft: "#fde8e8",
  miss: "#d4d3cd",
};

export type Colors = typeof light;

const dark: Colors = {
  bg: "#121211",
  surface: "#1a1a19",
  surface2: "#232321",
  border: "#2f2f2c",
  text: "#f0efec",
  text2: "#c3c2b7",
  text3: "#9a998f",
  accent: "#3987e5",
  accentInk: "#ffffff",
  accentSoft: "#1c2b40",
  series1: "#3987e5",
  grid: "#2b2b29",
  good: "#4cc26a",
  goodSoft: "#17301e",
  warn: "#e0a930",
  warnSoft: "#3a2e10",
  danger: "#ef6b6b",
  dangerSoft: "#3a1818",
  miss: "#3a3a37",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export const radius = { lg: 16, md: 12, pill: 999 };
