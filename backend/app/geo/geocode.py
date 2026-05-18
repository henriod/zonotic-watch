"""County resolution — maps a signal to a county (replaces detectCounty()).

Two tiers, per docs/backend-plan.md section 3:
  1. point-in-polygon, when the source carries coordinates;
  2. place-name matching against the 47 GADM county names plus a curated
     town/area alias map.

Fallback is `(None, "Kenya")` — same semantics as the frontend's "Kenya"
default, but now spatially correct whenever location data exists.
"""

from __future__ import annotations

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
}

_FALLBACK_LOC = "Kenya"


async def load_counties(session: AsyncSession) -> list[tuple[str, str]]:
    """All counties as (id, name) — fetched once per ingestion batch."""
    rows = (await session.execute(text("SELECT id, name FROM counties"))).all()
    return [(r[0], r[1]) for r in rows]


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
    """Substring-match county names, then the town alias map."""
    for cid, name in counties:
        if name.lower() in text_lc:
            return cid, name
    for alias, cid in TOWN_ALIASES.items():
        if alias in text_lc:
            return cid, alias.title()
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
