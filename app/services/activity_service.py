from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import Activity, ActivityStream, Split
from app.schemas import ActivityCreatePayload, TrackPoint
from app.services import storage
from app.services.activity_calc import build_activity_fields, start_datetime


def create_activity_from_payload(
    db: Session,
    user_id: int,
    operation_id: str | None,
    client_id: str | None,
    payload: ActivityCreatePayload,
    *,
    source_file_type: str | None = None,
    source_file_sha256: str | None = None,
    original_filename: str | None = None,
    raw_size: int | None = None,
) -> tuple[Activity, dict[str, list]]:
    computed = build_activity_fields(payload)
    fields = computed["fields"]
    series = computed["series"]
    splits = computed["splits"]

    activity = Activity(
        user_id=user_id,
        client_id=client_id,
        operation_id=operation_id,
        source_file_type=source_file_type,
        source_file_sha256=source_file_sha256,
        original_filename=original_filename[:255] if original_filename else None,
        raw_size=raw_size,
        start_time=start_datetime(fields, series),
        **{k: v for k, v in fields.items() if k != "start_time"},
    )
    db.add(activity)
    db.flush()

    db.add(ActivityStream(activity_id=activity.id, series=series))
    for split in splits:
        db.add(Split(activity_id=activity.id, **split))

    if not activity.name:
        dt = activity.start_time or datetime.now(UTC)
        activity.name = default_name(activity.sport_type, dt)

    return activity, series


def attach_original_file(db: Session, data_dir, activity: Activity, data: bytes, filename: str, fmt: str) -> None:
    raw_path = storage.save_original(data_dir, activity.id, data, filename, fmt)
    activity.raw_path = raw_path
    db.commit()


def default_name(sport_type: str, start: datetime) -> str:
    label = SPORT_LABELS.get(sport_type, "Aktivität")
    return f"{label} {start.strftime('%d.%m.%Y')}"


SPORT_LABELS: dict[str, str] = {
    "running": "Lauf",
    "treadmill": "Laufband",
    "cycling": "Radfahrt",
    "walking": "Spaziergang",
    "hiking": "Wanderung",
    "swimming": "Schwimmen",
    "other": "Aktivität",
}


def payload_from_track_points(points: list[dict[str, Any]], **meta: Any) -> ActivityCreatePayload:
    return ActivityCreatePayload(
        points=[TrackPoint(**p) for p in points],
        **meta,
    )
