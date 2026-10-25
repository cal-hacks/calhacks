import { beforeEach, describe, expect, test } from 'vitest';
import { ConnectionId, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';
import spacetimedb from '../src/schema';
import { DEMO_CODES } from '../src/seed';

const NOW = new Date('2026-10-24T18:00:00Z'); // Saturday
const auth = (sub: string) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub, aud: [] }), ConnectionId.random());

let h: ReturnType<typeof createModuleTestHarness<any>>;
const agent = auth('agent');
const maya = auth('maya');
const sam = auth('sam');
const jordan = auth('jordan');
const riley = auth('riley');
const stranger = auth('stranger');

const run = (who: TestAuth, fn: (ctx: any) => void) => h.withReducerTx(who, fn);
const rows = (table: string) => [...h.db[table].iter()] as any[];
// Don't read h.db inside run(): the harness can't nest transactions.
const friendId = (name: string) => rows('friend').find(f => f.name.startsWith(name)).id as bigint;
let ids: Record<string, bigint>;
let gid: bigint;
const groupId = () => gid;
const fid = (name: string) => ids[name];

beforeEach(() => {
  h = createModuleTestHarness(spacetimedb, mod);
  h.clock.set(Timestamp.fromDate(NOW));
  run(agent, ctx => mod.claimAgent(ctx, {}));
  run(agent, ctx => mod.seedDemo(ctx, {}));
  run(maya, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.maya }));
  run(sam, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.sam }));
  run(jordan, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.jordan }));
  run(riley, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.riley }));
  ids = { Maya: friendId('Maya'), Sam: friendId('Sam'), Jordan: friendId('Jordan'), Riley: friendId('Riley') };
  gid = rows('friendGroup')[0].id;
});

describe('seed', () => {
  test('creates the demo world', () => {
    // Four in the group plus two others to find.
    expect(rows('friend')).toHaveLength(6);
    // The group's four members, plus two per 1:1 chat between them.
    expect(rows('membership')).toHaveLength(4 + 6 * 2);
    expect(rows('friendship').filter(f => f.status === 'accepted')).toHaveLength(6);
    expect(rows('consent')).toHaveLength(30);
    expect(rows('feedItem').length).toBeGreaterThan(5);
    expect(rows('freeBlock').length).toBeGreaterThan(5);
    expect(rows('stat').length).toBeGreaterThan(40);
  });

  test('refuses to seed twice, works again after reset', () => {
    expect(() => run(agent, ctx => mod.seedDemo(ctx, {}))).toThrow(/reset_demo/);
    run(agent, ctx => mod.resetDemo(ctx, {}));
    expect(rows('friend')).toHaveLength(0);
    expect(rows('friendship')).toHaveLength(0);
    run(agent, ctx => mod.seedDemo(ctx, {}));
    expect(rows('friend')).toHaveLength(6);
  });
});

describe('agent identity', () => {
  test('only one agent can be claimed', () => {
    expect(() => run(stranger, ctx => mod.claimAgent(ctx, {}))).toThrow(/already/);
  });

  test('browsers cannot call agent-only reducers', () => {
    const id = friendId('Maya');
    expect(() =>
      run(maya, ctx => mod.postFeedItem(ctx, { groupId: groupId(), friendId: id, kind: 'highlight', text: 'hi', replyToId: 0n, localDate: '2026-10-24' }))
    ).toThrow(/only the agent/);
    expect(() =>
      run(maya, ctx => mod.addStat(ctx, { friendId: id, type: 'steps', value: '{}', recordedAt: NOW.toISOString(), source: 'manual' }))
    ).toThrow(/only the agent/);
    expect(() => run(stranger, ctx => mod.seedDemo(ctx, {}))).toThrow(/only the agent/);
  });
});

