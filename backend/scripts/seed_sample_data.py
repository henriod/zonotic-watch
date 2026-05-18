"""Seed sample data into the DB so the read endpoints return rows before
live ingestion exists.

    docker compose exec backend python -m scripts.seed_sample_data

Transcribed from src/data/surveillance.js (SIGNALS + COUNTIES). Idempotent
(ON CONFLICT upsert). The per-county risk / case figures are seed-only and
get replaced by computed values in Phase 2 (rollout step 9).
"""

import asyncio
import json
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from app.db.session import async_session_maker, engine

# COUNTIES seed — (id, risk, human, animal, disease, temp, humidity, rain).
COUNTIES = [
    ("nairobi", 0.80, 23, 8, "Rabies", 22, 65, 28),
    ("mombasa", 0.53, 12, 4, "Q Fever", 30, 80, 18),
    ("kisumu", 0.74, 18, 15, "Brucellosis", 26, 82, 62),
    ("nakuru", 0.48, 9, 6, "RVF", 20, 70, 35),
    ("baringo", 0.93, 14, 22, "RVF", 32, 78, 45),
    ("turkana", 0.36, 5, 12, "Anthrax", 36, 28, 8),
    ("garissa", 0.65, 7, 18, "RVF", 38, 45, 15),
    ("marsabit", 0.29, 2, 7, "Anthrax", 25, 40, 12),
    ("isiolo", 0.46, 3, 9, "Anthrax", 29, 52, 20),
    ("mandera", 0.44, 6, 11, "Brucellosis", 40, 22, 5),
    ("wajir", 0.51, 8, 14, "RVF", 37, 30, 10),
    ("kakamega", 0.41, 6, 8, "Brucellosis", 24, 78, 55),
    ("kitui", 0.34, 4, 5, "Q Fever", 28, 55, 22),
    ("machakos", 0.52, 10, 3, "Rabies", 25, 62, 30),
]

# SIGNALS seed — (n, src, handle, text, county_id, disease, conf, mins_ago, sev).
SIGNALS = [
    (1, "X/Twitter", "@KisumulFarmer",
     "Several cows dying suddenly around Lake Victoria shores, vet says suspicious. #Kenya #livestock",
     "kisumu", "Rift Valley Fever", 0.82, 2, "HIGH"),
    (2, "X/Twitter", "@BaringoNews",
     "Mass livestock death in Baringo. County govt rushed vet teams. Residents afraid of contact with carcasses.",
     "baringo", "RVF / Anthrax", 0.91, 8, "CRITICAL"),
    (3, "News API", "Daily Nation",
     "KVS reports suspected anthrax outbreak in Isiolo pastoralist community — herders told to avoid carcasses.",
     "isiolo", "Anthrax", 0.88, 15, "HIGH"),
    (4, "X/Twitter", "@NairobiHealth",
     "Increasing dog bite cases in Kibera, Mathare settlements. Residents reporting unprovoked attacks this week.",
     "nairobi", "Rabies", 0.72, 22, "MEDIUM"),
    (5, "X/Twitter", "@GarissaCounty",
     "Goat herders in Garissa reporting cluster of spontaneous abortions in their flocks this week. No vet yet.",
     "garissa", "Rift Valley Fever", 0.77, 31, "HIGH"),
    (6, "Reddit", "r/Kenya",
     "Anyone in Wajir area noticed weird animal deaths? Camels and goats dropping for no obvious reason past 3 days.",
     "wajir", "RVF / Unknown", 0.55, 48, "MEDIUM"),
    (7, "News API", "KBC News",
     "Ministry of Health confirms 3 human cases with hemorrhagic fever symptoms in Baringo — investigations ongoing.",
     "baringo", "Rift Valley Fever", 0.95, 60, "CRITICAL"),
]

