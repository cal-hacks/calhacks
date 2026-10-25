// Friendships and the chats they open. Shared by the reducers and the seed.

import type { Ctx } from './schema';

export function isMember(ctx: Ctx, groupId: bigint, friendId: bigint): boolean {
  for (const m of ctx.db.membership.friendId.filter(friendId)) {
    if (m.groupId === groupId) return true;
  }
  return false;
}

// The friendship row between two people, in either direction.
export function friendshipBetween(ctx: Ctx, a: bigint, b: bigint) {
  for (const f of ctx.db.friendship.fromId.filter(a)) if (f.toId === b) return f;
  for (const f of ctx.db.friendship.fromId.filter(b)) if (f.toId === a) return f;
  return undefined;
}

export function areFriends(ctx: Ctx, a: bigint, b: bigint): boolean {
  return friendshipBetween(ctx, a, b)?.status === 'accepted';
}

export function directChat(ctx: Ctx, a: bigint, b: bigint) {
  for (const m of ctx.db.membership.friendId.filter(a)) {
    const group = ctx.db.friendGroup.id.find(m.groupId);
    if (group?.isDirect && isMember(ctx, group.id, b)) return group;
  }
  return undefined;
}

// Accepts a friendship and opens the pair's 1:1 chat.
export function befriend(ctx: Ctx, from: bigint, to: bigint) {
  const existing = friendshipBetween(ctx, from, to);
  if (existing) {
    ctx.db.friendship.id.update({ ...existing, status: 'accepted' });
  } else {
    ctx.db.friendship.insert({ id: 0n, fromId: from, toId: to, status: 'accepted', createdAt: ctx.timestamp });
  }
  if (!directChat(ctx, from, to)) {
    const chat = ctx.db.friendGroup.insert({ id: 0n, name: '', isDirect: true });
    ctx.db.membership.insert({ id: 0n, groupId: chat.id, friendId: from });
    ctx.db.membership.insert({ id: 0n, groupId: chat.id, friendId: to });
  }
}
