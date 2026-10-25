import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DbConnection } from "../module_bindings";
import type { AgentEvent, Friend } from "../module_bindings/types";
import "../agent-network.css";

// A standalone, projector-friendly view of the agents talking to each other.
// It opens its own anonymous SpacetimeDB connection (no login, no saved
// token), reads the public agent_event and friend tables, and animates every
// event that arrives after the page loads. History shows in the feed only.

const URI = import.meta.env.VITE_SPACETIMEDB_URI || `ws://${location.hostname}:3000`;
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB || "calhacks";
const COORD = 0n;
const MAX_PEOPLE = 8;
const FEED_LIMIT = 80;
const PACKET_MS = 950;
const RIPPLE_MS = 1300;
const GLOW_MS = 1500;

interface KindInfo { icon: string; color: string; label: string }
const KINDS: Record<string, KindInfo> = {
  trigger: { icon: "⚡", color: "#F5C518", label: "trigger" },
  request: { icon: "📨", color: "#5CC8FF", label: "ask" },
  reply: { icon: "↩︎", color: "#4FE0A0", label: "reply" },
  think: { icon: "🧠", color: "#B79CFF", label: "think" },
  search: { icon: "🔎", color: "#FF9F43", label: "search" },
  post: { icon: "📣", color: "#FF6FAE", label: "post" },
  vote: { icon: "🗳️", color: "#FFE08A", label: "vote" },
  react: { icon: "✨", color: "#FFE08A", label: "react" },
  say: { icon: "💬", color: "#FFE08A", label: "said" },
};
const kindInfo = (k: string): KindInfo => KINDS[k] ?? { icon: "•", color: "#FFE08A", label: k };

interface Ev {
  id: bigint;
  kind: string;
  actor: bigint;
  target: bigint;
  text: string;
  detail: string;
  at: number;
  fresh: boolean;
}
interface Packet { key: string; from: bigint; to: bigint; color: string; start: number }
interface Ripple { key: string; node: bigint; color: string; start: number }
interface Glow { node: bigint; color: string; from: number; until: number }
interface EdgeGlow { node: bigint; color: string; from: number; until: number }

type Status = "connecting" | "live" | "offline";

const toEv = (r: AgentEvent, fresh: boolean): Ev => ({
  id: r.id,
  kind: r.kind,
  actor: r.actorFriendId,
  target: r.targetFriendId,
  text: r.text,
  detail: r.detail,
  at: r.createdAt.toDate().getTime(),
  fresh,
});
const byIdDesc = (a: Ev, b: Ev) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const firstName = (f?: Friend) => (f ? f.name.split(" ")[0] : "Someone");
const isPrivate = (d: string) => d.startsWith("🔒") || /kept private/i.test(d);

