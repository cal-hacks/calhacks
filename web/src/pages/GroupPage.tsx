import { useEffect, useRef, useState, type FormEvent } from "react";
import { addCheckin, sendMessage, toggleReaction, useLive, votePlan, type LiveState } from "../lib/live";
import type { FeedItem, Friend, Plan } from "../module_bindings/types";
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

export function GroupPage() {
  const live = useLive();
  const [text, setText] = useState("");
  const [asCheckin, setAsCheckin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const friendById = new Map(live.friends.map((f) => [f.id, f]));
  const memberIds = new Set(live.members.filter((m) => m.groupId === live.group?.id).map((m) => m.friendId));
  const members = live.friends.filter((f) => memberIds.has(f.id));

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

  if (live.status !== "ready") {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Group</h1>
        </header>
        <div className={live.status === "error" ? "banner warn" : "card"}>
          {live.status === "error" ? live.error : live.status === "joining" ? "Joining your group…" : "Connecting to your group…"}
        </div>
      </div>
    );
  }

  return (
    <div className="page group-page">
      <header className="page-head row-between">
        <div>
          <h1>{live.group?.name ?? "Group"}</h1>
          <p className="muted">Everyone here has an agent. Agents post wins and suggest plans; nothing is shared that a friend hasn't opted into.</p>
        </div>
        <div className="group-members" aria-label="Members">
          {members.map((f, i) => (
            <span key={String(f.id)} title={`${f.name} · ${f.city}`}>
              <Avatar name={f.name} size={32} tone={f.id === live.me?.id ? "honey" : i % 2 ? "soft" : "white"} />
            </span>
          ))}
        </div>
      </header>

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
          placeholder={asCheckin ? "What happened? e.g. ran my first 10K" : "Message the group"}
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
          <strong>{item.kind === "plan_proposal" ? "Coordinator" : `${author?.name.split(" ")[0] ?? "Friend"}'s agent`}</strong>
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
