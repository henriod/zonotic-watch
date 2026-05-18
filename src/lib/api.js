/**
 * Thin client for the ZonoticWatch backend API.
 *
 * The backend base URL comes from `VITE_API_BASE`. When it is unset the
 * dashboard runs fully offline on the seed data in `src/data/surveillance.js`;
 * `apiEnabled()` lets callers branch on that so an un-configured checkout
 * still runs.
 */

/** Backend origin, e.g. "http://localhost:8000"; "" when no backend is set. */
export const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

/** True when a backend is configured; callers fall back to seed data otherwise. */
export function apiEnabled() {
  return API_BASE.length > 0;
}

/** GET `path` from the backend and parse the JSON response body. */
export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

/** POST `path` (optional JSON body) and parse the JSON response body. */
export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return res.json();
}
