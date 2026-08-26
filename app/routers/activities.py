from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import Activity, User, utcnow
from app.schemas import ActivityDetail, ActivityOut, ActivityUpdate

router = APIRouter(prefix="/activities", tags=["activities"])


def _to_out(activity: Activity) -> ActivityOut:
    out = ActivityOut.model_validate(activity)
    out.has_stream = activity.stream is not None
    return out


def _get_owned(db: Session, user: User, activity_id: str) -> Activity:
    activity = db.get(Activity, activity_id)
    if activity is None or activity.user_id != user.id:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


@router.get("", response_model=list[ActivityOut])
def list_activities(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    sport_type: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Activity).where(Activity.user_id == user.id)
    if sport_type:
        stmt = stmt.where(Activity.sport_type == sport_type.lower())
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Activity.name.ilike(pattern),
                Activity.description.ilike(pattern),
                Activity.notes.ilike(pattern),
            )
        )
    stmt = stmt.order_by(Activity.start_time.desc().nullslast(), Activity.created_at.desc())
    rows = db.scalars(stmt.offset((page - 1) * per_page).limit(per_page)).all()
    return [_to_out(a) for a in rows]


@router.get("/{activity_id}", response_model=ActivityDetail)
def get_activity(
    activity_id: str,
    include_stream: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    activity = _get_owned(db, user, activity_id)
    detail = ActivityDetail.model_validate(_to_out(activity))
    if include_stream and activity.stream is not None:
        detail.stream = activity.stream.series
    detail.splits = [
        {
            "index": s.index,
            "kind": s.kind,
            "start_offset_s": s.start_offset_s,
            "duration_s": s.duration_s,
            "distance_m": s.distance_m,
            "avg_speed_ms": s.avg_speed_ms,
            "avg_hr": s.avg_hr,
            "elevation_gain_m": s.elevation_gain_m,
        }
        for s in activity.splits
    ]
    return detail


@router.patch("/{activity_id}", response_model=ActivityOut)
def update_activity(
    activity_id: str,
    payload: ActivityUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    activity = _get_owned(db, user, activity_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(activity, key, value)
    activity.updated_at = utcnow()
    db.commit()
    db.refresh(activity)
    return _to_out(activity)


@router.delete("/{activity_id}", status_code=204)
def delete_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    activity = _get_owned(db, user, activity_id)
    db.delete(activity)
    db.commit()
    return Response(status_code=204)


def _fmt_time(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(tz=None).isoformat()


@router.get("/{activity_id}/export.gpx")
def export_gpx(
    activity_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.services.storage import slugify

    activity = _get_owned(db, user, activity_id)
    series = (activity.stream.series if activity.stream else {}) or {}
    times = series.get("time") or []
    lats = series.get("lat")
    lons = series.get("lon")

    def val(metric: str, i: int):
        arr = series.get(metric)
        if not arr or i >= len(arr):
            return None
        v = arr[i]
        return v

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="LocalTrack" xmlns="http://www.topografix.com/GPX/1/1"',
        ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
        f"<trk><name>{_escape(activity.name or activity_id)}</name><trkseg>",
    ]
    count = 0
    has_any_pos = lats is not None and lons is not None
    for i, t in enumerate(times):
        lat = val("lat", i) if has_any_pos else None
        lon = val("lon", i) if has_any_pos else None
        attrs = ""
        if lat is not None and lon is not None:
            attrs = f'lat="{lat}" lon="{lon}"'
        elif has_any_pos:
            continue
        ele = val("alt", i)
        ele_xml = f"<ele>{ele}</ele>" if ele is not None else ""
        time_iso = (
            datetime.fromtimestamp(float(t), tz=UTC).isoformat().replace("+00:00", "Z")
        )
        hr = val("hr", i)
        cad = val("cad", i)
        ext = ""
        if hr is not None or cad is not None:
            inner = ""
            if hr is not None:
                inner += f"<gpxtpx:hr>{int(hr)}</gpxtpx:hr>"
            if cad is not None:
                inner += f"<gpxtpx:cad>{int(cad)}</gpxtpx:cad>"
            ext = f"<extensions><gpxtpx:TrackPointExtension>{inner}</gpxtpx:TrackPointExtension></extensions>"
        parts.append(f"<trkpt {attrs}>{ele_xml}<time>{time_iso}</time>{ext}</trkpt>")
        count += 1
    parts.append("</trkseg></trk></gpx>")
    if count == 0:
        raise HTTPException(status_code=404, detail="Activity has no track points to export")
    xml = "".join(parts).encode()
    filename = f"{slugify(activity.name or activity.sport_type)}-{activity.id[:8]}.gpx"
    return Response(
        content=xml,
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
