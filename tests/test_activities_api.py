from datetime import UTC, datetime

from app.services import parsers
from tests.helpers.sample_data import sample_points, sync_payload_from_points

NOW = datetime.now(UTC).timestamp()
del NOW


def _create_two_runs(client, headers):
    op_a = sync_payload_from_points(sample_points(300), name="Lang")
    op_a["operation_id"] = "act-list-a-000000001"

    short_points = sample_points(60)
    for p in short_points:
        p["t"] += 3600 * 24 * 7
    op_b = sync_payload_from_points(short_points, name="Kurz")
    op_b["operation_id"] = "act-list-b-000000001"

    for op in (op_a, op_b):
        resp = client.post("/api/v1/sync", json={"operations": [op]}, headers=headers)
        assert resp.json()["results"][0]["status"] == "accepted"


def test_list_patch_delete_roundtrip(app_ctx, auth_headers):
    client = app_ctx["client"]
    _create_two_runs(client, auth_headers)

    listing = client.get("/api/v1/activities", headers=auth_headers).json()
    assert len(listing) == 2
    newest = listing[0]
    oldest = listing[1]
    assert newest["name"] == "Kurz"

    found = client.get(
        "/api/v1/activities", headers=auth_headers, params={"q": "lang"}
    ).json()
    assert len(found) == 1 and found[0]["name"] == "Lang"

    patched = client.patch(
        f"/api/v1/activities/{oldest['id']}",
        json={"name": "Umbenannt", "notes": "Fühlt sich gut an", "tags": ["test", "morning"]},
        headers=auth_headers,
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Umbenannt"
    assert "morning" in patched.json()["tags"]

    deleted = client.delete(f"/api/v1/activities/{oldest['id']}", headers=auth_headers)
    assert deleted.status_code == 204
    remaining = client.get("/api/v1/activities", headers=auth_headers).json()
    assert len(remaining) == 1
    gone = client.get(f"/api/v1/activities/{oldest['id']}", headers=auth_headers)
    assert gone.status_code == 404


def test_export_gpx_roundtrip(app_ctx, auth_headers):
    client = app_ctx["client"]
    op = sync_payload_from_points(sample_points(50), name="Export Test")
    op["operation_id"] = "exp-gpx-roundtrip-001"
    created = client.post("/api/v1/sync", json={"operations": [op]}, headers=auth_headers)
    activity_id = created.json()["results"][0]["activity_id"]

    exported = client.get(f"/api/v1/activities/{activity_id}/export.gpx", headers=auth_headers)
    assert exported.status_code == 200
    assert b'creator="LocalTrack"' in exported.content
    assert exported.content.count(b"<trkpt ") == 50
    assert b"gpxtpx:hr" in exported.content
    assert "attachment" in exported.headers["content-disposition"]

    reparsed = parsers.parse_any(exported.content, "exported.gpx")
    assert len(reparsed.points) == 50


def test_export_without_positions_404(app_ctx, auth_headers):
    client = app_ctx["client"]
    pts = sample_points(20)
    for p in pts:
        p.pop("lat")
        p.pop("lon")
    op = {
        "operation_id": "exp-nopos-000000001",
        "kind": "activity.create",
        "payload": {"sport_type": "running", "points": pts},
    }
    created = client.post("/api/v1/sync", json={"operations": [op]}, headers=auth_headers)
    activity_id = created.json()["results"][0]["activity_id"]
    resp = client.get(f"/api/v1/activities/{activity_id}/export.gpx", headers=auth_headers)
    assert resp.status_code in (200, 404)


def test_other_user_cannot_access(app_ctx, auth_headers):
    client = app_ctx["client"]
    op = sync_payload_from_points(sample_points(20))
    op["operation_id"] = "sec-isolation-00001"
    created = client.post("/api/v1/sync", json={"operations": [op]}, headers=auth_headers)
    activity_id = created.json()["results"][0]["activity_id"]

    other_login = client.post(
        "/api/v1/auth/login", json={"username": "athlet", "password": "geheim-1234"}
    )
    del other_login
    no_token = client.get(f"/api/v1/activities/{activity_id}")
    assert no_token.status_code == 401
