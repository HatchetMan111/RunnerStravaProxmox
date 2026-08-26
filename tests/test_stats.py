from tests.helpers.sample_data import sample_points, sync_payload_from_points


def _seed(client, headers, n_points, name, op_suffix):
    op = sync_payload_from_points(sample_points(n_points), name=name)
    op["operation_id"] = f"stats-seed-{op_suffix}"
    op["payload"]["sport_type"] = "running"
    resp = client.post("/api/v1/sync", json={"operations": [op]}, headers=headers)
    assert resp.json()["results"][0]["status"] == "accepted"


def test_stats_overview_totals_and_buckets(app_ctx, auth_headers):
    client = app_ctx["client"]
    _seed(client, auth_headers, 600, "Sechsminütig", "a1")
    _seed(client, auth_headers, 1200, "Zwanzigminütig", "a2")

    stats = client.get("/api/v1/stats/overview", headers=auth_headers).json()
    totals = stats["totals"]
    assert totals["count"] == 2
    assert totals["distance_m"] > 1000
    assert totals["moving_time_s"] > 1000
    assert len(stats["weekly_last_12"]) >= 1
    week = stats["weekly_last_12"][-1]
    assert week["count"] == 2


def test_personal_records_from_splits(app_ctx, auth_headers):
    client = app_ctx["client"]
    _seed(client, auth_headers, 700, "Schnell", "pr1")

    stats = client.get("/api/v1/stats/overview", headers=auth_headers).json()
    records = stats["records"]
    assert records["fastest_1km_split"] is not None
    entry = records["fastest_1km_split"]
    assert entry["duration_s"] > 0
    assert entry["activity_id"]
