"""Re-run severity and county resolution over every stored signal.

    docker compose exec backend python -m scripts.reclassify

Idempotent. Use after changing the classifier or geocoder so historical
rows follow the same rules as new ones (the dashboard's alert level is
driven by CRITICAL counts). Disease labels are left alone. Prints a
before/after severity breakdown; nothing else is touched.
"""

import asyncio
from collections import Counter

from sqlalchemy import text

from app.db.session import async_session_maker, engine
from app.geo.classify import detect_severity, escalate_filovirus
from app.geo.geocode import load_counties, resolve_county


async def main() -> None:
    async with async_session_maker() as session:
        counties = await load_counties(session)
        rows = (
            await session.execute(
                text("SELECT id, text, disease, severity, county_id, loc_name FROM signals")
            )
        ).mappings().all()

        before = Counter(r["severity"] for r in rows)
        after: Counter = Counter()
        changed = 0
        for r in rows:
            lc = r["text"].lower()
            # Coordinates were never stored, so name matching is the only tier.
            county_id, loc_name = await resolve_county(session, r["text"], counties)
            severity = escalate_filovirus(
                r["disease"], detect_severity(lc), lc,
                in_kenya=county_id is not None or loc_name == "Kenya",
            )
            after[severity] += 1
            if (severity, county_id, loc_name) != (r["severity"], r["county_id"], r["loc_name"]):
                changed += 1
                await session.execute(
                    text(
                        "UPDATE signals SET severity = :sev, county_id = :cid, loc_name = :loc "
                        "WHERE id = :id"
                    ),
                    {"sev": severity, "cid": county_id, "loc": loc_name, "id": r["id"]},
                )
        await session.commit()
    await engine.dispose()
    print(f"{len(rows)} signals, {changed} updated")
    print("before:", dict(before))
    print("after: ", dict(after))


if __name__ == "__main__":
    asyncio.run(main())