describe('joining', () => {
  test('signing up makes a friend with everything off, no friends and no chats', () => {
    run(stranger, ctx => mod.register(ctx, { username: '@Nina.W', name: 'Nina', city: 'Seattle', timezone: 'America/Los_Angeles', avatar: '🌧️' }));
    const nina = rows('friend').find(f => f.name === 'Nina');
    expect(nina.username).toBe('nina.w');
    const levels = rows('consent').filter(c => c.friendId === nina.id).map(c => c.shareLevel);
    expect(levels).toEqual(['off', 'off', 'off', 'off', 'off']);
    expect(rows('membership').filter(m => m.friendId === nina.id)).toHaveLength(0);
    expect(() => run(stranger, ctx => mod.register(ctx, { username: 'again', name: 'Again', city: '', timezone: '', avatar: '' }))).toThrow(/already/);
  });

  test('usernames are checked and unique', () => {
    expect(() => run(stranger, ctx => mod.register(ctx, { username: 'maya_runs', name: 'X', city: '', timezone: '', avatar: '' }))).toThrow(/taken/);
    expect(() => run(stranger, ctx => mod.register(ctx, { username: 'no spaces', name: 'X', city: '', timezone: '', avatar: '' }))).toThrow(/3–24/);
    run(maya, ctx => mod.setUsername(ctx, { username: 'maya_runs' })); // keeping your own is fine
    expect(() => run(maya, ctx => mod.setUsername(ctx, { username: 'sam_l' }))).toThrow(/taken/);
  });

  test('claiming again moves a seeded friend to the new device', () => {
    run(stranger, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.maya }));
    expect(mod.myFriend(h.viewContext(stranger) as any, {} as any)).toMatchObject({ name: 'Maya Chen' });
    expect(mod.myFriend(h.viewContext(maya) as any, {} as any)).toBeUndefined();
    // Someone who already has a friend can't take another.
    expect(() => run(sam, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.maya }))).toThrow(/already joined/);
  });
});

describe('consent and settings', () => {
  test('friends change only their own consent', () => {
    run(maya, ctx => mod.setConsent(ctx, { source: 'screen_time', shareLevel: 'highlights' }));
    const row = rows('consent').find(c => c.friendId === friendId('Maya') && c.source === 'screen_time');
    expect(row.shareLevel).toBe('highlights');
    expect(() => run(maya, ctx => mod.setConsent(ctx, { source: 'dna', shareLevel: 'highlights' }))).toThrow(/source/);
  });

  test('trusted friends must be friends, max two', () => {
    const ids = [friendId('Sam'), friendId('Jordan')];
    run(maya, ctx => mod.setFriendSettings(ctx, { roastOk: false, checkOnMe: true, trustedFriendIds: ids, nudgePreview: false }));
    expect(() =>
      run(maya, ctx => mod.setFriendSettings(ctx, { roastOk: false, checkOnMe: true, trustedFriendIds: [fid('Maya')], nudgePreview: false }))
    ).toThrow(/own trusted/);
    expect(() =>
      run(maya, ctx => mod.setFriendSettings(ctx, { roastOk: false, checkOnMe: true, trustedFriendIds: [999n], nudgePreview: false }))
    ).toThrow(/not your friend/);
  });

  test('stats from a source that is off are rejected', () => {
    // Maya has screen_time off.
    expect(() =>
      run(agent, ctx => mod.addStat(ctx, { friendId: fid('Maya'), type: 'screen_time', value: '{"hours":3}', recordedAt: NOW.toISOString(), source: 'upload' }))
    ).toThrow(/off/);
    // Jordan has photos off.
    expect(() =>
      run(agent, ctx => mod.addPhoto(ctx, { friendId: fid('Jordan'), placeName: 'x', takenAt: NOW.toISOString(), obscurityScore: 0.5, caption: '', lat: 0, lng: 0 }))
    ).toThrow(/photo/);
  });
});

