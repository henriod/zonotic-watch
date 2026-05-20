import { useEffect, useState } from "react";

import {
  createUserRequest,
  disableUserRequest,
  listUsers,
} from "../lib/auth.jsx";
import { panel } from "../lib/ui.js";

/**
 * Admin-only "Users" tab — list current accounts and create new ones.
 *
 * Rendered from `ZonoticWatch.jsx` only when `useAuth().user.role === "admin"`.
 * No self-disable: the backend already refuses, but the UI hides the button
 * for the current admin's own row to avoid the dead-end click.
 */
export default function UserAdmin({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create-user form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("analyst");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(err.message || "Could not load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;
    setCreating(true);
    setCreateError("");
    try {
      await createUserRequest({
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("analyst");
      await reload();
    } catch (err) {
      setCreateError(err.message || "Could not create user");
    } finally {
      setCreating(false);
    }
  };

  const disable = async (userId) => {
    if (!confirm("Disable this account? They will no longer be able to sign in.")) return;
    try {
      await disableUserRequest(userId);
      await reload();
    } catch (err) {
      setError(err.message || "Could not disable user");
    }
  };

  return (
    <div style={{ padding:"1rem" }}>
      <p style={{ margin:"0 0 10px", fontWeight:500, fontSize:13 }}>Invite a new user</p>
      <form onSubmit={submitCreate} style={{ ...panel, padding:"0.75rem", marginBottom:14 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
          <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="username"
            autoComplete="off" required minLength={3}
            style={{ flex:"1 1 140px", padding:"0.45rem", fontSize:13, fontFamily:"var(--font-mono)" }} />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="password (8+ chars)"
            autoComplete="new-password" required minLength={8}
            style={{ flex:"1 1 160px", padding:"0.45rem", fontSize:13, fontFamily:"var(--font-mono)" }} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
            style={{ padding:"0.45rem", fontSize:13, fontFamily:"var(--font-mono)" }}>
            <option value="analyst">analyst</option>
            <option value="admin">admin</option>
          </select>
        </div>
        {createError && (
          <p style={{ margin:"0 0 8px", fontSize:12, color:"var(--color-text-danger)" }}>{createError}</p>
        )}
        <button type="submit" disabled={creating || !newUsername || newPassword.length < 8}
          style={{ width:"100%", padding:"0.5rem", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-info)", color:"var(--color-text-info)", cursor: creating ? "not-allowed" : "pointer", fontWeight:500, fontSize:13 }}>
          {creating ? "Creating…" : "Create account"}
        </button>
      </form>

      <p style={{ margin:"0 0 8px", fontWeight:500, fontSize:13 }}>Existing accounts</p>
      {loading && <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>Loading…</p>}
      {error && <p style={{ margin:0, fontSize:12, color:"var(--color-text-danger)" }}>{error}</p>}
      {!loading && users.length === 0 && (
        <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>No users.</p>
      )}
      {users.map(u => {
        const isSelf = currentUser && u.id === currentUser.id;
        const disabled = !!u.disabled_at;
        return (
          <div key={u.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"0.6rem 0.7rem", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", marginBottom:6, opacity: disabled ? 0.55 : 1 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ margin:0, fontSize:13, fontWeight:500, fontFamily:"var(--font-mono)" }}>
                {u.username} {isSelf && <span style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>(you)</span>}
              </p>
              <p style={{ margin:0, fontSize:12, color:"var(--color-text-tertiary)" }}>
                {u.role} · created {new Date(u.created_at).toLocaleDateString()}
                {disabled && " · disabled"}
              </p>
            </div>
            {!isSelf && !disabled && (
              <button onClick={() => disable(u.id)}
                style={{ fontSize:12, padding:"0.3rem 0.6rem", borderRadius:4, border:"0.5px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-danger)", cursor:"pointer" }}>
                Disable
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
