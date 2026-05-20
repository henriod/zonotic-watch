/**
 * AI Signal Analyzer client.
 *
 * Routing:
 *  - `VITE_ANALYZER=local`  → always hit the on-device Ollama at VITE_OLLAMA_URL
 *  - `VITE_ANALYZER=cloud`  → always hit the backend's `/analyze` proxy
 *  - unset (default)        → cloud when `VITE_API_BASE` is set, else local
 *
 * The cloud path proxies through the backend so the OLLAMA_API_KEY stays
 * server-side and never enters the JS bundle. The local path is for dev
 * against a `gemma4:latest`-style model running on the developer's machine.
 */

import { API_BASE, apiEnabled } from "./api.js";

const LOCAL_URL = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";
const LOCAL_MODEL = import.meta.env.VITE_OLLAMA_MODEL || "gemma4:latest";
const MODE = (import.meta.env.VITE_ANALYZER || "").toLowerCase();

/** Resolved at module load — explicit override wins, else infer from API_BASE. */
const CLOUD =
  MODE === "local" ? false : MODE === "cloud" ? true : apiEnabled();

/** UI badge label — "cloud · Ollama" or "local · {model}". */
export const ANALYZER_LABEL = CLOUD
  ? "cloud · Ollama"
  : `local · ${LOCAL_MODEL}`;

/** True when calling the analyzer requires a logged-in backend session. */
export const ANALYZER_REQUIRES_AUTH = CLOUD;

const SYSTEM_PROMPT = `You are a WHO-trained zoonotic disease surveillance expert specializing in East Africa and Kenya.
Analyze the social media or news signal for zoonotic disease indicators.
Respond with ONLY a JSON object — no preamble, no markdown — matching exactly this shape:
{
  "disease": "most likely disease name",
  "confidence": 0.0-1.0,
  "severity": "LOW|MEDIUM|HIGH|CRITICAL",
  "hosts": ["animal types"],
  "transmission_risk": "one sentence on spillover risk",
  "recommended_actions": ["action 1","action 2","action 3"],
  "weather_correlation": "how weather amplifies this risk",
  "kenya_context": "specific Kenya/regional note"
}`;

/**
 * Analyze a raw signal and return the structured assessment.
 *
 * @param {string} text - the signal text (tweet / headline / pasted note)
 * @param {string} [loc] - location context (county name)
 * @returns {Promise<object>} parsed assessment JSON
 */
export async function analyzeSignal(text, loc) {
  return CLOUD ? analyzeRemote(text, loc) : analyzeLocal(text, loc);
}

async function analyzeRemote(text, loc) {
  let res;
  try {
    res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, loc }),
    });
  } catch {
    throw new Error("Cannot reach the analyzer backend");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      detail?.detail || `Analyzer ${res.status} ${res.statusText}`
    );
  }
  return res.json();
}

async function analyzeLocal(text, loc) {
  let res;
  try {
    res = await fetch(`${LOCAL_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_MODEL,
        stream: false,
        format: "json",
        options: { temperature: 0.3 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Location: ${loc || "Kenya"}\nSignal: "${text}"`,
          },
        ],
      }),
    });
  } catch {
    throw new Error(`Cannot reach Ollama at ${LOCAL_URL} — is it running?`);
  }

  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `Model "${LOCAL_MODEL}" not found — run: ollama pull ${LOCAL_MODEL}`
        : `Ollama ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  const raw = (data.message?.content ?? "").replace(/```json|```/g, "").trim();
  if (!raw) throw new Error("Empty response from the model");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
}
