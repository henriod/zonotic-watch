/**
 * Local LLM client — analyzes a signal for zoonotic disease indicators using
 * a model served by Ollama on the user's own machine.
 *
 * No API key, no cost, no data leaves the machine. Ollama allows CORS from
 * localhost origins by default, so the browser calls it directly.
 *
 * Setup: install Ollama (https://ollama.com), then `ollama pull gemma4`.
 * Override the URL / model via VITE_OLLAMA_URL and VITE_OLLAMA_MODEL in .env.
 */

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";

/** The model the analyzer uses — exported so the UI can label itself. */
export const OLLAMA_MODEL =
  import.meta.env.VITE_OLLAMA_MODEL || "gemma4:latest";

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
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
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
    throw new Error(`Cannot reach Ollama at ${OLLAMA_URL} — is it running?`);
  }

  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `Model "${OLLAMA_MODEL}" not found — run: ollama pull ${OLLAMA_MODEL}`
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
