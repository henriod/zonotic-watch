import { useState } from "react";

import { useAuth } from "../lib/auth.jsx";
import { panel } from "../lib/ui.js";

/**
 * Standalone /login page. On success, replaces the URL with `?next` (or `/`)
 * and lets `App.jsx` re-render into the dashboard.
 *
 * Account creation is admin-only — there's no signup link here.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.history.replaceState({}, "", next);
      // Force re-render — App.jsx reads pathname directly.
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight:"calc(100vh - 4rem)", display:"flex", alignItems:"center", justifyContent:"center", padding:"2rem" }}>
      <form onSubmit={submit} style={{ ...panel, padding:"1.5rem", width:"100%", maxWidth:360 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <div style={{ width:34, height:34, borderRadius:"50%", background:"var(--color-background-info)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <i className="ti ti-lock" style={{ fontSize:17, color:"var(--color-text-info)" }} aria-hidden="true" />
          </div>
          <div>
            <p style={{ margin:0, fontWeight:500, fontSize:15 }}>Sign in</p>
            <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>ZonoticWatch Kenya</p>
          </div>
        </div>

        <label style={{ display:"block", marginBottom:10 }}>
          <span style={{ display:"block", fontSize:12, color:"var(--color-text-secondary)", marginBottom:4 }}>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required
            style={{ width:"100%", boxSizing:"border-box", padding:"0.5rem", fontSize:13, fontFamily:"var(--font-mono)" }} />
        </label>
        <label style={{ display:"block", marginBottom:12 }}>
          <span style={{ display:"block", fontSize:12, color:"var(--color-text-secondary)", marginBottom:4 }}>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required
            style={{ width:"100%", boxSizing:"border-box", padding:"0.5rem", fontSize:13, fontFamily:"var(--font-mono)" }} />
        </label>

        {error && (
          <p style={{ margin:"0 0 10px", fontSize:12, color:"var(--color-text-danger)" }}>{error}</p>
        )}

        <button type="submit" disabled={busy || !username || !password}
          style={{ width:"100%", padding:"0.55rem", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background: busy ? "var(--color-background-secondary)" : "var(--color-background-info)", color: busy ? "var(--color-text-tertiary)" : "var(--color-text-info)", cursor: busy ? "not-allowed" : "pointer", fontWeight:500, fontSize:13 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ margin:"12px 0 0", fontSize:12, color:"var(--color-text-tertiary)" }}>
          Accounts are invite-only. Ask an admin to create one for you.
        </p>
      </form>
    </div>
  );
}
