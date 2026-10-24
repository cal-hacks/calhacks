import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useDB } from "./lib/db";
import { currentUser } from "./lib/api";
import { Layout } from "./components/Layout";
import { AuthPage } from "./pages/AuthPage";
import { PermissionsPage } from "./pages/PermissionsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GoalsPage } from "./pages/GoalsPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GroupPage } from "./pages/GroupPage";
import { SharePage } from "./pages/SharePage";

/**
 * Route guards:
 * - signed out → /auth
 * - signed up but not onboarded → /welcome (permissions), and only then
 * - onboarded users never see /welcome again; they manage access in Settings
 */
function Guard({ need, children }: { need: "guest" | "onboarding" | "member"; children: ReactNode }) {
  const me = currentUser(useDB());
  if (need === "guest") return me ? <Navigate to={me.onboarded ? "/" : "/welcome"} replace /> : <>{children}</>;
  if (!me) return <Navigate to="/auth" replace />;
  if (need === "onboarding" && me.onboarded) return <Navigate to="/" replace />;
  if (need === "member" && !me.onboarded) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/auth" element={<Guard need="guest"><AuthPage /></Guard>} />
      <Route path="/welcome" element={<Guard need="onboarding"><PermissionsPage /></Guard>} />
      <Route element={<Guard need="member"><Layout /></Guard>}>
        <Route index element={<DashboardPage />} />
        <Route path="group" element={<GroupPage />} />
        <Route path="share" element={<SharePage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="friends" element={<ConnectionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
