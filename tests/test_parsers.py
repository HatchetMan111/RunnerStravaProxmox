from datetime import UTC, datetime

import pytest

from app.services import parsers
from tests.helpers.fit_writer import FitBuilder, build_fit_activity
from tests.helpers.sample_data import points_to_gpx, points_to_tcx, sample_points


def test_detect_format_gpx():
    assert parsers.detect_format(points_to_gpx(sample_points(10)), "run.gpx") == "gpx"


def test_detect_format_fit_magic():
    data = build_fit_activity(datetime.now(UTC), n_records=5)
    assert parsers.detect_format(data) == "fit"
    assert parsers.detect_format(data, "unknown.bin") == "fit"


def test_parse_gpx_full():
    points = sample_points(60)
    parsed = parsers.parse_any(points_to_gpx(points), "run.gpx")
    assert len(parsed.points) == 60
    assert parsed.name_hint == "Morgentraining"
    first = parsed.points[0]
    assert abs(first.lat - points[0]["lat"]) < 1e-6
    assert abs(first.t - points[0]["t"]) < 0.001
    hrs = [p.hr for p in parsed.points if p.hr is not None]
    assert len(hrs) > 50


def test_parse_gpx_invalid():
    with pytest.raises(ValueError):
        parsers.parse_any(b"<gpx><trk>", "broken.gpx")


def test_parse_tcx_full():
    points = sample_points(80)
    parsed = parsers.parse_any(points_to_tcx(points), "run.tcx")
    assert len(parsed.points) == 80
    assert parsed.sport_hint == "running"
    cads = [p.cad for p in parsed.points if p.cad is not None]
    assert cads and all(c == 88 for c in cads)


def test_parse_tcx_no_activities_rejected():
    bad = b'<?xml version="1.0"?><TrainingCenterDatabase></TrainingCenterDatabase>'
    with pytest.raises(ValueError):
        parsers.parse_any(bad, "empty.tcx")


START = datetime(2026, 4, 10, 8, 0, tzinfo=UTC)


def test_parse_fit_roundtrip():
    data = build_fit_activity(
        START,
        n_records=90,
        step_s=2.0,
        speed_ms=3.5,
        base_alt=120.0,
        sport_value=11,
        include_hr=True,
    )
    parsed = parsers.parse_any(data, "ride.fit")
    assert len(parsed.points) == 90
    pts = parsed.points
    assert all(p.lat is not None and p.lon is not None for p in pts)
    assert abs(pts[0].lat - 52.52) < 1e-6
    alts = [p.alt for p in pts if p.alt is not None]
    assert alts and abs(alts[0] - 122.0) < 3
    hrs = [p.hr for p in pts if p.hr is not None]
    assert len(hrs) == 90
    dt = datetime.fromtimestamp(pts[0].t, tz=UTC)
    assert abs((dt - START).total_seconds()) < 2


def test_parse_fit_truncated_cleanly_rejected():
    good = build_fit_activity(START, n_records=20)
    truncated = good[: len(good) // 2]
    with pytest.raises(ValueError):
        parsers.parse_any(truncated, "broken.fit")


def test_parse_fit_garbage_rejected():
    with pytest.raises(ValueError):
        parsers.parse_any(b"\x00\x01\x02garbage-not-a-fit-file", "x.fit")


def test_parse_fit_without_positions():
    import struct
    from datetime import datetime as dt

    from tests.helpers.fit_writer import (
        TYPE_UINT8,
        TYPE_UINT32,
        _data,
        _definition,
        fit_timestamp,
    )

    builder = FitBuilder()
    builder.file_id(START)
    builder.record_definition(include_position=False, include_hr=True, include_alt=False)
    record_fields = [(253, 4, TYPE_UINT32), (3, 1, TYPE_UINT8)]
    builder.messages.append(_definition(1, 20, record_fields))
    for i in range(30):
        ts = fit_timestamp(dt.fromtimestamp(START.timestamp() + i, tz=UTC))
        builder.messages.append(
            _data(1, struct.pack("<I", ts) + bytes([150]))
        )
    parsed = parsers.parse_any(builder.build(), "indoor.fit")
    assert len(parsed.points) == 30
    assert all(p.lat is None for p in parsed.points)


def test_unsupported_format_rejected():
    with pytest.raises(ValueError):
        parsers.parse_any(b"just some text", "notes.txt")
