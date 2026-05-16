/**
 * Apify client — runs the apidojo "Tweet Scraper V2" actor and returns the
 * scraped dataset items.
 *
 * Browser-only integration: the token is supplied at runtime from the UI and
 * sent straight to api.apify.com (which permits cross-origin requests). This
 * exposes the token to anyone with browser dev-tools open — acceptable for a
 * prototype, but a production deployment should proxy these calls through a
 * backend so the token stays server-side.
 *
 * Actor: https://apify.com/apidojo/tweet-scraper  (~$0.40 per 1,000 tweets)
 */

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = "apidojo~tweet-scraper";

const TERMINAL = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 90; // ~6 minutes before giving up

// Zoonotic topic filter applied to the verified-accounts `from:` query.
const HANDLE_TOPIC =
  '(anthrax OR zoonotic OR "rift valley fever" OR RVF OR rabies OR ' +
  'brucellosis OR "q fever" OR outbreak OR livestock OR "animal disease")';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON, surfacing Apify's error message on a non-2xx response. */
async function apiJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message || "";
    } catch {
      /* response had no JSON body */
    }
    throw new Error(
      `Apify ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`
    );
  }
  return res.json();
}

/**
 * Run the tweet scraper and resolve with the dataset items.
 *
 * @param {string} token - Apify API token
 * @param {object} opts
 * @param {string[]} [opts.searchTerms] - Twitter advanced-search queries
 * @param {string[]} [opts.twitterHandles] - verified accounts to scrape via
 *   a topic-scoped `from:` query
 * @param {number}   [opts.maxItems=60] - cap on total tweets scraped
 * @param {string}   [opts.language="en"] - ISO 639-1 language filter
 * @param {(status: string) => void} [opts.onStatus] - progress callback
 * @returns {Promise<object[]>} scraped tweet objects
 */
export async function runTweetScraper(token, opts = {}) {
  const {
    searchTerms = [],
    twitterHandles = [],
    maxItems = 60,
    language = "en",
    onStatus,
  } = opts;
  if (!token) throw new Error("Apify API token is required");

  // General keyword searches, plus one topic-scoped query restricted to the
  // verified accounts so their disease tweets are pulled (and nothing else).
  const terms = [...searchTerms];
  if (twitterHandles.length) {
    const froms = twitterHandles.map((h) => `from:${h}`).join(" OR ");
    terms.push(`(${froms}) ${HANDLE_TOPIC}`);
  }
  if (!terms.length) throw new Error("At least one search term is required");

  const tok = encodeURIComponent(token);

  // 1. Start an actor run.
  onStatus?.("Starting Tweet Scraper actor…");
  const { data: run } = await apiJson(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${tok}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchTerms: terms,
        maxItems,
        tweetLanguage: language,
        sort: "Latest",
      }),
    }
  );

  // 2. Poll until the run reaches a terminal state.
  let status = run.status;
  for (let i = 0; i < MAX_POLLS && !TERMINAL.includes(status); i++) {
    onStatus?.(`Scraping X/Twitter… (${status.toLowerCase()})`);
    await wait(POLL_INTERVAL_MS);
    const { data } = await apiJson(
      `${APIFY_BASE}/acts/${ACTOR_ID}/runs/${run.id}?token=${tok}`
    );
    status = data.status;
  }
  if (status !== "SUCCEEDED") {
    throw new Error(`Actor run did not succeed (status: ${status})`);
  }

  // 3. Pull the scraped items from the run's default dataset.
  onStatus?.("Fetching scraped tweets…");
  return apiJson(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${tok}&clean=true`
  );
}
