"""Assert-based checks for the keyword classifier and the county geocoder.

Run either way:
    cd backend && python -m tests.test_classify
    cd backend && python -m pytest tests

No DB needed: only the pure functions are exercised.
"""

from app.geo.classify import _parse_tweet_date, detect_disease, detect_severity
from app.geo.geocode import _resolve_by_name

# A stand-in for the `counties` table: (id, GADM name).
COUNTIES = [
    ("nairobi", "Nairobi"), ("garissa", "Garissa"), ("nakuru", "Nakuru"),
    ("taitataveta", "TaitaTaveta"), ("muranga", "Murang'a"),
    ("baringo", "Baringo"), ("westpokot", "WestPokot"),
]


def test_geocode_word_boundaries():
    assert _resolve_by_name("farmers told to avoid carcasses", COUNTIES) == (None, "Kenya")
    assert _resolve_by_name("molotov attack on a shop", COUNTIES) == (None, "Kenya")
    assert _resolve_by_name("cattle deaths reported in voi", COUNTIES) == ("taitataveta", "Voi")
    assert _resolve_by_name("livestock dying near molo town", COUNTIES) == ("nakuru", "Molo")


def test_geocode_aliases_and_apostrophes():
    assert _resolve_by_name("anthrax scare in pokot", COUNTIES)[0] == "westpokot"
    assert _resolve_by_name("rabies cases in taveta", COUNTIES)[0] == "taitataveta"
    assert _resolve_by_name("dog bites in murang’a county", COUNTIES)[0] == "muranga"
    assert _resolve_by_name("goats dying in taita taveta", COUNTIES)[0] == "taitataveta"


def test_geocode_two_counties_prefers_most_mentioned_then_non_dateline():
    # Nairobi dateline, event in Garissa.
    assert _resolve_by_name("nairobi: rvf suspected in garissa", COUNTIES)[0] == "garissa"
    # Two mentions beat one.
    assert _resolve_by_name("baringo county says baringo herders lost goats; nakuru vets sent", COUNTIES)[0] == "baringo"
    # Only Nairobi named -> Nairobi.
    assert _resolve_by_name("dog bite cases rise in nairobi", COUNTIES) == ("nairobi", "Nairobi")


def test_geocode_neighbour_fallback():
    assert _resolve_by_name("uganda confirms new ebola cases", COUNTIES) == (None, "Uganda")
    assert _resolve_by_name("crimean-congo fever reported", COUNTIES) == (None, "Kenya")


def test_severity_negation_and_substrings():
    assert detect_severity("kenya declared free of rift valley fever") == "LOW"
    assert detect_severity("no new ebola cases reported in kenya") == "LOW"
    assert detect_severity("anthrax ruled out after cattle deaths") == "LOW"
    assert detect_severity("vaccination deadline extended for farmers") == "LOW"   # "dead" in "deadline"
    assert detect_severity("velvet goods market reopens") == "LOW"                 # "vet" in "velvet"


def test_severity_tiers():
    assert detect_severity("kenya flagged as high risk of rvf outbreak") == "HIGH"      # outbreak alone
    assert detect_severity("ministry confirms anthrax outbreak in isiolo") == "CRITICAL"  # confirms + outbreak
    assert detect_severity("mass livestock death in baringo") == "CRITICAL"
    assert detect_severity("several cows dying suddenly, vet called") == "HIGH"
    assert detect_severity("rabies alert as dog bites rise") == "MEDIUM"
    assert detect_severity("new abattoir opens in nakuru") == "LOW"


def test_disease_detection_unchanged():
    assert detect_disease("suspected rvf after abortion storm")[0] == "Rift Valley Fever"
    assert detect_disease("uganda ebola outbreak")[0] == "Ebola"
    assert detect_disease("market prices fall") == (None, 0)


def test_tweet_date_formats():
    assert _parse_tweet_date("2024-12-12T21:39:29.000Z") == "2024-12-12T21:39:29+00:00"
    assert _parse_tweet_date("Thu Dec 12 21:39:29 +0000 2024") == "2024-12-12T21:39:29+00:00"
    assert _parse_tweet_date("garbage").startswith("20")  # falls back to now, never raises


if __name__ == "__main__":
    import sys
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"OK: {len(tests)} test functions passed", file=sys.stderr)
