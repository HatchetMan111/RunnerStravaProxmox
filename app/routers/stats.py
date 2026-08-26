from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import Activity, Split, User

router = APIRouter(prefix="/stats", tags=["stats"])

PR_DISTANCES_M = {
    1000: ("1 km", 950, 1050),
    5000: ("5 km", 4800, 5150),
    10000: ("10 km", 9600, 10400),
}


@router.get("/overview")
def overview(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Activity).where(Activity.user_id == user.id)
    activities = db.scalars(stmt).all()

    totals = {"count": len(activities), "distance_m": 0.0, "moving_time_s": 0.0, "elevation_gain_m": 0.0}
    by_sport: dict[str, dict] = defaultdict(lambda: {"count": 0, "distance_m": 0.0, "moving_time_s": 0.0})
    weekly: dict[str, dict] = defaultdict(lambda: {"count": 0, "distance_m": 0.0, "moving_time_s": 0.0})
    monthly: dict[str, dict] = defaultdict(lambda: {"count": 0, "distance_m": 0.0, "moving_time_s": 0.0})

    now = datetime.now(UTC)
    week_cut = now - timedelta(weeks=12)
    month_cut = now - timedelta(days=365)

    for a in activities:
        dist = a.distance_m or 0.0
        time_s = a.moving_time_s or 0.0
        totals["distance_m"] += dist
        totals["moving_time_s"] += time_s
        totals["elevation_gain_m"] += a.elevation_gain_m or 0.0
        sport = by_sport[a.sport_type]
        sport["count"] += 1
        sport["distance_m"] += dist
        sport["moving_time_s"] += time_s
        if a.start_time:
            start = a.start_time if a.start_time.tzinfo else a.start_time.replace(tzinfo=UTC)
            epoch = start.timestamp()
            week_start = start - timedelta(days=start.weekday())
            week_key = week_start.date().isoformat()
            if start >= week_cut:
                bucket = weekly[week_key]
                bucket["count"] += 1
                bucket["distance_m"] += dist
                bucket["moving_time_s"] += time_s
            month_key = start.strftime("%Y-%m")
            if start >= month_cut:
                bucket = monthly[month_key]
                bucket["count"] += 1
                bucket["distance_m"] += dist
                bucket["moving_time_s"] += time_s
            del epoch

    records = _personal_records(db, user)

    return {
        "totals": {
            "count": totals["count"],
            "distance_m": round(totals["distance_m"], 1),
            "moving_time_s": round(totals["moving_time_s"], 1),
            "elevation_gain_m": round(totals["elevation_gain_m"], 1),
        },
        "by_sport": {k: v for k, v in sorted(by_sport.items())},
        "weekly_last_12": [
            {"week_start": k, **weekly[k]} for k in sorted(weekly.keys())[-12:]
        ],
        "monthly_last_12": [
            {"month": k, **monthly[k]} for k in sorted(monthly.keys())[-12:]
        ],
        "records": records,
    }


def _personal_records(db: Session, user: User) -> dict:
    out: dict[str, dict | None] = {}
    run_types = ("running", "treadmill", "walking", "hiking", "trail_running")

    best_1k = (
        db.execute(
            select(Split, Activity)
            .join(Activity, Split.activity_id == Activity.id)
            .where(
                Activity.user_id == user.id,
                Activity.sport_type.in_(run_types),
                Split.kind == "km",
                Split.index == 1,
            )
        )
        .all()
    )
    fastest = None
    for split, activity in best_1k:
        if split.duration_s and (fastest is None or split.duration_s < fastest[0]):
            fastest = (split.duration_s, activity)
    out["fastest_1km_split"] = _record_entry(fastest)

    for key, (_label, lo, hi) in PR_DISTANCES_M.items():
        if key == 1000:
            continue
        candidates = db.scalars(
            select(Activity).where(
                Activity.user_id == user.id,
                Activity.sport_type.in_(run_types),
                Activity.distance_m >= lo,
                Activity.distance_m <= hi,
                Activity.moving_time_s > 0,
            )
        ).all()
        best = None
        for activity in candidates:
            if best is None or activity.moving_time_s < best[0]:
                best = (activity.moving_time_s, activity)
        out[f"best_{key // 1000}km_activity"] = _record_entry(best)

    return out


def _record_entry(pair) -> dict | None:
    if pair is None:
        return None
    duration, activity = pair
    return {
        "duration_s": round(duration, 1),
        "activity_id": activity.id,
        "name": activity.name,
        "start_time": activity.start_time.isoformat() if activity.start_time else None,
    }