describe('group chat', () => {
  test('friends send messages and reactions', () => {
    const before = rows('feedItem').length;
    run(maya, ctx => mod.sendMessage(ctx, { groupId: groupId(), text: 'we should catch up', replyToId: 0n }));
    const msg = rows('feedItem').at(-1);
    expect(rows('feedItem')).toHaveLength(before + 1);
    expect(msg).toMatchObject({ kind: 'message', createdBy: 'friend', friendId: friendId('Maya') });
    run(sam, ctx => mod.toggleReaction(ctx, { feedItemId: msg.id, emoji: '🙌' }));
    expect(rows('reaction')).toHaveLength(1);
    run(sam, ctx => mod.toggleReaction(ctx, { feedItemId: msg.id, emoji: '🙌' }));
    expect(rows('reaction')).toHaveLength(0);
  });

  test('one agent highlight per friend per chat per local day; goal wins always get through', () => {
    const post = (kind: string, localDate: string, chat = groupId()) =>
      run(agent, ctx => mod.postFeedItem(ctx, { groupId: chat, friendId: fid('Jordan'), kind, text: 'nice', replyToId: 0n, localDate }));
    post('highlight', '2026-10-24');
    expect(() => post('highlight', '2026-10-24')).toThrow(/already posted/);
    post('goal_hit', '2026-10-24');
    post('goal_hit', '2026-10-24');
    expect(() => post('highlight', '2026-10-30')).toThrow(/not today/);
    expect(() => post('goal_hit', '2026-10-30')).toThrow(/not today/);
    // The same highlight can go to Jordan's 1:1 with Maya too.
    const inChat = (g: bigint, f: bigint) => rows('membership').some(m => m.groupId === g && m.friendId === f);
    const dm = rows('friendGroup').find(g => g.isDirect && inChat(g.id, fid('Jordan')) && inChat(g.id, fid('Maya')));
    post('highlight', '2026-10-24', dm.id);
  });

  test('roasts need roast_ok', () => {
    const roast = (name: string) =>
      run(agent, ctx => mod.postFeedItem(ctx, { groupId: groupId(), friendId: fid(name), kind: 'roast', text: 'night owl 🦉', replyToId: 0n, localDate: '2026-10-24' }));
    expect(() => roast('Jordan')).toThrow(/roasts/);
    roast('Sam'); // Sam opted in; the seed's roast was yesterday.
  });
});

describe('check-on-me nudges', () => {
  test('need opt-in, a trusted recipient, and no numbers', () => {
    const nudge = (about: string, to: string, text: string) =>
      run(agent, ctx => mod.postNudge(ctx, { aboutFriendId: fid(about), toFriendId: fid(to), text }));
    expect(() => nudge('Sam', 'Maya', 'say hi')).toThrow(/check-on-me/);
    expect(() => nudge('Maya', 'Jordan', 'say hi')).toThrow(/trusted/);
    expect(() => nudge('Maya', 'Sam', 'Maya slept 4 hours')).toThrow(/numbers/);
    nudge('Maya', 'Sam', 'Maya’s had a packed couple of weeks. Might be a good time to say hi.');
    expect(rows('nudge')[0].status).toBe('pending_preview');
  });

  test('preview, approve, and private delivery', () => {
    run(agent, ctx => mod.postNudge(ctx, { aboutFriendId: fid('Maya'), toFriendId: fid('Sam'), text: 'Might be a good time to say hi.' }));
    const id = rows('nudge')[0].id;
    expect(mod.myNudgePreviews(h.viewContext(maya) as any, {} as any)).toHaveLength(1);
    expect(mod.myNudgeInbox(h.viewContext(sam) as any, {} as any)).toHaveLength(0);
    expect(() => run(sam, ctx => mod.reviewNudge(ctx, { nudgeId: id, approve: true }))).toThrow(/no such/);
    run(maya, ctx => mod.reviewNudge(ctx, { nudgeId: id, approve: true }));
    expect(mod.myNudgeInbox(h.viewContext(sam) as any, {} as any)).toHaveLength(1);
    expect(mod.myNudgeInbox(h.viewContext(jordan) as any, {} as any)).toHaveLength(0);
  });
});

describe('plans', () => {
  const propose = () => {
    run(agent, ctx => mod.proposePlan(ctx, {
      groupId: groupId(),
      title: 'Video call this week?',
      options: JSON.stringify([
        { label: 'Thu 8pm ET / 5pm PT', startsAt: '2026-10-30T00:00:00Z' },
        { label: 'Sat brunch call', detail: 'Everyone’s free 11am ET' },
      ]),
    }));
    const plan = rows('plan')[0];
    const options = rows('planOption').filter(o => o.planId === plan.id);
    return { plan, options };
  };

  test('posts a proposal into the chat', () => {
    propose();
    expect(rows('feedItem').at(-1)).toMatchObject({ kind: 'plan_proposal', createdBy: 'agent' });
  });

  test('a strict majority confirms; votes can change', () => {
    const { plan, options } = propose();
    run(maya, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: 0n }));
    run(maya, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[1].id, friendId: 0n }));
    expect(rows('planVote')).toHaveLength(1);
    run(sam, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: 0n }));
    expect(rows('plan')[0].status).toBe('open');
    // Agent relays Jordan's vote from ASI:One. 2 of 4 isn't a majority yet.
    run(agent, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: fid('Jordan') }));
    expect(rows('plan')[0].status).toBe('open');
    run(riley, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: 0n }));
    expect(rows('plan')[0]).toMatchObject({ status: 'confirmed', confirmedOptionId: options[0].id });
    expect(() => run(maya, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: 0n }))).toThrow(/confirmed/);
  });

  test('friends cannot vote for someone else', () => {
    const { plan, options } = propose();
    expect(() =>
      run(maya, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: fid('Sam') }))
    ).toThrow(/own data/);
  });
});

