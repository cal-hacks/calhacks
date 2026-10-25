import type { User } from "../lib/types";

export type AvatarTone = "white" | "honey" | "soft";

const TONES: AvatarTone[] = ["honey", "white", "soft"];

/** A steady tone per position, so avatar stacks alternate like the mockups. */
export function toneAt(i: number): AvatarTone {
  return TONES[i % TONES.length];
}

/** The initial in an ink circle; a photo when the person has one. Dashed while they're only invited. */
export function Avatar({
  user,
  name,
  image,
  size = 40,
  tone = "white",
  pending = false,
}: {
  user?: Pick<User, "avatar" | "displayName">;
  name?: string;
  image?: string;
  size?: number;
  tone?: AvatarTone;
  pending?: boolean;
}) {
  const label = name ?? user?.displayName ?? "";
  const src = image ?? user?.avatar.imageDataUrl;
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`avatar tone-${tone} ${pending ? "is-pending" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden
    >
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : initial}
    </span>
  );
}
