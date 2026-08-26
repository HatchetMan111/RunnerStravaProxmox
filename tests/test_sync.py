from tests.helpers.sample_data import sample_points, sync_payload_from_points


def post_sync(client, headers, operations):
    return client.post("/api/v1/sync", json={"operations": operations}, headers=headers)


def test_sync_accepts_activity(app_ctx, auth_headers):
    client = app_ctx["client"]
    ops = [sync_payload_from_points(sample_points(60), name="Erster Lauf")]
    ops[0]["operation_id"] = "op-0001-test-0001"
    resp = post_sync(client, auth_headers, ops)
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "accepted"
    assert result["activity_id"]

    detail = client.get(f"/api/v1/activities/{result['activity_id']}", headers=auth_headers).json()
    assert detail["sport_type"] == "running"
    assert detail["name"] == "Erster Lauf"
    assert detail["distance_m"] > 100
    assert detail["moving_time_s"] > 30
    assert detail["avg_hr"] is not None
    assert detail["stream"]["time"], "stream must contain time series"


def test_sync_replay_is_duplicate_exactly_once(app_ctx, auth_headers):
    client = app_ctx["client"]
    ops = [sync_payload_from_points(sample_points(50))]
    ops[0]["operation_id"] = "op-replay-same-op01"

    first = post_sync(client, auth_headers, ops)
    second = post_sync(client, auth_headers, ops)
    third = post_sync(client, auth_headers, ops)

    assert first.json()["results"][0]["status"] == "accepted"
    assert second.json()["results"][0]["status"] == "duplicate"
    assert third.json()["results"][0]["status"] == "duplicate"

    activity_id = first.json()["results"][0]["activity_id"]
    assert second.json()["results"][0]["activity_id"] == activity_id

    listing = client.get("/api/v1/activities", headers=auth_headers).json()
    assert len(listing) == 1


def test_sync_different_operation_ids_create_separate_activities(app_ctx, auth_headers):
    client = app_ctx["client"]
    op_a = sync_payload_from_points(sample_points(30))
    op_b = sync_payload_from_points(sample_points(30))
    op_a["operation_id"] = "op-distinct-a000001"
    op_b["operation_id"] = "op-distinct-b000001"
    resp = post_sync(client, auth_headers, [op_a, op_b])
    statuses = [r["status"] for r in resp.json()["results"]]
    assert statuses == ["accepted", "accepted"]
    assert len(client.get("/api/v1/activities", headers=auth_headers).json()) == 2


def test_sync_rejects_empty_payload_without_side_effects(app_ctx, auth_headers):
    client = app_ctx["client"]
    bad = {
        "operation_id": "op-empty-payload-1",
        "kind": "activity.create",
        "payload": {"sport_type": "running", "points": []},
    }
    good = sync_payload_from_points(sample_points(20))
    good["operation_id"] = "op-good-after-bad01"

    resp = post_sync(client, auth_headers, [bad, good])
    results = resp.json()["results"]
    assert results[0]["status"] == "rejected"
    assert results[0]["error"]
    assert results[1]["status"] == "accepted"

    retry_bad = dict(bad)
    retry = post_sync(client, auth_headers, [retry_bad])
    assert retry.json()["results"][0]["status"] == "rejected"


def test_sync_invalid_lat_rejected(app_ctx, auth_headers):
    client = app_ctx["client"]
    pts = sample_points(10)
    pts[3]["lat"] = 999.0
    op = {
        "operation_id": "op-invalid-lat-0001",
        "kind": "activity.create",
        "payload": {"sport_type": "running", "points": pts},
    }
    resp = post_sync(client, auth_headers, [op])
    assert resp.json()["results"][0]["status"] == "rejected"


def test_sync_requires_auth(app_ctx):
    resp = app_ctx["client"].post("/api/v1/sync", json={"operations": []})
    assert resp.status_code == 401
