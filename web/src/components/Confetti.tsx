import { useEffect, useState } from "react";
import { onCelebrate, type Celebration } from "../lib/celebrate";

// Full-screen confetti plus a banner, for a few seconds after celebrate().
// Pieces are plain divs on a CSS animation; with reduced motion, only the
// banner shows.

const COLORS = ["#F4C21B", "#EB6834", "#1BAF7A", "#2A78D6", "#E87BA4", "#6250D6"];
const PIECES = 90;
const SHOW_MS = 3800;

interface Piece {
  left: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  size: number;
  color: string;
  round: boolean;
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    duration: 2.2 + Math.random() * 1.4,
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    size: 7 + Math.random() * 7,
    color: COLORS[i % COLORS.length],
    round: Math.random() < 0.3,
  }));
}

export function Confetti() {
  const [shown, setShown] = useState<{ c: Celebration; pieces: Piece[]; key: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onCelebrate((c) => {
      clearTimeout(timer);
      setShown({ c, pieces: makePieces(), key: Date.now() });
      timer = setTimeout(() => setShown(null), SHOW_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="confetti" key={shown.key}>
      <div className="confetti-pieces" aria-hidden>
        {shown.pieces.map((p, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? "50%" : 2,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              ["--drift" as string]: `${p.drift}px`,
              ["--spin" as string]: `${p.spin}deg`,
            }}
          />
        ))}
      </div>
      <div className="confetti-banner" role="status" aria-live="polite">
        <strong>{shown.c.title}</strong>
        {shown.c.detail && <span>{shown.c.detail}</span>}
      </div>
    </div>
  );
}
