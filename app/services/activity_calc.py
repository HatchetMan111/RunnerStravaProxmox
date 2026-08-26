from datetime import UTC
from typing import Any

from app.schemas import ActivityCreatePayload
from app.services.geo import (
    GeoPoint,
    avg_of,
    compute_splits,
    cumulative_distances,
    elevation_gain_loss,
    max_of,
    moving_time_s,
    segment_speeds,
    serialize_series,
)


def points_from_payload(payload: ActivityCreatePayload) -> list[GeoPoint]:
    return [
        GeoPoint(
            t=p.t,
            lat=p.lat,
            lon=p.lon,
            alt=p.alt,
            hr=p.hr,
            cad=p.cad,
            power=p.power,
            speed=p.speed,
            temp=p.temp,
        )
        for p in payload.points
    ]


def build_activity_fields(payload: ActivityCreatePayload) -> dict[str, Any]:
    points = points_from_payload(payload)
    if not points:
        raise ValueError("activity requires at least one point")
    ordered = sorted(points, key=lambda p: p.t)
    cumdist = cumulative_distances(ordered)
    speeds = segment_speeds(ordered, cumdist)
    altitudes = [p.alt for p in ordered]
    gain, loss = elevation_gain_loss(altitudes)
    has_altitude = any(a is not None for a in altitudes)

    elapsed = round(ordered[-1].t - ordered[0].t, 1) if len(ordered) > 1 else 0.0
    moving = moving_time_s(ordered, cumdist)
    distance = round(cumdist[-1], 2)

    fields: dict[str, Any] = {
        "sport_type": payload.sport_type or "other",
        "name": (payload.name or "").strip()[:200],
        "description": payload.description or "",
        "notes": payload.notes or "",
        "timezone_name": payload.timezone_name,
        "device_name": payload.device_name,
        "start_time": payload.started_at.isoformat() if payload.started_at else None,
        "distance_m": distance,
        "moving_time_s": moving,
        "elapsed_time_s": elapsed,
        "avg_speed_ms": round(distance / moving, 3) if moving and moving > 0 else None,
        "max_speed_ms": max_of(speeds),
        "elevation_gain_m": gain if has_altitude else None,
        "elevation_loss_m": loss if has_altitude else None,
        "avg_hr": avg_of([p.hr for p in ordered]),
        "max_hr": max_of([p.hr for p in ordered]),
        "avg_cadence": avg_of([p.cad for p in ordered]),
        "avg_power": avg_of([p.power for p in ordered]),
        "tags": payload.tags or [],
        "extra": {},
    }
    series = serialize_series(ordered, cumdist)
    splits = compute_splits(ordered, cumdist, unit_m=1000.0)
    return {"fields": fields, "series": series, "splits": splits}


def start_datetime(fields: dict[str, Any], series: dict[str, list]):
    from datetime import datetime

    value = fields.get("start_time")
    parsed: datetime | None = None
    if value:
        if isinstance(value, str):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            parsed = value
    elif series.get("time"):
        parsed = datetime.fromtimestamp(series["time"][0], tz=UTC)
    if parsed is None:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def pace_label(speed_ms: float | None) -> str | None:
    if not speed_ms or speed_ms <= 0:
        return None
    sec_per_km = 1000.0 / speed_ms
    minutes = int(sec_per_km // 60)
    seconds = int(round(sec_per_km % 60))
    if seconds == 60:
        minutes += 1
        seconds = 0
    return f"{minutes}:{seconds:02d}"


def duration_label(seconds: float | None) -> str:
    if not seconds:
        return "-"
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
