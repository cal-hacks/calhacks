import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, logIn, signInWithGoogle, signUp, type GoogleProfile } from "../lib/api";
import { APP_NAME } from "../lib/meta";
import { DEMO_PASSWORD, DEMO_USERNAME } from "../lib/seed";
import { GoogleButton } from "../components/GoogleButton";
import { BeeLogo, HexBackground } from "../components/ui";
import { CalendarIcon, PeopleIcon, TargetIcon } from "../components/icons";

type Mode = "signup" | "login";

export function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signup");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onGoogle = useCallback(
    (profile: GoogleProfile) => {
      const { isNew } = signInWithGoogle(profile);
      navigate(isNew ? "/welcome" : "/", { replace: true });
    },
    [navigate],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "signup") {
        if (password !== confirm) throw new ApiError("Passwords don't match.");
        signUp({ username, password, displayName });
        navigate("/welcome", { replace: true });
      } else {
        logIn(username, password);
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <HexBackground />
        <div className="brand brand-lg">
          <BeeLogo size={72} title={`${APP_NAME} bee logo`} /> {APP_NAME}
        </div>
        <h1>
          <span className="highlight">Stay in each other's lives</span> after graduation.
        </h1>
        <p>
          Your agent notices the wins worth sharing, from a first 10K to a weird weekend spot, and turns them into
          plans with the friends who moved away.
        </p>
        <ul className="auth-points">
          <li><TargetIcon size={24} /> Set goals and let your agent track them</li>
          <li><PeopleIcon size={24} /> Choose exactly what each friend sees</li>
          <li><CalendarIcon size={24} /> Find time that works across time zones</li>
        </ul>
      </section>

      <section className="auth-card card">
        <div className="segmented segmented-full" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : ""} onClick={() => switchMode("signup")}>
            Sign up
          </button>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => switchMode("login")}>
            Log in
          </button>
        </div>

        <GoogleButton onProfile={onGoogle} text={mode === "signup" ? "signup" : "signin"} />

        <div className="divider"><span>or with a username</span></div>

        <form className="stack" onSubmit={submit} noValidate>
          {mode === "signup" && (
            <label className="field">
              <span>Your name</span>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="Riley Chen" />
            </label>
          )}
          <label className="field">
            <span>Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="riley.c"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "At least 8 characters" : ""}
              required
            />
          </label>
          {mode === "signup" && (
            <label className="field">
              <span>Confirm password</span>
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" type="submit">
            {mode === "signup" ? "Create account" : "Log in"}
          </button>
        </form>

        {mode === "login" && (
          <p className="muted small center">
            Exploring? Log in as <code>{DEMO_USERNAME}</code> / <code>{DEMO_PASSWORD}</code> to see a filled-in account.
          </p>
        )}
      </section>
    </div>
  );
}
