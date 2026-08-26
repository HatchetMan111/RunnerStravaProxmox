import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import Activity, User, utcnow
from app.schemas import (
    OperationResult,
    SyncOperation,
    SyncRequest,
    SyncResponse,
)
from app.services.activity_service import create_activity_from_payload

logger = logging.getLogger("localtrack.sync")

router = APIRouter(prefix="/sync", tags=["sync"])


def _validate_point_ranges(payload) -> str | None:
    for point in payload.points:
        if point.lat is not None and not -90.0 <= point.lat <= 90.0:
            return f"latitude out of range at t={point.t}"
        if point.lon is not None and not -180.0 <= point.lon <= 180.0:
            return f"longitude out of range at t={point.t}"
    return None


@router.post("", response_model=SyncResponse)
def sync(
    request: SyncRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(request.operations) > 200:
        raise HTTPException(status_code=413, detail="Too many operations in one batch (max 200)")
    results: list[OperationResult] = []
    for op in request.operations:
        results.append(_process_operation(db, user, op))
    return SyncResponse(results=results, server_time=utcnow())


def _process_operation(db: Session, user: User, op: SyncOperation) -> OperationResult:
    existing = db.scalars(
        select(Activity).where(Activity.user_id == user.id, Activity.operation_id == op.operation_id)
    ).first()
    if existing is not None:
        return OperationResult(
            operation_id=op.operation_id,
            status="duplicate",
            activity_id=existing.id,
        )

    validation_error = _validate_point_ranges(op.payload)
    if validation_error:
        return OperationResult(
            operation_id=op.operation_id, status="rejected", error=validation_error
        )

    try:
        activity, _series = create_activity_from_payload(
            db,
            user_id=user.id,
            operation_id=op.operation_id,
            client_id=op.client_id,
            payload=op.payload,
            source_file_type="recording",
        )
        db.commit()
        return OperationResult(
            operation_id=op.operation_id,
            status="accepted",
            activity_id=activity.id,
        )
    except (ValueError, OverflowError) as exc:
        db.rollback()
        return OperationResult(operation_id=op.operation_id, status="rejected", error=str(exc))
    except IntegrityError:
        db.rollback()
        winner = db.scalars(
            select(Activity).where(
                Activity.user_id == user.id, Activity.operation_id == op.operation_id
            )
        ).first()
        if winner is not None:
            return OperationResult(
                operation_id=op.operation_id,
                status="duplicate",
                activity_id=winner.id,
            )
        logger.exception("integrity error during sync of operation %s", op.operation_id)
        return OperationResult(
            operation_id=op.operation_id,
            status="rejected",
            error="database constraint violated",
        )
