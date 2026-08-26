import hashlib
import os
from datetime import UTC

from fastapi import APIRouter, Depends, Header, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db
from app.models import Activity, User
from app.routers.activities import _to_out
from app.schemas import ImportResult
from app.services import parsers
from app.services.activity_service import attach_original_file, create_activity_from_payload
from app.services.parsers import ParsedActivity

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("", response_model=ImportResult)
async def import_file(
    file: UploadFile,
    operation_id: str | None = Header(default=None, alias="X-Operation-Id"),
    operation_id_query: str | None = Query(default=None, alias="operation_id"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    settings = get_settings()
    op_id = (operation_id or operation_id_query or "").strip() or None
    if op_id and (len(op_id) < 8 or len(op_id) > 64):
        raise HTTPException(status_code=422, detail="operation_id length must be 8..64")

    data = await file.read()
    if not data:
        return ImportResult(status="rejected", error="empty file")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"file too large ({len(data)} bytes, max {settings.max_upload_bytes})",
        )

    filename = os.path.basename(file.filename or "upload")
    fmt = parsers.detect_format(data, filename)

    if op_id:
        existing_by_op = db.scalars(
            select(Activity).where(Activity.user_id == user.id, Activity.operation_id == op_id)
        ).first()
        if existing_by_op is not None:
            return ImportResult(status="duplicate_file", activity_id=existing_by_op.id)

    file_hash = hashlib.sha256(data).hexdigest()
    existing_by_hash = db.scalars(
        select(Activity).where(
            Activity.user_id == user.id, Activity.source_file_sha256 == file_hash
        )
    ).first()
    if existing_by_hash is not None:
        return ImportResult(status="duplicate_file", activity_id=existing_by_hash.id)

    try:
        parsed = _parse_or_raise(data, filename, fmt)
        payload = _payload_from_parsed(parsed)
    except ValueError as exc:
        return ImportResult(status="rejected", error=str(exc))

    activity, _series = create_activity_from_payload(
        db,
        user_id=user.id,
        operation_id=op_id,
        client_id=None,
        payload=payload,
        source_file_type=fmt or "unknown",
        source_file_sha256=file_hash,
        original_filename=filename,
        raw_size=len(data),
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    attach_original_file(db, settings.data_dir, activity, data, filename, fmt or "bin")
    db.refresh(activity)
    return ImportResult(status="imported", activity=_to_out(activity))


def _parse_or_raise(data: bytes, filename: str, fmt: str | None) -> ParsedActivity:
    result = parsers.parse_any(data, filename)
    if not result.points:
        raise ValueError("file contains no track points")
    return result


def _payload_from_parsed(parsed: ParsedActivity):
    from datetime import datetime

    from app.schemas import ActivityCreatePayload, TrackPoint

    points = [
        TrackPoint(
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
        for p in parsed.points
    ]
    started_at = None
    if points:
        started_at = datetime.fromtimestamp(points[0].t, tz=UTC)
    return ActivityCreatePayload(
        sport_type=parsed.sport_hint or "other",
        name=(parsed.name_hint or "")[:200],
        device_name=parsed.device_hint,
        started_at=started_at,
        points=points,
    )
