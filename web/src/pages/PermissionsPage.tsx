import { useNavigate } from "react-router-dom";
import { useDB } from "../lib/db";
import { completeOnboarding, currentUser } from "../lib/api";
import { APP_NAME } from "../lib/meta";
import { PermissionCards } from "../components/PermissionCards";

/** Shown once, right after sign-up. */
export function PermissionsPage() {
  const navigate = useNavigate();
  const me = currentUser(useDB())!;

  const finish = () => {
    completeOnboarding();
    navigate("/friends?welcome=1", { replace: true });
  };

  return (
    <div className="onboarding">
      <div className="steps" aria-label="Setup progress">
        <span className="step is-done">Account</span>
        <span className="step is-active" aria-current="step">Permissions</span>
        <span className="step">Friends</span>
      </div>
      <header className="page-head">
        <h1>Welcome, {me.displayName.split(" ")[0]} 👋</h1>
        <p className="muted">
          Choose what your {APP_NAME} agent can see. Nothing is shared with friends yet: you'll pick that per friend
          next. You can change any of this later in Settings.
        </p>
      </header>

      <PermissionCards />

      <aside className="privacy-note">
        <strong>How your agent uses this:</strong> it filters out anything you haven't allowed <em>before</em> the
        AI sees it, only posts wins (never comparisons), and when it's unsure whether something is too personal, it
        doesn't share.
      </aside>

      <div className="onboarding-actions">
        <button type="button" className="btn btn-ghost" onClick={finish}>Skip for now</button>
        <button type="button" className="btn btn-primary" onClick={finish}>Continue</button>
      </div>
    </div>
  );
}
