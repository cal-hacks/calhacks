import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  addCheckin,
  addGroupMember,
  chatMembers,
  chatTitle,
  createGroup,
  firstName,
  leaveGroup,
  liveFriends,
  openChat,
  sendMessage,
  toggleReaction,
  useLive,
  votePlan,
  type LiveState,
} from "../lib/live";
import type { FeedItem, Friend, FriendGroup, Plan } from "../module_bindings/types";
import { Avatar } from "../components/Avatar";
import { BeeLogo } from "../components/ui";
import { PlusIcon } from "../components/icons";

const REACTIONS = ["❤️", "🎉", "😂", "👏"];

const KIND_LABEL: Record<string, string> = {
  highlight: "Highlight",
  goal_hit: "Goal hit",
  obscure_place: "Weirdest place",
  roast: "Roast (opted in)",
  plan_proposal: "Plan",
  plan_locked: "Plan locked in",
};

function timeLabel(item: { createdAt: { toDate(): Date } }) {
  const d = item.createdAt.toDate();
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** A plan_proposal post and its plan are written in one transaction, so their timestamps match. */
function planFor(live: LiveState, item: FeedItem): Plan | undefined {
  const t = item.createdAt.toDate().getTime();
  return live.plans.find((p) => p.createdAt.toDate().getTime() === t);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Chats: the list of your chats, or the open one. */
export function GroupPage() {
  const live = useLive();
  if (live.status !== "ready") {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Chats</h1>
        </header>
        <div className={live.status === "error" ? "banner warn" : "card"}>
          {live.status === "error" ? live.error : live.status === "joining" ? "Signing you up…" : "Connecting…"}
        </div>
      </div>
    );
  }
  return live.group ? <ChatView live={live} group={live.group} /> : <ChatList live={live} />;
}

function lastActivity(live: LiveState, groupId: bigint): FeedItem | undefined {
  const items = live.allFeed.filter((f) => f.groupId === groupId);
  return items[items.length - 1];
}

function ChatList({ live }: { live: LiveState }) {
  const [making, setMaking] = useState(false);
  const friends = liveFriends(live);
  // A 1:1 whose friend is gone has no other member: hide it.
  const chats = live.groups
    .filter((g) => !g.isDirect || chatMembers(live, g.id).length > 0)
    .map((g) => ({ g, last: lastActivity(live, g.id) }))
    .sort((a, b) => (b.last?.createdAt.toDate().getTime() ?? 0) - (a.last?.createdAt.toDate().getTime() ?? 0));

  return (
    <div className="page">
      <header className="page-head row-between">
        <div>
          <h1>Chats</h1>
          <p className="muted">Talk with your friends, one-on-one or in groups. Only friends can message you.</p>
        </div>
        {friends.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMaking((v) => !v)}>
            {making ? "Cancel" : "New group"}
          </button>
        )}
      </header>
      {making && <NewGroup friends={friends} onDone={() => setMaking(false)} />}
      {chats.length === 0 && (
        <div className="card empty">
          <p>You can chat with your friends here. Add someone and a chat with them opens once they accept.</p>
          <Link className="btn btn-primary btn-sm" to="/friends">Find friends</Link>
        </div>
      )}
      <ul className="people card">
        {chats.map(({ g, last }) => {
          const others = chatMembers(live, g.id);
          const author = last && live.friends.find((f) => f.id === last.friendId);
          const preview = !last
            ? "No messages yet"
            : last.createdBy === "agent"
              ? `🤖 ${last.text}`
              : `${author?.id === live.me?.id ? "You" : firstName(author?.name)}: ${last.text}`;
          return (
            <li key={String(g.id)}>
              <button type="button" className="person friend-summary" onClick={() => openChat(g.id)}>
                <Avatar name={g.isDirect ? others[0]?.name ?? "?" : g.name} size={40} tone={g.isDirect ? "white" : "honey"} />
                <span className="person-text">
                  <strong>{chatTitle(live, g)}</strong>
                  <small className="muted">{g.isDirect ? preview : `${others.length + 1} people · ${preview}`}</small>
                </span>
                {last && <small className="muted">{timeLabel(last)}</small>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewGroup({ friends, onDone }: { friends: Friend[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<bigint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: bigint) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGroup(name, picked);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card stack-sm" onSubmit={create}>
      <label className="field">
        <span>Group name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend crew" maxLength={60} />
      </label>
      <p className="small muted">Only your friends can be in your groups.</p>
      <div className="chips">
        {friends.map((f) => (
          <button key={String(f.id)} type="button" className="chip" aria-pressed={picked.includes(f.id)} onClick={() => toggle(f.id)}>
            {f.avatar} {f.name}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary btn-sm" disabled={busy || !name.trim() || picked.length === 0}>Create group</button>
    </form>
  );
}

function AddMembers({ live, group }: { live: LiveState; group: FriendGroup }) {
  const [error, setError] = useState<string | null>(null);
  const inChat = new Set(live.members.filter((m) => m.groupId === group.id).map((m) => m.friendId));
  const candidates = liveFriends(live).filter((f) => !inChat.has(f.id));
  if (candidates.length === 0) return <p className="small muted">All your friends are already here.</p>;
  return (
    <div className="stack-sm">
      <div className="chips">
        {candidates.map((f) => (
          <button
            key={String(f.id)}
            type="button"
            className="chip chip-add"
            onClick={() => addGroupMember(group.id, f.id).catch((e) => setError(errorText(e)))}
          >
            + {f.avatar} {f.name}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function ChatView({ live, group }: { live: LiveState; group: FriendGroup }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [asCheckin, setAsCheckin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const friendById = new Map(live.friends.map((f) => [f.id, f]));
  const memberIds = new Set(live.members.filter((m) => m.groupId === group.id).map((m) => m.friendId));
  const members = live.friends.filter((f) => memberIds.has(f.id));
  const title = chatTitle(live, group);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [live.feed.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      if (asCheckin) await addCheckin(body);
      else await sendMessage(body);
      setText("");
      setAsCheckin(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page group-page">
      <header className="page-head row-between">
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openChat(null)}>‹ All chats</button>
          <h1>{title}</h1>
          <p className="muted">Everyone here has an agent. Agents post wins and suggest plans; nothing is shared that a friend hasn't opted into.</p>
        </div>
        <div className="stack-sm">
          <div className="group-members" aria-label="Members">
            {members.map((f, i) => (
              <span key={String(f.id)} title={`${f.name} · ${f.city}`}>
                <Avatar name={f.name} size={32} tone={f.id === live.me?.id ? "honey" : i % 2 ? "soft" : "white"} />
              </span>
            ))}
          </div>
          {!group.isDirect && (
            <div className="row-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? "Done" : "Add friends"}</button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (confirm(`Leave ${title}? You'll stop getting its messages.`)) leaveGroup(group.id).catch((e) => setError(errorText(e)));
                }}
              >
                Leave
              </button>
            </div>
          )}
        </div>
      </header>
      {adding && <AddMembers live={live} group={group} />}

      <section className="chat" aria-live="polite">
        {live.feed.length === 0 && <p className="empty">No messages yet. Say hi!</p>}
        {live.feed.map((item) => (
          <ChatItem key={String(item.id)} item={item} live={live} friendById={friendById} />
        ))}
        <div ref={bottom} />
      </section>

      <form className="composer" onSubmit={submit}>
        <button
          type="button"
          className={`chip ${asCheckin ? "chip-on" : ""}`}
          aria-pressed={asCheckin}
          onClick={() => setAsCheckin((v) => !v)}
          title="A check-in tells your agent what happened; it decides whether to share it"
        >
          <PlusIcon size={18} strokeWidth={2.6} /><span className="chip-text">Check-in</span>
        </button>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={asCheckin ? "What happened? e.g. ran my first 10K" : `Message ${group.isDirect ? firstName(title) : "the group"}`}
          maxLength={500}
          aria-label={asCheckin ? "Check-in" : "Message"}
        />
        <button className="btn btn-primary" disabled={sending || !text.trim()}>
          {asCheckin ? "Check in" : "Send"}
        </button>
      </form>
      {asCheckin && <p className="small muted">Your agent turns check-ins into a post for the group, at most one a day.</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function ChatItem({ item, live, friendById }: { item: FeedItem; live: LiveState; friendById: Map<bigint, Friend> }) {
  const author = friendById.get(item.friendId);
  const mine = item.createdBy === "friend" && item.friendId === live.me?.id;
  const reactions = live.reactions.filter((r) => r.feedItemId === item.id);
  const parent = item.replyToId ? live.feed.find((f) => f.id === item.replyToId) : undefined;

  if (item.createdBy === "agent") {
    const kind = KIND_LABEL[item.kind] ?? "Agent";
    const plan = item.kind === "plan_proposal" ? planFor(live, item) : undefined;
    return (
      <article className="agent-post">
        <div className="agent-head">
          <BeeLogo size={22} />
          <strong>{item.friendId === 0n ? "Coordinator" : `${author?.name.split(" ")[0] ?? "Friend"}'s agent`}</strong>
          <span className="pill pill-on">{kind}</span>
          <span className="small muted">{timeLabel(item)}</span>
        </div>
        <p>{item.text}</p>
        {plan && <PlanCard plan={plan} live={live} />}
        <Reactions item={item} reactions={reactions} meId={live.me?.id} />
      </article>
    );
  }

  return (
    <article className={`bubble-row ${mine ? "mine" : ""}`}>
      {!mine && <Avatar name={author?.name} size={32} />}
      <div className="bubble">
        {!mine && <div className="small muted">{author?.name ?? "Someone"}</div>}
        {parent && <div className="reply-to small muted">↪ {parent.text.slice(0, 60)}</div>}
        <div>{item.text}</div>
        <div className="small muted">{timeLabel(item)}</div>
        <Reactions item={item} reactions={reactions} meId={live.me?.id} />
      </div>
    </article>
  );
}

function Reactions({ item, reactions, meId }: { item: FeedItem; reactions: LiveState["reactions"]; meId?: bigint }) {
  return (
    <div className="reactions">
      {REACTIONS.map((emoji) => {
        const these = reactions.filter((r) => r.emoji === emoji);
        const on = these.some((r) => r.friendId === meId);
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction ${on ? "on" : ""} ${these.length ? "" : "faint"}`}
            aria-pressed={on}
            onClick={() => toggleReaction(item.id, emoji).catch(() => {})}
          >
            {emoji}
            {these.length > 0 && <span>{these.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({ plan, live }: { plan: Plan; live: LiveState }) {
  const options = live.options.filter((o) => o.planId === plan.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const votes = live.votes.filter((v) => v.planId === plan.id);
  const myVote = votes.find((v) => v.friendId === live.me?.id)?.optionId;
  const voters = (optionId: bigint) =>
    votes
      .filter((v) => v.optionId === optionId)
      .map((v) => live.friends.find((f) => f.id === v.friendId)?.name ?? "?");

  return (
    <div className="plan-card">
      {plan.status === "confirmed" && <span className="pill pill-on self-start">It's a plan!</span>}
      {plan.status === "cancelled" && <span className="pill pill-off self-start">Cancelled</span>}
      {options.map((o) => {
        const picked = plan.confirmedOptionId === o.id;
        return (
          <button
            key={String(o.id)}
            type="button"
            className={`plan-option ${myVote === o.id ? "voted" : ""} ${picked ? "picked" : ""}`}
            disabled={plan.status !== "open"}
            onClick={() => votePlan(plan.id, o.id).catch(() => {})}
          >
            <span className="plan-label">{o.label}</span>
            {o.detail && <span className="small muted">{o.detail}</span>}
            <span className="plan-voters">
              {voters(o.id).map((name, i) => (
                <Avatar key={i} name={name} size={26} />
              ))}
            </span>
          </button>
        );
      })}
      {plan.status === "open" && <p className="small muted">Tap a time. It's confirmed when most of the group picks the same one.</p>}
    </div>
  );
}
