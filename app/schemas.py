from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class TrackPoint(BaseModel):
    t: float = Field(..., description="seconds since epoch UTC")
    lat: float | None = None
    lon: float | None = None
    alt: float | None = None
    hr: float | None = None
    cad: float | None = None
    power: float | None = None
    speed: float | None = None
    temp: float | None = None


class ActivityCreatePayload(BaseModel):
    sport_type: str = "other"
    name: str = ""
    description: str = ""
    notes: str = ""
    timezone_name: str | None = None
    device_name: str | None = None
    started_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    points: list[TrackPoint] = Field(default_factory=list)

    @field_validator("sport_type")
    @classmethod
    def _check_sport(cls, v: str) -> str:
        if len(v) > 32:
            raise ValueError("sport_type too long")
        return v.lower()


class SyncOperation(BaseModel):
    operation_id: str = Field(..., min_length=8, max_length=64)
    kind: Literal["activity.create"] = "activity.create"
    client_id: str | None = None
    payload: ActivityCreatePayload


class SyncRequest(BaseModel):
    operations: list[SyncOperation]


class OperationResult(BaseModel):
    operation_id: str
    status: Literal["accepted", "duplicate", "rejected"]
    activity_id: str | None = None
    error: str | None = None


class SyncResponse(BaseModel):
    results: list[OperationResult]
    server_time: datetime


class ActivityOut(BaseModel):
    id: str
    sport_type: str
    name: str
    description: str
    notes: str
    visibility: str
    start_time: datetime | None = None
    timezone_name: str | None = None
    distance_m: float
    moving_time_s: float
    elapsed_time_s: float
    avg_speed_ms: float | None = None
    max_speed_ms: float | None = None
    elevation_gain_m: float | None = None
    elevation_loss_m: float | None = None
    avg_hr: float | None = None
    max_hr: float | None = None
    avg_cadence: float | None = None
    avg_power: float | None = None
    calories: float | None = None
    device_name: str | None = None
    source_file_type: str | None = None
    original_filename: str | None = None
    tags: Any = None
    extra: Any = None
    created_at: datetime
    has_stream: bool = False

    class Config:
        from_attributes = True


class ActivityDetail(ActivityOut):
    stream: dict | None = None
    splits: list[dict] = []


class ActivityUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    notes: str | None = None
    visibility: Literal["private", "local", "shared"] | None = None
    sport_type: str | None = None
    tags: list[str] | None = None


class ImportResult(BaseModel):
    status: Literal["imported", "duplicate_file", "rejected"]
    activity: ActivityOut | None = None
    activity_id: str | None = None
    error: str | None = None


class TokenResponse(BaseModel):
    token: str
    username: str


class MeResponse(BaseModel):
    username: str
