// Waggle tokens. Ink outlines, honey for "active / connected / chosen" (always
// a fill behind ink text, never text color), paper background. Light only:
// app.json sets userInterfaceStyle "light".

export const waggle = {
  ink: "#1A1A1A",
  honey: "#F5C518",
  honeySoft: "#FFF4C2",
  paper: "#FFFDF6",
  card: "#FFFFFF",
  muted: "#5C5C5C",
  hexLine: "#EADFB4",
  dividerDashed: "#D9D2B8",
  live: "#2E7D32",
  off: "#EDEAE0",
};

/** Screens read these names; they map onto the Waggle tokens. */
const colors = {
  bg: waggle.paper,
  surface: waggle.card,
  surface2: "#F7F2E0",
  border: waggle.ink,
  text: waggle.ink,
  text2: waggle.muted,
  text3: waggle.muted,
  accent: waggle.honey,
  accentInk: waggle.ink,
  accentSoft: waggle.honeySoft,
  series1: waggle.honey,
  grid: waggle.dividerDashed,
  good: waggle.live,
  goodSoft: "#E3F1E4",
  warn: "#7A5A00",
  warnSoft: waggle.honeySoft,
  danger: "#B3261E",
  dangerSoft: "#FCE8E6",
  miss: waggle.off,
};

export type Colors = typeof colors;

export function useColors(): Colors {
  return colors;
}

/** Patrick Hand, loaded in the root layout. It has one weight, so bold isn't used. */
export const FONT = "PatrickHand_400Regular";

export const radius = { lg: 16, md: 14, pill: 999 };
export const border = 2;

/** The signature hard offset shadow: primary buttons and the featured card only. */
export const hardShadow = {
  shadowColor: waggle.ink,
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
};