UPSERT_SIGNAL = text(
    """
    INSERT INTO signals
        (id, src, handle, text, disease, severity, confidence,
         county_id, loc_name, event_time)
    VALUES
        (:id, :src, :handle, :text, :disease, :severity, :confidence,
         :county_id, :loc_name, :event_time)
    ON CONFLICT (id) DO UPDATE SET
        src = EXCLUDED.src, handle = EXCLUDED.handle, text = EXCLUDED.text,
        disease = EXCLUDED.disease, severity = EXCLUDED.severity,
        confidence = EXCLUDED.confidence, county_id = EXCLUDED.county_id,
        loc_name = EXCLUDED.loc_name, event_time = EXCLUDED.event_time
    """
)

UPSERT_RISK = text(
    """
    INSERT INTO county_risk (county_id, week_start, risk, method, computed_at)
    VALUES (:county_id, :week_start, :risk, 'seed', :computed_at)
    ON CONFLICT (county_id, week_start) DO UPDATE SET
        risk = EXCLUDED.risk, method = EXCLUDED.method,
        computed_at = EXCLUDED.computed_at
    """
)

UPSERT_FEATURES = text(
    """
    INSERT INTO county_week_features
        (county_id, week_start, signal_count, human_cases, animal_cases,
         disease_breakdown, weather_temp, weather_humidity, weather_rain)
    VALUES
        (:county_id, :week_start, :signal_count, :human, :animal,
         CAST(:breakdown AS jsonb), :temp, :humidity, :rain)
    ON CONFLICT (county_id, week_start) DO UPDATE SET
        signal_count = EXCLUDED.signal_count,
        human_cases = EXCLUDED.human_cases,
        animal_cases = EXCLUDED.animal_cases,
        disease_breakdown = EXCLUDED.disease_breakdown,
        weather_temp = EXCLUDED.weather_temp,
        weather_humidity = EXCLUDED.weather_humidity,
        weather_rain = EXCLUDED.weather_rain
    """
)


async def main() -> None:
    now = datetime.now(timezone.utc)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())  # ISO week Monday

    async with async_session_maker() as session:
        # Counties must already be loaded (scripts/load_counties.py).
        loaded = {
            r[0]
            for r in (await session.execute(text("SELECT id FROM counties"))).all()
        }
        missing = {c[0] for c in COUNTIES} - loaded
        if missing:
            print(f"ERROR: counties not loaded: {sorted(missing)}")
            print("Run `python -m scripts.load_counties` first.")
            sys.exit(1)

        for n, src, handle, body, county_id, disease, conf, mins, sev in SIGNALS:
            await session.execute(
                UPSERT_SIGNAL,
                {
                    "id": f"seed-{n}",
                    "src": src,
                    "handle": handle,
                    "text": body,
                    "disease": disease,
                    "severity": sev,
                    "confidence": conf,
                    "county_id": county_id,
                    "loc_name": county_id.title(),
                    "event_time": now - timedelta(minutes=mins),
                },
            )

        for cid, risk, human, animal, disease, temp, humidity, rain in COUNTIES:
            await session.execute(
                UPSERT_RISK,
                {
                    "county_id": cid,
                    "week_start": week_start,
                    "risk": risk,
                    "computed_at": now,
                },
            )
            await session.execute(
                UPSERT_FEATURES,
                {
                    "county_id": cid,
                    "week_start": week_start,
                    "signal_count": None,
                    "human": human,
                    "animal": animal,
                    "breakdown": json.dumps({disease: human + animal}),
                    "temp": temp,
                    "humidity": humidity,
                    "rain": rain,
                },
            )
        await session.commit()

        signals_n = (
            await session.execute(text("SELECT count(*) FROM signals"))
        ).scalar_one()
        risk_n = (
            await session.execute(text("SELECT count(*) FROM county_risk"))
        ).scalar_one()
        feat_n = (
            await session.execute(text("SELECT count(*) FROM county_week_features"))
        ).scalar_one()
    await engine.dispose()

    print(f"seeded: signals={signals_n}  county_risk={risk_n}  "
          f"county_week_features={feat_n}  (week_start={week_start})")
    if signals_n < len(SIGNALS) or risk_n < len(COUNTIES) or feat_n < len(COUNTIES):
        print("  ERROR: row counts below expected.")
        sys.exit(1)
    print("OK — sample data seeded.")


if __name__ == "__main__":
    asyncio.run(main())
