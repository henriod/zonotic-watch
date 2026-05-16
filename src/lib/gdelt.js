/**
 * GDELT client — pulls recent news articles about Kenya zoonotic disease
 * from the GDELT 2.0 DOC API.
 *
 * Zero setup: the API is free and needs no key or registration. It sends
 * no CORS headers, though, so the browser can't call it directly — in dev
 * we go through the Vite dev-server proxy (`/gdelt/*`, see vite.config.js);
 * a production build needs its own server-side proxy. GDELT re-indexes
 * worldwide news every ~15 minutes.
 *
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 */

// Dev: hit the Vite proxy (no CORS). Prod build: direct URL — which will
// CORS-fail until a real backend proxy is in place (see README).
const GDELT_API = import.meta.env.DEV
  ? "/gdelt/api/v2/doc/doc"
  : "https://api.gdeltproject.org/api/v2/doc/doc";

// "Kenya" AND a specific zoonotic disease — "outbreak" alone is left out on
// purpose, it pulls in unrelated regional stories.
const QUERY =
  'Kenya (anthrax OR zoonotic OR "rift valley fever" OR brucellosis OR ' +
  'rabies OR "q fever" OR "livestock disease" OR "animal disease") sourcelang:eng';

/**
 * Fetch recent Kenya zoonotic-disease news articles.
 *
 * @param {object} opts
 * @param {number} [opts.maxRecords=25] - max articles to fetch
 * @param {string} [opts.timespan="3m"] - lookback window (e.g. "1m", "3m")
 * @param {(status: string) => void} [opts.onStatus] - progress callback
 * @returns {Promise<object[]>} GDELT article objects
 */
export async function fetchGdeltArticles(opts = {}) {
  const { maxRecords = 25, timespan = "3m", onStatus } = opts;

  onStatus?.("Querying GDELT news index…");
  const params = new URLSearchParams({
    query: QUERY,
    mode: "ArtList",
    format: "json",
    maxrecords: String(maxRecords),
    sort: "DateDesc",
    timespan,
  });

  const res = await fetch(`${GDELT_API}?${params}`);
  if (res.status === 429) {
    throw new Error("GDELT rate limit hit — wait ~1 min and retry");
  }
  if (!res.ok) throw new Error(`GDELT ${res.status} ${res.statusText}`);

  // GDELT returns a plain-text error message (not JSON) on a bad query.
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `GDELT returned an unexpected response: ${text.slice(0, 120)}`
    );
  }
  return json.articles ?? [];
}
