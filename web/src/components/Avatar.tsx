import type { User } from "../lib/types";

export function Avatar({ user, size = 40 }: { user: Pick<User, "avatar" | "displayName">; size?: number }) {
  const { avatar } = user;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.5, background: avatar.imageDataUrl ? undefined : avatar.color }}
      aria-hidden
    >
      {avatar.imageDataUrl ? <img src={avatar.imageDataUrl} alt="" referrerPolicy="no-referrer" /> : avatar.emoji}
    </span>
  );
}
