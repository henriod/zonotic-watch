"""Signal response schema — mirrors the frontend signal object.

The DB stores an absolute `event_time`; `time` is a computed relative
label ("2m", "3h", "1d") so a naive frontend swap keeps working.
"""

from datetime import datetime, timezone

from pydantic import BaseModel, computed_field


def relative_time(ts: datetime) -> str:
    """Absolute timestamp -> short relative label, matching the seed feed."""
    now = datetime.now(timezone.utc)
    secs = max(0, int((now - ts).total_seconds()))
    if secs < 60:
        return "now"
    mins = secs // 60
    if mins < 60:
        return f"{mins}m"
    hours = mins // 60
    if hours < 24:
        return f"{hours}h"
    return f"{hours // 24}d"


class SignalOut(BaseModel):
    """One signal feed row. Field names match `src/lib/signals.js` output."""

    id: str
    src: str
    handle: str | None = None
    text: str
    loc: str | None = None
    disease: str | None = None
    conf: float | None = None
    sev: str | None = None
    county_id: str | None = None
    event_time: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def time(self) -> str:
        return relative_time(self.event_time)

    @classmethod
    def from_signal(cls, s) -> "SignalOut":
        """Build from an ORM `Signal` row (DB column names differ)."""
        return cls(
            id=s.id,
            src=s.src,
            handle=s.handle,
            text=s.text,
            loc=s.loc_name,
            disease=s.disease,
            conf=s.confidence,
            sev=s.severity,
            county_id=s.county_id,
            event_time=s.event_time,
        )
