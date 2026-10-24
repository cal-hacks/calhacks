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
  ids = { Maya: friendId('Maya'), Sam: friendId('Sam'), Jordan: friendId('Jordan') };
  gid = rows('friendGroup')[0].id;
});

describe('seed', () => {
  test('creates the demo world', () => {
    expect(rows('friend')).toHaveLength(3);
    expect(rows('membership')).toHaveLength(3);
    expect(rows('consent')).toHaveLength(15);
    expect(rows('feedItem').length).toBeGreaterThan(5);
    expect(rows('freeBlock').length).toBeGreaterThan(5);
    expect(rows('stat').length).toBeGreaterThan(40);
  });

  test('refuses to seed twice, works again after reset', () => {
    expect(() => run(agent, ctx => mod.seedDemo(ctx, {}))).toThrow(/reset_demo/);
    run(agent, ctx => mod.resetDemo(ctx, {}));
    expect(rows('friend')).toHaveLength(0);
    run(agent, ctx => mod.seedDemo(ctx, {}));
    expect(rows('friend')).toHaveLength(3);
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
  test('group invite creates a friend with everything off', () => {
    run(stranger, ctx => mod.joinGroup(ctx, { inviteCode: DEMO_CODES.group, name: 'Priya', city: 'Seattle', timezone: 'America/Los_Angeles', avatar: '🌧️' }));
    const id = friendId('Priya');
    const levels = rows('consent').filter(c => c.friendId === id).map(c => c.shareLevel);
    expect(levels).toEqual(['off', 'off', 'off', 'off', 'off']);
    expect(() => run(stranger, ctx => mod.joinGroup(ctx, { inviteCode: DEMO_CODES.group, name: 'Again', city: '', timezone: '', avatar: '' }))).toThrow(/already/);
  });

  test('a seeded friend can only be claimed once', () => {
    expect(() => run(stranger, ctx => mod.claimFriend(ctx, { claimCode: DEMO_CODES.maya }))).toThrow(/already claimed/);
  });
});

describe('consent and settings', () => {
  test('friends change only their own consent', () => {
    run(maya, ctx => mod.setConsent(ctx, { source: 'screen_time', shareLevel: 'highlights' }));
    const row = rows('consent').find(c => c.friendId === friendId('Maya') && c.source === 'screen_time');
    expect(row.shareLevel).toBe('highlights');
    expect(() => run(maya, ctx => mod.setConsent(ctx, { source: 'dna', shareLevel: 'highlights' }))).toThrow(/source/);
  });

  test('trusted friends must be group members, max two', () => {
    const ids = [friendId('Sam'), friendId('Jordan')];
    run(maya, ctx => mod.setFriendSettings(ctx, { roastOk: false, checkOnMe: true, trustedFriendIds: ids, nudgePreview: false }));
    expect(() =>
      run(maya, ctx => mod.setFriendSettings(ctx, { roastOk: false, checkOnMe: true, trustedFriendIds: [fid('Maya')], nudgePreview: false }))
    ).toThrow(/own trusted/);
    expect(() =>
      run(maya, ctx => mod.setFriendSettings(ctx, { roastOk: false, checkOnMe: true, trustedFriendIds: [999n], nudgePreview: false }))
    ).toThrow(/not in any/);
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

  test('one agent highlight per friend per local day', () => {
    const post = (kind: string, localDate: string) =>
      run(agent, ctx => mod.postFeedItem(ctx, { groupId: groupId(), friendId: fid('Jordan'), kind, text: 'nice', replyToId: 0n, localDate }));
    post('highlight', '2026-10-24');
    expect(() => post('goal_hit', '2026-10-24')).toThrow(/already posted/);
    expect(() => post('highlight', '2026-10-30')).toThrow(/not today/);
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
    // Agent relays Jordan's vote from ASI:One.
    run(agent, ctx => mod.votePlan(ctx, { planId: plan.id, optionId: options[0].id, friendId: fid('Jordan') }));
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