describe('views', () => {
  test('each viewer sees only their own private rows', () => {
    const mine = mod.myConsent(h.viewContext(maya) as any, {} as any) as any[];
    expect(mine).toHaveLength(5);
    expect(mine.every(c => c.friendId === friendId('Maya'))).toBe(true);
    expect(mod.mySettings(h.viewContext(sam) as any, {} as any)).toMatchObject({ roastOk: true });
    expect(mod.myConsent(h.viewContext(stranger) as any, {} as any)).toEqual([]);
  });
});

describe('ingest token', () => {
  const hash = (c: string) => c.repeat(64);

  test('friends set, replace and clear their own token hash', () => {
    run(maya, ctx => mod.setIngestToken(ctx, { tokenHash: hash('a') }));
    run(maya, ctx => mod.setIngestToken(ctx, { tokenHash: hash('b') }));
    expect(rows('ingestToken')).toEqual([
      expect.objectContaining({ friendId: fid('Maya'), tokenHash: hash('b') }),
    ]);
    run(maya, ctx => mod.clearIngestToken(ctx, {}));
    expect(rows('ingestToken')).toHaveLength(0);
  });

  test('rejects anything but a SHA-256 hex hash, and non-friends', () => {
    expect(() => run(maya, ctx => mod.setIngestToken(ctx, { tokenHash: 'secret' }))).toThrow(/64 lowercase hex/);
    expect(() => run(maya, ctx => mod.setIngestToken(ctx, { tokenHash: hash('A') }))).toThrow(/64 lowercase hex/);
    expect(() => run(agent, ctx => mod.setIngestToken(ctx, { tokenHash: hash('a') }))).toThrow(/not the agent/);
    expect(() => run(stranger, ctx => mod.setIngestToken(ctx, { tokenHash: hash('a') }))).toThrow(/join the group/);
  });
});

