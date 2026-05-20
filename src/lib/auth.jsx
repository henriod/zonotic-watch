/**
 * Auth client + React context.
 *
 * - The backend uses HttpOnly session cookies, so `fetch` calls here pass
 *   `credentials: "include"` and never touch the cookie directly.
 * - `AuthProvider` hydrates by calling `/auth/me` on mount; consumers use
 *   `useAuth()` to read `{ user, login, logout, refresh }`.
 * - `null` user means "not logged in"; `undefined` means "still hydrating".
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { API_BASE, apiEnabled } from "./api.js";

const AuthCtx = createContext(null);

async function authFetch(path, init = {}) {
  if (!apiEnabled()) {
    throw new Error("No backend configured — auth is unavailable in offline mode");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

async function readBodyOrNull(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function expectOk(res) {
  if (res.ok) return readBodyOrNull(res);
  const body = await readBodyOrNull(res);
  throw new Error(body?.detail || `HTTP ${res.status} ${res.statusText}`);
}

export async function fetchMe() {
  const res = await authFetch("/auth/me");
  if (!res.ok) return null;
  return readBodyOrNull(res);
}

export async function loginRequest(username, password) {
  const res = await authFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return expectOk(res);
}

export async function logoutRequest() {
  await authFetch("/auth/logout", { method: "POST" });
}

export async function listUsers() {
  const res = await authFetch("/auth/users");
  return expectOk(res);
}

export async function createUserRequest({ username, password, role }) {
  const res = await authFetch("/auth/users", {
    method: "POST",
    body: JSON.stringify({ username, password, role }),
  });
  return expectOk(res);
}

export async function disableUserRequest(userId) {
  const res = await authFetch(`/auth/users/${userId}`, { method: "DELETE" });
  return expectOk(res);
}

export function AuthProvider({ children }) {
  // undefined → still hydrating; null → anonymous; object → logged in.
  const [user, setUser] = useState(undefined);

  const refresh = useCallback(async () => {
    if (!apiEnabled()) {
      setUser(null);
      return;
    }
    try {
      setUser(await fetchMe());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (username, password) => {
    const u = await loginRequest(username, password);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthCtx.Provider value={{ user, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
