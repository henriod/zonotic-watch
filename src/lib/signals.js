/**
 * Turns raw scraped tweets (apidojo Tweet Scraper V2 output) into the signal
 * objects the dashboard renders.
 *
 * This is a deliberately lightweight keyword classifier. A production pipeline
 * would route each item through an NLP model for disease attribution,
 * geocoding, and severity — the AI Signal Analyzer (local Ollama model) does
 * exactly this on demand for a single signal.
 */
import { COUNTIES, TWITTER_HANDLES } from "../data/surveillance.js";

/** Lower-cased verified-account usernames, for fast lookup. */
const VERIFIED_HANDLES = new Set(TWITTER_HANDLES.map((h) => h.toLowerCase()));

/** Disease → indicative keywords (lower-case, matched as substrings). */
const DISEASE_KEYWORDS = {
  "Rift Valley Fever": ["rift valley", "rvf", "abortion storm"],
  Anthrax: ["anthrax", "spore", "bloated carcass", "sudden death"],
  Brucellosis: ["brucellosis", "brucella", "raw milk", "undulant fever"],
  Rabies: ["rabies", "dog bite", "dog attack", "rabid"],
  "Q Fever": ["q fever", "coxiella"],
  "Crimean-Congo HF": ["crimean-congo", "crimean congo", "cchf"],
};

/** Broad zoonotic / animal-health vocabulary — relevance gate for tweets. */
const TOPIC_TERMS = [
  "zoonotic", "outbreak", "epidemic", "disease", "livestock", "cattle",
  "goat", "sheep", "camel", "poultry", "animal", "carcass", "vaccin",
  "quarantine", "veterinar", "abattoir", "slaughter", "spillover",
  "mifugo", "ugonjwa", "wanyama", "ng'ombe",
];

/** Severity tiers, checked high → low; first keyword hit wins. */
const SEVERITY_TIERS = [
  ["CRITICAL", ["confirmed", "outbreak", "emergency", "hemorrhagic", "mass death", "spreading", "declared"]],
  ["HIGH", ["dying", "dead", "death", "deaths", "suspected", "carcass", "abortion", "quarantine"]],
  ["MEDIUM", ["sick", "illness", "fever", "bite", "infected", "vet"]],
];

const lower = (s) => (s || "").toLowerCase();

function tweetText(t) {
  return (t.text ?? t.fullText ?? t.full_text ?? "").trim();
}

function tweetHandle(t) {
  const user = t.author?.userName ?? t.author?.screen_name ?? t.username;
  return user ? `@${user}` : t.author?.name ?? "X/Twitter";
}

function relativeTime(raw) {
  const d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) return "now";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** Pick the disease with the most keyword hits, or null if none match. */
function detectDisease(text) {
  let disease = null;
  let bestHits = 0;
  for (const [name, keywords] of Object.entries(DISEASE_KEYWORDS)) {
    const hits = keywords.filter((k) => text.includes(k)).length;
    if (hits > bestHits) {
      disease = name;
      bestHits = hits;
    }
  }
  return { disease, hits: bestHits };
}

/** Map the tweet to a monitored county by name, defaulting to "Kenya". */
function detectCounty(text) {
  return (
    COUNTIES.find((c) => text.includes(c.name.toLowerCase()))?.name ?? "Kenya"
  );
}

/** True when the text references Kenya or a monitored county. */
function mentionsKenya(text) {
  return (
    text.includes("kenya") ||
    COUNTIES.some((c) => text.includes(c.name.toLowerCase()))
  );
}

/** True when the text is on a zoonotic / animal-health topic. */
function hasZoonoticTopic(text) {
  return TOPIC_TERMS.some((term) => text.includes(term));
}

function detectSeverity(text) {
  for (const [tier, keywords] of SEVERITY_TIERS) {
    if (keywords.some((k) => text.includes(k))) return tier;
  }
  return "LOW";
}

/**
 * Convert scraped tweets into dashboard signal objects.
 *
 * Tweets from verified Kenyan accounts (TWITTER_HANDLES) are trusted and
 * kept as-is. Open-search tweets are noisier — Twitter surfaces global
 * chatter even for Kenya-scoped queries — so they are kept only when they
 * reference Kenya (or a county) AND hit a zoonotic / animal-health topic.
 *
 * @param {object[]} items - raw Apify dataset items
 * @returns {object[]} signal objects shaped like `SIGNALS` in surveillance.js
 */
export function tweetsToSignals(items) {
  return (Array.isArray(items) ? items : [])
    .map((t, i) => {
      const text = tweetText(t);
      if (!text) return null;

      const username = (
        t.author?.userName ??
        t.author?.screen_name ??
        ""
      ).toLowerCase();
      const verified = VERIFIED_HANDLES.has(username);

      const lc = lower(text);
      const { disease, hits } = detectDisease(lc);
      // Verified accounts are authoritative; open-search tweets must clear
      // the Kenya + zoonotic-topic relevance gate.
      if (
        !verified &&
        (!mentionsKenya(lc) || !(hits > 0 || hasZoonoticTopic(lc)))
      ) {
        return null;
      }
      const loc = detectCounty(lc);

      const confidence =
        0.4 +
        hits * 0.15 +
        (loc !== "Kenya" ? 0.12 : 0) +
        (verified ? 0.15 : 0);

      return {
        id: t.id ?? t.url ?? `live-${i}`,
        src: verified ? "X · verified" : "X/Twitter",
        handle: tweetHandle(t),
        text,
        loc,
        disease: disease ?? "Unclassified zoonotic",
        conf: Number(Math.min(0.97, confidence).toFixed(2)),
        time: relativeTime(t.createdAt ?? t.created_at ?? t.date),
        sev: detectSeverity(lc),
      };
    })
    .filter(Boolean);
}

/** Convert GDELT's "20260516T150000Z" timestamp into an ISO-8601 string. */
function parseGdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(s || "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/**
 * Convert GDELT news articles into dashboard signal objects.
 * GDELT syndicates the same story across many outlets, so duplicate
 * headlines are collapsed to the first occurrence.
 *
 * @param {object[]} items - raw GDELT article objects
 * @returns {object[]} signal objects shaped like `SIGNALS` in surveillance.js
 */
export function articlesToSignals(items) {
  const seenTitles = new Set();
  return (Array.isArray(items) ? items : [])
    .map((a, i) => {
      const title = (a.title ?? "").trim();
      if (!title) return null;

      const key = title.toLowerCase().replace(/\s+/g, " ");
      if (seenTitles.has(key)) return null; // drop syndicated duplicates
      seenTitles.add(key);

      const lc = lower(title);
      const { disease, hits } = detectDisease(lc);
      const loc = detectCounty(lc);

      const confidence =
        0.5 + hits * 0.13 + (loc !== "Kenya" ? 0.1 : 0);

      return {
        id: `gdelt-${a.url ?? i}`,
        src: "News",
        handle: a.domain ?? "news",
        text: title,
        loc,
        disease: disease ?? "Unclassified zoonotic",
        conf: Number(Math.min(0.95, confidence).toFixed(2)),
        time: relativeTime(parseGdeltDate(a.seendate)),
        sev: detectSeverity(lc),
      };
    })
    .filter(Boolean);
}
