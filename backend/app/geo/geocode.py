"""County resolution — maps a signal to a county (replaces detectCounty()).

Two tiers, per docs/backend-plan.md section 3:
  1. point-in-polygon, when the source carries coordinates;
  2. place-name matching against the 47 GADM county names plus a curated
     town/area alias map.

Fallback is `(None, "Kenya")` — same semantics as the frontend's "Kenya"
default, but now spatially correct whenever location data exists.
"""

from __future__ import annotations

import re
from collections import Counter
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Town / area / spaced-name -> county slug id. Covers places whose written
# form differs from the GADM county name (GADM concatenates multi-word
# names: "HomaBay", "TanaRiver", ...).
TOWN_ALIASES: dict[str, str] = {
    # Nairobi metro areas
    "kibera": "nairobi", "kibra": "nairobi", "mathare": "nairobi",
    "eastleigh": "nairobi", "westlands": "nairobi",
    # Nakuru
    "naivasha": "nakuru", "gilgil": "nakuru", "molo": "nakuru",
    # Coast
    "malindi": "kilifi", "watamu": "kilifi", "diani": "kwale",
    "ukunda": "kwale",
    # Northern / ASAL towns
    "lodwar": "turkana", "kakuma": "turkana", "dadaab": "garissa",
    "nanyuki": "laikipia", "maralal": "samburu",
    # Rift / western towns
    "eldoret": "uasingishu", "kitale": "transnzoia", "kapsabet": "nandi",
    "kapenguria": "westpokot", "kilgoris": "narok", "mumias": "kakamega",
    "ahero": "kisumu", "oyugis": "homabay", "kerugoya": "kirinyaga",
    "ol kalou": "nyandarua", "voi": "taitataveta",
    # Spaced forms of GADM concatenated county names
    "homa bay": "homabay", "tana river": "tanariver",
    "taita taveta": "taitataveta", "trans nzoia": "transnzoia",
    "uasin gishu": "uasingishu", "west pokot": "westpokot",
    "elgeyo marakwet": "elgeyo-marakwet", "tharaka nithi": "tharaka-nithi",
    "muranga": "muranga", "murang'a": "muranga",
    # Partial / community names that commonly stand in for the county
    "pokot": "westpokot", "taveta": "taitataveta", "taita": "taitataveta",
    "tharaka": "tharaka-nithi", "marakwet": "elgeyo-marakwet",
    "elgeyo": "elgeyo-marakwet",
}

# Counties whose names appear in datelines and ministry bylines far more
# often than as the place of an event; they lose ties to any other county.
_DATELINE = {"nairobi"}

_FALLBACK_LOC = "Kenya"

# Regional fallback for the Ebola/Marburg watch: when no county is named and
# the text does not mention Kenya, label it with the neighbouring country so
# it stays out of Kenya case counts. "Congo" must not match "Crimean-Congo".
NEIGHBOURS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\buganda"), "Uganda"),
    (re.compile(r"\b(drc|dr congo|(?<!crimean-)(?<!crimean )congo)\b"), "DR Congo"),
    (re.compile(r"\bsouth sudan"), "South Sudan"),
    (re.compile(r"\btanzania"), "Tanzania"),
    (re.compile(r"\bethiopia"), "Ethiopia"),
    (re.compile(r"\bsomalia"), "Somalia"),
    (re.compile(r"\brwanda"), "Rwanda"),
    (re.compile(r"\bburundi"), "Burundi"),
]


async def load_counties(session: AsyncSession) -> list[tuple[str, str]]:
    """All counties as (id, name) — fetched once per ingestion batch."""
    rows = (await session.execute(text("SELECT id, name FROM counties ORDER BY id"))).all()
    return [(r[0], r[1]) for r in rows]


@lru_cache(maxsize=4)
def _place_pattern(counties: tuple[tuple[str, str], ...]) -> tuple[re.Pattern[str], dict[str, tuple[str, str]]]:
    """One word-boundary regex over county names + aliases, longest first,
    plus a lookup from the matched term to (county_id, display name)."""
    terms: dict[str, tuple[str, str]] = {}
    for cid, name in counties:
        terms[name.lower()] = (cid, name)
    for alias, cid in TOWN_ALIASES.items():
        terms.setdefault(alias, (cid, alias.title()))
    alternation = "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True))
    return re.compile(rf"\b({alternation})\b"), terms


async def _county_for_point(
    session: AsyncSession, lat: float, lng: float
) -> str | None:
    """Point-in-polygon: county whose geometry contains (lat, lng)."""
    row = await session.execute(
        text(
            """
            SELECT id FROM counties
            WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
            LIMIT 1
            """
        ),
        {"lat": lat, "lng": lng},
    )
    return row.scalar_one_or_none()


def _resolve_by_name(
    text_lc: str, counties: list[tuple[str, str]]
) -> tuple[str | None, str]:
    """Whole-word match over county names and town aliases.

    The most-mentioned county wins; on a tie, a non-dateline county beats
    Nairobi, then the earliest mention. "avoid" no longer hits Voi and
    "Molotov" no longer hits Molo.
    """
    text_lc = text_lc.replace("\u2019", "'")  # curly apostrophe: Murang’a
    pattern, terms = _place_pattern(tuple(counties))
    hits = list(pattern.finditer(text_lc))
    if hits:
        counts = Counter(terms[m.group(1)][0] for m in hits)
        first_pos = {}
        for m in hits:
            first_pos.setdefault(terms[m.group(1)][0], m.start())
        best = min(
            counts,
            key=lambda cid: (-counts[cid], cid in _DATELINE, first_pos[cid]),
        )
        display = next(terms[m.group(1)][1] for m in hits if terms[m.group(1)][0] == best)
        return best, display
    if "kenya" not in text_lc:
        for pattern, country in NEIGHBOURS:
            if pattern.search(text_lc):
                return None, country
    return None, _FALLBACK_LOC


async def resolve_county(
    session: AsyncSession,
    body: str,
    counties: list[tuple[str, str]],
    lat: float | None = None,
    lng: float | None = None,
) -> tuple[str | None, str]:
    """Resolve a signal to (county_id, loc_name).

    Coordinates win when present; otherwise fall back to name matching.
    """
    if lat is not None and lng is not None:
        cid = await _county_for_point(session, lat, lng)
        if cid:
            name = next((n for i, n in counties if i == cid), cid)
            return cid, name
    return _resolve_by_name(body.lower(), counties)
