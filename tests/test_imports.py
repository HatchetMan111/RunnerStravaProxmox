from datetime import UTC, datetime

from tests.helpers.fit_writer import build_fit_activity
from tests.helpers.sample_data import points_to_gpx, points_to_tcx, sample_points

FIT_START = datetime(2026, 3, 20, 9, 0, tzinfo=UTC)


def upload(client, headers, data, filename, op_id=None):
    params = {}
    headers_full = dict(headers)
    if op_id:
        headers_full["X-Operation-Id"] = op_id
    return client.post(
        "/api/v1/imports",
        files={"file": (filename, data, "application/octet-stream")},
        headers=headers_full,
        params=params,
    )


def test_import_gpx_creates_activity_and_stores_original(app_ctx, auth_headers):
    client, data_dir = app_ctx["client"], app_ctx["data_dir"]
    gpx = points_to_gpx(sample_points(100))
    resp = upload(client, auth_headers, gpx, "morgenlauf.gpx", op_id="imp-op-gpx-0000001")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "imported"
    activity = body["activity"]
    assert activity["source_file_type"] == "gpx"
    assert activity["original_filename"] == "morgenlauf.gpx"
    assert activity["distance_m"] > 100

    originals = list((data_dir / "originals").glob("*"))
    assert len(originals) == 1
    assert originals[0].read_bytes() == gpx


def test_import_same_bytes_is_duplicate_by_hash(app_ctx, auth_headers):
    client = app_ctx["client"]
    gpx = points_to_gpx(sample_points(40))
    first = upload(client, auth_headers, gpx, "a.gpx")
    second = upload(client, auth_headers, gpx, "b.gpx")
    assert first.json()["status"] == "imported"
    assert second.json()["status"] == "duplicate_file"
    assert second.json()["activity_id"] == first.json()["activity"]["id"]


def test_import_retry_with_same_operation_id_is_idempotent(app_ctx, auth_headers):
    client = app_ctx["client"]
    gpx1 = points_to_gpx(sample_points(30))
    gpx2 = points_to_gpx(sample_points(31))
    r1 = upload(client, auth_headers, gpx1, "run.gpx", op_id="imp-retry-same-id01")
    r2 = upload(client, auth_headers, gpx2, "run.gpx", op_id="imp-retry-same-id01")
    assert r1.json()["status"] == "imported"
    assert r2.json()["status"] == "duplicate_file"
    assert r2.json()["activity_id"] == r1.json()["activity"]["id"]
    listing = client.get("/api/v1/activities", headers=auth_headers).json()
    assert len(listing) == 1


def test_import_tcx(app_ctx, auth_headers):
    client = app_ctx["client"]
    resp = upload(client, auth_headers, points_to_tcx(sample_points(70)), "radfahrt.tcx")
    body = resp.json()
    assert body["status"] == "imported"
    assert body["activity"]["sport_type"] == "running"


def test_import_fit(app_ctx, auth_headers):
    client = app_ctx["client"]
    fit = build_fit_activity(FIT_START, n_records=80, sport_value=13)
    resp = upload(client, auth_headers, fit, "ride.fit", op_id="imp-op-fit-00000001")
    body = resp.json()
    assert body["status"] == "imported", body
    activity = body["activity"]
    assert activity["source_file_type"] == "fit"
    detail = client.get(
        f"/api/v1/activities/{activity['id']}", headers=auth_headers
    ).json()
    assert len(detail["stream"]["time"]) == 80
    hr_values = [v for v in detail["stream"]["hr"] if v is not None]
    assert hr_values


def test_import_malformed_rejected_with_error(app_ctx, auth_headers):
    client = app_ctx["client"]
    resp = upload(client, auth_headers, b"<gpx><broken", "kaputt.gpx")
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["error"]
    assert body.get("activity") is None


def test_import_empty_file_rejected(app_ctx, auth_headers):
    client = app_ctx["client"]
    resp = upload(client, auth_headers, b"", "leer.gpx")
    assert resp.json()["status"] == "rejected"


def test_import_unknown_format_rejected(app_ctx, auth_headers):
    client = app_ctx["client"]
    resp = upload(client, auth_headers, b"hello world" * 10, "notizen.txt")
    assert resp.json()["status"] == "rejected"


def test_import_requires_auth(app_ctx):
    import io

    resp = app_ctx["client"].post(
        "/api/v1/imports",
        files={"file": ("x.gpx", io.BytesIO(b"<gpx/>"), "text/xml")},
    )
    assert resp.status_code == 401
