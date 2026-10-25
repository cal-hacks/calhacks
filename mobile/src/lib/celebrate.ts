// A tiny signal for "something worth confetti just happened": one of my goals
// reached its target, or a friend's goal win just arrived. The Confetti
// overlay listens; anything can fire it.

export interface Celebration {
  title: string;
  detail?: string;
}

type Listener = (c: Celebration) => void;
const listeners = new Set<Listener>();

export function celebrate(c: Celebration) {
  listeners.forEach((l) => l(c));
}

export function onCelebrate(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
