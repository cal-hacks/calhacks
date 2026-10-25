// The demo cast's voices. When someone befriends a cast member nobody has
// claimed (nobody's on that phone to reply), the cast member says hi in the
// new 1:1, so a judge who signs up and adds them gets a real first message.

import { directChat } from './friends';
import type { Ctx } from './schema';

export const GREETINGS: Record<string, string> = {
  demo: 'hiii welcome!! 🐝 this app genuinely brought our group chat back from the dead',
  maya_runs: 'hey hey 🏃‍♀️ one more run this week and I hit my goal, hold me accountable',
  sam_l: 'yo!! welcome to the chaos 🦙 ask me about Gerald',
  jordanp: 'hi!! buried in briefs this week ⚖️ but I promise I read everything',
  'priya.k': 'hiii 👋 just moved to Berkeley for my PhD, tell me your favorite spots',
  alexr: 'hey! glad you found me 🧗 always down for a climbing buddy',
};

/** If `castId` is an unclaimed cast member, they say hi to `otherId` in their 1:1. */
export function greet(ctx: Ctx, castId: bigint, otherId: bigint) {
  const cast = ctx.db.friend.id.find(castId);
  const text = cast && !cast.identity ? GREETINGS[cast.username] : undefined;
  const chat = text ? directChat(ctx, castId, otherId) : undefined;
  if (!text || !chat) return;
  ctx.db.feedItem.insert({
    id: 0n,
    groupId: chat.id,
    friendId: castId,
    kind: 'message',
    text,
    createdBy: 'friend',
    replyToId: 0n,
    createdAt: ctx.timestamp,
    localDate: '',
  });
}
