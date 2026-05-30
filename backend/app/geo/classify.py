"""Keyword classifier — Python port of src/lib/signals.js.

Turns raw GDELT articles and scraped tweets into classified signal dicts
(disease, severity, relevance signals). County resolution is done
separately by `geo/geocode.py`; final confidence is computed by the
ingestion activity once a county is known.

This module also owns the surveillance vocabulary and source queries
that previously lived in src/data/surveillance.js and src/lib/*.js.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone

# ── Apify source config (was SCRAPE_KEYWORDS / TWITTER_HANDLES) ──────────
SCRAPE_KEYWORDS: list[str] = [
    '"zoonotic disease" Kenya outbreak',
    '"Rift Valley Fever" OR RVF Kenya',
    "anthrax Kenya livestock deaths",
    "brucellosis Kenya cases",
    "rabies Kenya dog bites",
    '"Crimean-Congo Hemorrhagic Fever" OR CCHF Kenya',
    "mifugo wanakufa Kenya",
    "ugonjwa wa mifugo Kenya",
    "(Garissa OR Wajir OR Turkana OR Marsabit) livestock disease",
    "(flooding OR heavy rains OR El Nino) Kenya disease outbreak",
    # Filovirus watch — Kenya-only mentions (importation / PoE screening).
    '(Ebola OR Marburg OR "viral hemorrhagic fever") Kenya',
    "Kenya Ebola (screening OR importation OR border OR quarantine OR suspected)",
]

TWITTER_HANDLES: list[str] = [
    "ntvkenya", "citizentvkenya", "KTNNewsKE", "CapitalFMKenya",
    "MOH_Kenya", "KEMRI_Kenya", "ILRI", "icipe",
    "WHO", "AfricaCDC",
]

# Zoonotic topic filter appended to the verified-accounts `from:` query.
HANDLE_TOPIC = (
    '(anthrax OR zoonotic OR "rift valley fever" OR RVF OR rabies OR '
    'brucellosis OR "q fever" OR outbreak OR livestock OR "animal disease" OR '
    'ebola OR marburg OR "viral hemorrhagic fever")'
)

# ── GDELT source query (was src/lib/gdelt.js) ────────────────────────────
# Kenya-scoped: filovirus articles are only ingested when they mention Kenya
# (importation cases, PoE screening) — not the wider regional outbreak feed.
GDELT_QUERY = (
    'Kenya (anthrax OR zoonotic OR "rift valley fever" OR brucellosis OR '
    'rabies OR "q fever" OR "livestock disease" OR "animal disease" OR '
    'ebola OR marburg OR "viral hemorrhagic fever") '
    "sourcelang:eng"
)

# ── Classifier vocabulary ────────────────────────────────────────────────
DISEASE_KEYWORDS: dict[str, list[str]] = {
    "Rift Valley Fever": ["rift valley", "rvf", "abortion storm"],
    "Anthrax": ["anthrax", "spore", "bloated carcass", "sudden death"],
    "Brucellosis": ["brucellosis", "brucella", "raw milk", "undulant fever"],
    "Rabies": ["rabies", "dog bite", "dog attack", "rabid"],
    "Q Fever": ["q fever", "coxiella"],
    "Crimean-Congo HF": ["crimean-congo", "crimean congo", "cchf"],
    # Filoviruses — primarily human-to-human (bat/bushmeat reservoir). The
    # human-vs-livestock split treats these as human-dominant; see
    # _HUMAN_DISEASES in app/temporal/activities.py.
    "Ebola": ["ebola", "ebolavirus", "sudan virus", "evd"],
    "Marburg": ["marburg", "marburgvirus", "mvd"],
    # Catch-all for hemorrhagic-fever reports that don't name the agent.
    # Listed last so a specific filovirus above wins on equal keyword hits.
    "Viral Hemorrhagic Fever": [
        "viral hemorrhagic fever", "viral haemorrhagic fever",
        "hemorrhagic fever", "haemorrhagic fever", "vhf",
    ],
}

TOPIC_TERMS: list[str] = [
    "zoonotic", "outbreak", "epidemic", "disease", "livestock", "cattle",
    "goat", "sheep", "camel", "poultry", "animal", "carcass", "vaccin",
    "quarantine", "veterinar", "abattoir", "slaughter", "spillover",
    "mifugo", "ugonjwa", "wanyama", "ng'ombe",
    "ebola", "marburg", "hemorrhagic", "haemorrhagic",
]

SEVERITY_TIERS: list[tuple[str, list[str]]] = [
    ("CRITICAL", ["confirmed", "outbreak", "emergency", "hemorrhagic",
                  "mass death", "spreading", "declared"]),
    ("HIGH", ["dying", "dead", "death", "deaths", "suspected", "carcass",
              "abortion", "quarantine"]),
    ("MEDIUM", ["sick", "illness", "fever", "bite", "infected", "vet"]),
]

VERIFIED_HANDLES: set[str] = {h.lower() for h in TWITTER_HANDLES}

_UNCLASSIFIED = "Unclassified zoonotic"


def detect_disease(text_lc: str) -> tuple[str | None, int]:
    """Disease with the most keyword hits, or (None, 0)."""
    best: str | None = None
    best_hits = 0
    for name, keywords in DISEASE_KEYWORDS.items():
        hits = sum(1 for k in keywords if k in text_lc)
        if hits > best_hits:
            best, best_hits = name, hits
    return best, best_hits


def detect_severity(text_lc: str) -> str:
    for tier, keywords in SEVERITY_TIERS:
        if any(k in text_lc for k in keywords):
            return tier
    return "LOW"


def has_zoonotic_topic(text_lc: str) -> bool:
    return any(term in text_lc for term in TOPIC_TERMS)


def _hash(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_gdelt_date(raw: str | None) -> str:
    """GDELT 'YYYYMMDDTHHMMSSZ' -> ISO-8601, falling back to now."""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$", raw or "")
    if not m:
        return _now_iso()
    y, mo, d, h, mi, s = m.groups()
    return f"{y}-{mo}-{d}T{h}:{mi}:{s}+00:00"


def _parse_tweet_date(raw: str | None) -> str:
    if not raw:
        return _now_iso()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return _now_iso()


def _tweet_text(t: dict) -> str:
    return (t.get("text") or t.get("fullText") or t.get("full_text") or "").strip()


def _tweet_handle(t: dict) -> str:
    author = t.get("author") or {}
    user = author.get("userName") or author.get("screen_name") or t.get("username")
    if user:
        return f"@{user}"
    return author.get("name") or "X/Twitter"


def classify_articles(articles: list[dict]) -> list[dict]:
    """GDELT articles -> classified dicts. Syndicated duplicates collapsed."""
    seen: set[str] = set()
    out: list[dict] = []
    for a in articles:
        title = (a.get("title") or "").strip()
        if not title:
            continue
        key = re.sub(r"\s+", " ", title.lower())
        if key in seen:
            continue
        seen.add(key)

        lc = title.lower()
        disease, hits = detect_disease(lc)
        url = a.get("url")
        out.append(
            {
                "id": f"gdelt-{url}" if url else f"gdelt-{_hash(title)}",
                "src": "News",
                "handle": a.get("domain") or "news",
                "text": title,
                "disease": disease or _UNCLASSIFIED,
                "severity": detect_severity(lc),
                "hits": hits,
                "verified": False,
                "topic": True,  # GDELT query is already topic-scoped
                "event_time": _parse_gdelt_date(a.get("seendate")),
                "lat": None,
                "lng": None,
            }
        )
    return out


def _coord(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def classify_tweets(tweets: list[dict]) -> list[dict]:
    """Scraped tweets -> classified dicts (no relevance filtering yet)."""
    out: list[dict] = []
    for t in tweets:
        if not isinstance(t, dict) or t.get("noResults"):
            continue
        text = _tweet_text(t)
        if not text:
            continue
        author = t.get("author") or {}
        username = (author.get("userName") or author.get("screen_name") or "").lower()
        verified = username in VERIFIED_HANDLES

        lc = text.lower()
        disease, hits = detect_disease(lc)
        tid = t.get("id") or t.get("url")
        out.append(
            {
                "id": str(tid) if tid else f"x-{_hash(text)}",
                "src": "X · verified" if verified else "X/Twitter",
                "handle": _tweet_handle(t),
                "text": text,
                "disease": disease or _UNCLASSIFIED,
                "severity": detect_severity(lc),
                "hits": hits,
                "verified": verified,
                "topic": has_zoonotic_topic(lc),
                "event_time": _parse_tweet_date(
                    t.get("createdAt") or t.get("created_at") or t.get("date")
                ),
                "lat": _coord(t.get("latitude")),
                "lng": _coord(t.get("longitude")),
            }
        )
    return out