describe('friends and chats', () => {
  const nina = auth('nina');
  const omar = auth('omar');
  const signUp = (who: TestAuth, username: string) => {
    run(who, ctx => mod.register(ctx, { username, name: username, city: '', timezone: 'UTC', avatar: '' }));
    return rows('friend').find(f => f.username === username).id as bigint;
  };
  const chatsOf = (who: TestAuth) => mod.myGroups(h.viewContext(who) as any, {} as any) as any[];
  const dmBetween = (who: TestAuth) => chatsOf(who).find(g => g.isDirect);
  let ninaId: bigint;
  let omarId: bigint;

  beforeEach(() => {
    ninaId = signUp(nina, 'nina');
    omarId = signUp(omar, 'omar');
  });

  test('a request becomes a friendship and a 1:1 chat when accepted', () => {
    run(nina, ctx => mod.sendFriendRequest(ctx, { toId: omarId }));
    expect(() => run(nina, ctx => mod.sendFriendRequest(ctx, { toId: omarId }))).toThrow(/already sent/);
    expect(chatsOf(nina)).toHaveLength(0);
    const seen = mod.myFriendships(h.viewContext(omar) as any, {} as any) as any[];
    expect(seen).toMatchObject([{ fromId: ninaId, toId: omarId, status: 'pending' }]);
    // Only the recipient accepts.
    expect(() => run(nina, ctx => mod.acceptFriendRequest(ctx, { fromId: omarId }))).toThrow(/no request/);
    run(omar, ctx => mod.acceptFriendRequest(ctx, { fromId: ninaId }));
    const dm = dmBetween(nina);
    expect(dm).toBeDefined();
    expect(dmBetween(omar).id).toBe(dm.id);
    run(omar, ctx => mod.sendMessage(ctx, { groupId: dm.id, text: 'hey!', replyToId: 0n }));
    expect((mod.myFeed(h.viewContext(nina) as any, {} as any) as any[]).map(f => f.text)).toEqual(['hey!']);
  });

  test('asking someone who already asked you accepts', () => {
    run(nina, ctx => mod.sendFriendRequest(ctx, { toId: omarId }));
    run(omar, ctx => mod.sendFriendRequest(ctx, { toId: ninaId }));
    expect(rows('friendship').find(f => f.fromId === ninaId).status).toBe('accepted');
  });

  test('unclaimed seeded people accept right away', () => {
    const priya = rows('friend').find(f => f.username === 'priya.k').id;
    run(nina, ctx => mod.sendFriendRequest(ctx, { toId: priya }));
    expect(chatsOf(nina)).toHaveLength(1);
  });

  test('strangers cannot message, see or join each other’s chats', () => {
    const dm = dmBetween(maya);
    expect(() => run(nina, ctx => mod.sendMessage(ctx, { groupId: dm.id, text: 'hi', replyToId: 0n }))).toThrow(/not in this group/);
    expect(() => run(nina, ctx => mod.sendMessage(ctx, { groupId: groupId(), text: 'hi', replyToId: 0n }))).toThrow(/not in this group/);
    expect(mod.myFeed(h.viewContext(nina) as any, {} as any)).toEqual([]);
    expect(mod.myMemberships(h.viewContext(nina) as any, {} as any)).toEqual([]);
    // Maya can't pull a stranger into the group either.
    expect(() => run(maya, ctx => mod.addGroupMember(ctx, { groupId: groupId(), friendId: ninaId }))).toThrow(/only add your friends/);
    expect(() => run(nina, ctx => mod.createGroup(ctx, { name: 'Us', friendIds: [omarId] }))).toThrow(/not your friend/);
  });

  test('groups are made of friends and grow with friends', () => {
    run(nina, ctx => mod.sendFriendRequest(ctx, { toId: omarId }));
    run(omar, ctx => mod.acceptFriendRequest(ctx, { fromId: ninaId }));
    run(nina, ctx => mod.createGroup(ctx, { name: 'Weekend', friendIds: [omarId] }));
    const group = chatsOf(omar).find(g => !g.isDirect);
    expect(group.name).toBe('Weekend');
    // Maya befriends Nina, who adds her; Omar can't add Maya (not his friend).
    run(maya, ctx => mod.sendFriendRequest(ctx, { toId: ninaId }));
    run(nina, ctx => mod.acceptFriendRequest(ctx, { fromId: fid('Maya') }));
    expect(() => run(omar, ctx => mod.addGroupMember(ctx, { groupId: group.id, friendId: fid('Maya') }))).toThrow(/only add your friends/);
    run(nina, ctx => mod.addGroupMember(ctx, { groupId: group.id, friendId: fid('Maya') }));
    run(maya, ctx => mod.sendMessage(ctx, { groupId: group.id, text: 'hi all', replyToId: 0n }));
    const dm = dmBetween(omar);
    expect(() => run(nina, ctx => mod.addGroupMember(ctx, { groupId: dm.id, friendId: fid('Maya') }))).toThrow(/1:1/);
    run(omar, ctx => mod.leaveGroup(ctx, { groupId: group.id }));
    expect(() => run(omar, ctx => mod.sendMessage(ctx, { groupId: group.id, text: 'still here?', replyToId: 0n }))).toThrow(/not in this group/);
  });

  test('unfriending closes the 1:1 chat', () => {
    run(nina, ctx => mod.sendFriendRequest(ctx, { toId: omarId }));
    run(omar, ctx => mod.acceptFriendRequest(ctx, { fromId: ninaId }));
    const dm = dmBetween(nina);
    run(omar, ctx => mod.removeFriend(ctx, { friendId: ninaId }));
    expect(rows('friendship')).not.toContainEqual(expect.objectContaining({ fromId: ninaId, toId: omarId }));
    expect(() => run(nina, ctx => mod.sendMessage(ctx, { groupId: dm.id, text: 'hello?', replyToId: 0n }))).toThrow(/not in this group/);
    // Declining a request is the same call.
    run(nina, ctx => mod.sendFriendRequest(ctx, { toId: omarId }));
    run(omar, ctx => mod.removeFriend(ctx, { friendId: ninaId }));
    expect(mod.myFriendships(h.viewContext(nina) as any, {} as any)).toEqual([]);
  });
});
