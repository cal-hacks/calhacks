import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useDB } from "../lib/db";
import { currentUser } from "../lib/api";
import { connectAs, syncGoals, syncProfile, useLive } from "../lib/live";
import { APP_NAME } from "../lib/meta";
import { Avatar } from "./Avatar";

const NAV = [
  { to: "/group", label: "Group", icon: "💬" },
  { to: "/", label: "Dashboard", icon: "📊", end: true },
  { to: "/goals", label: "Goals", icon: "🎯" },
  { to: "/friends", label: "Friends", icon: "🫂" },
  { to: "/settings", label: "Profile", icon: "⚙️" },
];

export function Layout() {
  const db = useDB();
  const me = currentUser(db);
  const pending = me ? db.connections.filter((c) => c.toId === me.id && c.status === "pending").length : 0;
  const live = useLive();

  // Join the live group as this account, then push what friends should see.
  useEffect(() => {
    if (me) connectAs(me);
  }, [me?.id]);
  useEffect(() => {
    if (!me || live.status !== "ready") return;
    syncProfile(me);
    syncGoals(me.id, db.goals, db.logs);
    // Once per connection; later changes are pushed by api.ts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status, me?.id]);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◎</span> {APP_NAME}
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
            <span className="nav-icon" aria-hidden>{n.icon}</span>
            <span className="nav-label">{n.label}</span>
            {n.to === "/friends" && pending > 0 && <span className="badge" aria-label={`${pending} requests`}>{pending}</span>}
          </NavLink>
        ))}
        {me && (
          <NavLink to="/settings" className="sidebar-me">
            <Avatar user={me} size={32} />
            <span>
              <strong>{me.displayName}</strong>
              <small>@{me.username}</small>
            </span>
          </NavLink>
        )}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
