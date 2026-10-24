import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID, decodeGoogleCredential, loadGoogleIdentity } from "../lib/integrations";
import type { GoogleProfile } from "../lib/api";

/**
 * Real Google Identity Services button when VITE_GOOGLE_CLIENT_ID is set,
 * otherwise a look-alike that runs a demo sign-in so the flow stays clickable.
 */
export function GoogleButton({ onProfile, text }: { onProfile: (p: GoogleProfile) => void; text: "signup" | "signin" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoEmail, setDemoEmail] = useState("");
  const [demoName, setDemoName] = useState("");

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r: { credential: string }) => onProfile(decodeGoogleCredential(r.credential)),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          width: ref.current.clientWidth || 320,
          text: text === "signup" ? "signup_with" : "continue_with",
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [onProfile, text]);

  if (GOOGLE_CLIENT_ID) {
    return (
      <>
        <div ref={ref} className="gsi-slot" />
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }

  const submitDemo = (e: React.FormEvent) => {
    e.preventDefault();
    const email = demoEmail.trim().toLowerCase();
    if (!email.includes("@")) return;
    onProfile({ sub: `demo-${email}`, email, name: demoName.trim() || email.split("@")[0] });
  };

  return (
    <>
      <button type="button" className="btn btn-google" onClick={() => setDemoOpen((v) => !v)} aria-expanded={demoOpen}>
        <GoogleG /> {text === "signup" ? "Sign up with Google" : "Continue with Google"}
      </button>
      {demoOpen && (
        <form className="demo-google card-inset" onSubmit={submitDemo}>
          <p className="muted small">
            Demo mode: no <code>VITE_GOOGLE_CLIENT_ID</code> set, so enter the Google account to simulate.
          </p>
          <input className="input" type="email" placeholder="you@gmail.com" value={demoEmail} onChange={(e) => setDemoEmail(e.target.value)} required autoFocus />
          <input className="input" placeholder="Your name" value={demoName} onChange={(e) => setDemoName(e.target.value)} />
          <button className="btn btn-primary" type="submit">Continue</button>
        </form>
      )}
    </>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
