import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./Text";
import { onCelebrate, type Celebration } from "../lib/celebrate";
import { useColors } from "./theme";

// Full-screen confetti plus a banner, for a few seconds after celebrate().
// With Reduce Motion on, only the banner shows.

const COLORS = ["#F4C21B", "#EB6834", "#1BAF7A", "#2A78D6", "#E87BA4", "#6250D6"];
const PIECES = 60;
const SHOW_MS = 3800;

interface Piece {
  x: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  size: number;
  color: string;
  round: boolean;
}

function makePieces(width: number): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => ({
    x: Math.random() * width,
    delay: Math.random() * 600,
    duration: 2200 + Math.random() * 1400,
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    size: 7 + Math.random() * 7,
    color: COLORS[i % COLORS.length],
    round: Math.random() < 0.3,
  }));
}

export function Confetti() {
  const [shown, setShown] = useState<{ c: Celebration; key: number } | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onCelebrate((c) => {
      clearTimeout(timer);
      setShown({ c, key: Date.now() });
      AccessibilityInfo.announceForAccessibility(`${c.title} ${c.detail ?? ""}`);
      timer = setTimeout(() => setShown(null), SHOW_MS);
    });
    return () => {
      off();
      motion.remove();
      clearTimeout(timer);
    };
  }, []);

  if (!shown) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {!reduceMotion && <Burst key={shown.key} />}
      <Banner key={`b${shown.key}`} c={shown.c} />
    </View>
  );
}

function Burst() {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo(() => makePieces(width), [width]);
  const progress = useRef(pieces.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.parallel(
      progress.map((v, i) =>
        Animated.timing(v, {
          toValue: 1,
          duration: pieces[i].duration,
          delay: pieces[i].delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [progress, pieces]);

  return (
    <>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            top: -20,
            left: p.x,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            borderRadius: p.round ? p.size / 2 : 2,
            backgroundColor: p.color,
            opacity: progress[i].interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: progress[i].interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
              { translateX: progress[i].interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: progress[i].interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}
    </>
  );
}

function Banner({ c }: { c: Celebration }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  }, [pop]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: insets.top + 12,
        alignSelf: "center",
        maxWidth: "90%",
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: colors.text,
        backgroundColor: colors.accent,
        alignItems: "center",
        gap: 2,
        opacity: pop,
        transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
      }}
    >
      <Text style={{ fontSize: 18, color: colors.text }}>{c.title}</Text>
      {c.detail ? <Text style={{ fontSize: 14, color: colors.text, textAlign: "center" }}>{c.detail}</Text> : null}
    </Animated.View>
  );
}