function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function hexPoints(r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function AgentNetworkPage() {
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const [status, setStatus] = useState<Status>("connecting");
  const [friends, setFriends] = useState<Map<bigint, Friend>>(new Map());
  const [events, setEvents] = useState<Ev[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [, setFrame] = useState(0);

  const pending = useRef<Ev[]>([]);
  const anim = useRef({ packets: [] as Packet[], ripples: [] as Ripple[], glows: [] as Glow[], edges: [] as EdgeGlow[] });
  const rafRef = useRef<number | null>(null);
  const visibleRef = useRef<bigint[]>([]);

  // ---------- connection ----------
  useEffect(() => {
    let conn: DbConnection | null = null;
    let stopped = false;
    let retry: number | undefined;

    const connect = () => {
      setStatus("connecting");
      let applied = false;
      let seenMax = -1n;
      const c = DbConnection.builder()
        .withUri(URI)
        .withDatabaseName(DB_NAME)
        .onConnect((c) => {
          const refreshFriends = () => setFriends(new Map([...c.db.friend.iter()].map((f) => [f.id, f])));
          c.db.friend.onInsert(refreshFriends);
          c.db.friend.onDelete(refreshFriends);
          c.db.friend.onUpdate?.(refreshFriends);
          c.db.agentEvent.onInsert((ctx, row) => {
            // Rows delivered by the subscription itself are history: they go
            // straight into the feed, unanimated, so a reload doesn't replay a
            // storm of pulses. Only rows inserted afterwards are live.
            if (ctx.event.tag === "SubscribeApplied" || !applied || row.id <= seenMax) {
              const ev = toEv(row, false);
              setEvents((evs) => (evs.some((e) => e.id === ev.id) ? evs : [...evs, ev].sort(byIdDesc).slice(0, 300)));
            } else if (!pending.current.some((e) => e.id === row.id)) {
              pending.current.push(toEv(row, true));
            }
          });
          c.db.agentEvent.onDelete((ctx, row) => {
            if (ctx.event.tag === "SubscribeApplied") return; // reconnect replay

            pending.current = pending.current.filter((e) => e.id !== row.id);
            setEvents((evs) => evs.filter((e) => e.id !== row.id));
          });
          c.subscriptionBuilder()
            .onApplied(() => {
              const rows = [...c.db.agentEvent.iter()];
              for (const r of rows) if (r.id > seenMax) seenMax = r.id;
              applied = true;
              refreshFriends();
              setEvents((evs) => {
                const fresh = evs.filter((e) => e.fresh && !rows.some((r) => r.id === e.id));
                return [...fresh, ...rows.map((r) => toEv(r, false))].sort(byIdDesc).slice(0, 300);
              });
              setStatus("live");
            })
            .onError(() => setStatus("offline"))
            .subscribe(["SELECT * FROM agent_event", "SELECT * FROM friend"]);
        })
        .onConnectError(() => scheduleRetry())
        .onDisconnect(() => scheduleRetry())
        .build();
      conn = c;
    };
    const scheduleRetry = () => {
      if (stopped) return;
      setStatus("offline");
      window.clearTimeout(retry);
      retry = window.setTimeout(() => {
        if (!stopped) connect();
      }, 2500);
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      const old = conn;
      conn = null;
      old?.disconnect();
    };
  }, []);

  // ---------- animation loop ----------
  const kick = () => {
    if (rafRef.current != null) return;
    const loop = () => {
      const t = performance.now();
      const a = anim.current;
      a.packets = a.packets.filter((p) => t - p.start < PACKET_MS + 200);
      a.ripples = a.ripples.filter((r) => t - r.start < RIPPLE_MS);
      a.glows = a.glows.filter((g) => t < g.until);
      a.edges = a.edges.filter((g) => t < g.until);
      setFrame((f) => (f + 1) % 1_000_000);
      if (a.packets.length || a.ripples.length || a.glows.length || a.edges.length) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  };
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const animate = (e: Ev) => {
    const t = performance.now();
    const { color } = kindInfo(e.kind);
    const a = anim.current;
    const rm = reducedRef.current;
    const glow = (node: bigint, delay = 0) => a.glows.push({ node, color, from: t + (rm ? 0 : delay), until: t + (rm ? 0 : delay) + GLOW_MS });
    const ripple = (node: bigint) => { if (!rm) a.ripples.push({ key: `${e.id}-r-${node}`, node, color, start: t }); };
    const send = (from: bigint, to: bigint) => {
      if (from === to) return;
      if (!rm) a.packets.push({ key: `${e.id}-${from}-${to}`, from, to, color, start: t });
      const spoke = from === COORD ? to : to === COORD ? from : null;
      if (spoke != null) a.edges.push({ node: spoke, color, from: t, until: t + PACKET_MS + 500 });
      glow(to, PACKET_MS * 0.85);
    };

    glow(e.actor);
    switch (e.kind) {
      case "request":
        send(e.actor, e.target);
        break;
      case "reply":
        send(e.actor, e.target);
        break;
      case "trigger":
        ripple(e.actor);
        send(e.actor, COORD);
        break;
      case "post":
        if (e.target !== COORD && e.target !== e.actor) send(e.actor, e.target);
        else for (const n of [COORD, ...visibleRef.current]) send(e.actor, n);
        ripple(e.actor);
        break;
      default:
        ripple(e.actor);
    }
    kick();
  };

  // Release queued events one at a time so a burst reads as a conversation.
  useEffect(() => {
    let next = 0;
    const id = window.setInterval(() => {
      const t = performance.now();
      if (!pending.current.length || t < next) return;
      pending.current.sort((a, b) => (a.id < b.id ? -1 : 1));
      const e = pending.current.shift()!;
      setEvents((evs) => [e, ...evs.filter((x) => x.id !== e.id)].sort(byIdDesc).slice(0, 300));
      animate(e);
      next = t + (pending.current.length > 6 ? 230 : 450);
    }, 60);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  // ---------- who's on the graph ----------
  const visibleKey = useMemo(() => {
    const want: bigint[] = [];
    const add = (id: bigint) => {
      if (id !== COORD && !want.includes(id) && want.length < MAX_PEOPLE) want.push(id);
    };
    for (const e of events) {
      add(e.actor);
      add(e.target);
      if (want.length >= MAX_PEOPLE) break;
    }
    if (want.length < 4) {
      for (const f of [...friends.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (want.length >= 6) break;
        add(f.id);
      }
    }
    return want.join(",");
  }, [events, friends]);

  const people = useMemo(() => {
    const want = visibleKey ? visibleKey.split(",").map((s) => BigInt(s)) : [];
    // Sticky order: people keep their place; newcomers take the end.
    const kept = visibleRef.current.filter((id) => want.includes(id));
    const added = want.filter((id) => !kept.includes(id));
    const order = [...kept, ...added];
    visibleRef.current = order;
    return order;
  }, [visibleKey]);

  // ---------- size ----------
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(300, width), h: Math.max(240, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const s = Math.min(1.45, Math.max(0.62, Math.min(w / 880, h / 460)));
  const personR = 40 * s;
  const coordR = 60 * s;
  // Leave room for the legend at the bottom and labels under each node.
  const legendH = 38;
  const labelH = 52 * s;
  const top = personR + 14 * s;
  const bottom = h - legendH - labelH - personR;
  const cx = w / 2;
  const cy = (top + bottom) / 2;
  const rx = Math.max(coordR + personR + 40, w / 2 - personR - 60 * s);
  const ry = Math.max(coordR + personR, (bottom - top) / 2);

  const pos = new Map<bigint, { x: number; y: number }>();
  pos.set(COORD, { x: cx, y: cy });
  people.forEach((id, i) => {
    const n = Math.max(1, people.length);
    // Even counts: rotate half a step so nobody sits straight above or below
    // the coordinator, where the ring is tightest.
    const a = -Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0) + (2 * Math.PI * i) / n;
    pos.set(id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  });

  const tNow = performance.now();
  const a = anim.current;
  const glowOf = (id: bigint) => {
    const g = a.glows.filter((g) => g.node === id && tNow >= g.from).pop();
    return g?.color;
  };
  const edgeOf = (id: bigint) => a.edges.filter((g) => g.node === id && tNow >= g.from).pop()?.color;

  // ---------- derived ----------
  // People act for themselves on trigger/vote/react/say; otherwise it's their agent.
  const HUMAN_KINDS = new Set(["trigger", "vote", "react", "say"]);
  const nameOf = (id: bigint, kind: string) =>
    id === COORD ? "Coordinator" : HUMAN_KINDS.has(kind) ? firstName(friends.get(id)) : `${firstName(friends.get(id))}’s agent`;
  const keptPrivate = events.filter((e) => isPrivate(e.detail)).length;
  const feed = events.slice(0, FEED_LIMIT);
  const empty = events.length === 0;
  const lastAt = events[0]?.at;
  const quiet = !empty && lastAt != null && now - lastAt > 5 * 60_000;

  return (
    <div className={`an-root${reduced ? " an-reduced" : ""}`}>
      <header className="an-header">
        <div className="an-title">
          <span className="an-logo" aria-hidden>🐝</span>
          <div>
            <h1>
              Waggle <span className="an-dot">·</span> <span className="an-hl">Agent Network</span>
            </h1>
            <p className="an-sub">Every friend has their own agent. They coordinate for you, and only share what you allow.</p>
          </div>
        </div>
        <div className="an-stats">
          <span className={`an-status is-${status}`}>
            <i aria-hidden />
            {status === "live" ? "LIVE" : status === "connecting" ? "Connecting…" : "Offline · retrying"}
          </span>
          <span className="an-stat an-stat-lock" title="Details agents kept to themselves">
            🔒 <b>{keptPrivate}</b> kept private
          </span>
        </div>
      </header>

      <main className="an-main">
        <section className="an-stage an-panel" ref={stageRef} aria-label="Agent network graph">
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="an-svg" role="img" aria-label="Coordinator agent connected to each friend's agent">
            <defs>
              <pattern id="an-hex" width={56} height={97} patternUnits="userSpaceOnUse" patternTransform={`scale(${s})`}>
                <path d="M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z M28 64 L28 97" fill="none" stroke="rgba(245,197,24,0.07)" strokeWidth={1.5} />
              </pattern>
              <radialGradient id="an-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(245,197,24,0.22)" />
                <stop offset="100%" stopColor="rgba(245,197,24,0)" />
              </radialGradient>
              <filter id="an-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation={6 * s} result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width={w} height={h} fill="url(#an-hex)" />
            <circle cx={cx} cy={cy} r={Math.min(rx, ry) * 0.9} fill="url(#an-core)" />

            {/* spokes */}
            {people.map((id) => {
              const p = pos.get(id)!;
              const c = edgeOf(id);
              return (
                <g key={`e-${id}`}>
                  <line x1={cx} y1={cy} x2={p.x} y2={p.y} className="an-edge" strokeWidth={2.5 * s} />
                  {c && <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={c} strokeWidth={4 * s} opacity={0.75} filter="url(#an-glow)" />}
                </g>
              );
            })}

            {/* ripples */}
            {a.ripples.map((r) => {
              const p = pos.get(r.node);
              if (!p) return null;
              const base = r.node === COORD ? coordR : personR;
              return [0, 0.28].map((off) => {
                const t = (tNow - r.start) / RIPPLE_MS - off;
                if (t <= 0 || t >= 1) return null;
                return (
                  <circle key={`${r.key}-${off}`} cx={p.x} cy={p.y} r={base + 70 * s * ease(t)} fill="none" stroke={r.color} strokeWidth={4 * s * (1 - t)} opacity={1 - t} />
                );
              });
            })}

            {/* people */}
            {people.map((id) => {
              const p = pos.get(id)!;
              const f = friends.get(id);
              const g = glowOf(id);
              return (
                <g key={`n-${id}`} className="an-node-pos" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
                  <g className={`an-node${g ? " is-active" : ""}${empty ? " is-idle" : ""}`} style={{ ["--glow" as string]: g ?? "#F5C518", animationDelay: empty ? `0s, ${(Number(id % 7n) * 0.37).toFixed(2)}s` : undefined }}>
                    <polygon points={hexPoints(personR)} className="an-hex" strokeWidth={3 * s} filter={g ? "url(#an-glow)" : undefined} />
                    <text className="an-emoji" fontSize={34 * s} dy={12 * s} textAnchor="middle">{f?.avatar || "🙂"}</text>
                    <text className="an-name" fontSize={Math.max(17, 25 * s)} y={personR + 26 * s} textAnchor="middle">{firstName(f)}</text>
                    {f?.city && (
                      <text className="an-city" fontSize={Math.max(13, 17 * s)} y={personR + 26 * s + Math.max(17, 21 * s)} textAnchor="middle">{f.city}</text>
                    )}
                  </g>
                </g>
              );
            })}

            {/* coordinator */}
            {(() => {
              const g = glowOf(COORD);
              return (
                <g style={{ transform: `translate(${cx}px, ${cy}px)` }} className="an-node-pos">
                  <g className={`an-node an-coord${g ? " is-active" : ""}${empty ? " is-idle" : ""}`} style={{ ["--glow" as string]: g ?? "#F5C518" }}>
                    <polygon points={hexPoints(coordR + 10 * s)} className="an-hex-ring" strokeWidth={2 * s} />
                    <polygon points={hexPoints(coordR)} className="an-hex an-hex-coord" strokeWidth={3.5 * s} filter={g ? "url(#an-glow)" : undefined} />
                    <text className="an-emoji" fontSize={46 * s} dy={16 * s} textAnchor="middle">🐝</text>
                    <text className="an-name an-name-coord" fontSize={Math.max(18, 26 * s)} y={coordR + 36 * s} textAnchor="middle">Coordinator</text>
                  </g>
                </g>
              );
            })()}

            {/* packets */}
            {a.packets.map((pk) => {
              const from = pos.get(pk.from);
              const to = pos.get(pk.to);
              if (!from || !to) return null;
              const raw = (tNow - pk.start) / PACKET_MS;
              if (raw < 0 || raw > 1) return null;
              const at = (k: number) => {
                const t = ease(Math.max(0, Math.min(1, raw - k)));
                return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
              };
              const head = at(0);
              const tail = at(0.16);
              return (
                <g key={pk.key}>
                  <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={pk.color} strokeWidth={6 * s} strokeLinecap="round" opacity={0.55} />
                  <circle cx={head.x} cy={head.y} r={9 * s} fill={pk.color} filter="url(#an-glow)" />
                  <circle cx={head.x} cy={head.y} r={4 * s} fill="#fff" />
                </g>
              );
            })}
          </svg>

          {empty && status !== "offline" && (
            <div className="an-waiting" style={{ top: cy + coordR + 52 * s }}>
              <span className="an-waiting-dots" aria-hidden><i /><i /><i /></span>
              {status === "live" ? "Waiting for something to happen…" : "Connecting to the hive…"}
            </div>
          )}
          {status === "offline" && <div className="an-waiting an-waiting-off" style={{ top: cy + coordR + 52 * s }}>Can’t reach the server. Retrying…</div>}

          <ul className="an-legend" aria-label="Legend">
            {(["trigger", "request", "reply", "think", "search", "post", "vote"] as const).map((k) => (
              <li key={k} style={{ ["--c" as string]: KINDS[k].color }}>
                <i aria-hidden />
                {k === "vote" ? "friends" : KINDS[k].label}
              </li>
            ))}
          </ul>
        </section>

        <section className="an-feed an-panel" aria-label="Live agent activity">
          <div className="an-feed-head">
            <h2>Live activity</h2>
            <span className="an-feed-count">{quiet ? "quiet for a bit" : `${events.length} events`}</span>
          </div>
          {feed.length === 0 ? (
            <div className="an-feed-empty">
              <p>Nothing yet.</p>
              <p className="an-muted">When someone says “let’s hang out” or hits a goal, their agents start talking here.</p>
            </div>
          ) : (
            <ol className="an-list" aria-live="polite">
              {feed.map((e) => {
                const k = kindInfo(e.kind);
                const actor = friends.get(e.actor);
                const target = friends.get(e.target);
                const routed = (e.kind === "request" || e.kind === "reply" || (e.kind === "post" && e.target !== COORD)) && e.actor !== e.target;
                return (
                  <li key={String(e.id)} className={`an-item kind-${e.kind}${e.fresh ? " is-fresh" : ""}`} style={{ ["--c" as string]: k.color }}>
                    <span className="an-icon" aria-hidden>{k.icon}</span>
                    <div className="an-body">
                      <div className="an-route">
                        <span className="an-who">
                          {e.actor === COORD ? "🐝" : actor?.avatar} {nameOf(e.actor, e.kind)}
                        </span>
                        {routed && (
                          <>
                            <span className="an-arrow" aria-label="to">→</span>
                            <span className="an-who">
                              {e.target === COORD ? "🐝" : target?.avatar} {nameOf(e.target, e.kind)}
                            </span>
                          </>
                        )}
                        <span className="an-kind">{k.label}</span>
                        <time className="an-time">{ago(e.at, now)}</time>
                      </div>
                      <div className="an-text">{e.text}</div>
                      {e.detail &&
                        (isPrivate(e.detail) ? (
                          <div className="an-private">{e.detail.startsWith("🔒") ? e.detail : `🔒 ${e.detail}`}</div>
                        ) : (
                          <div className="an-detail">{e.detail}</div>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
