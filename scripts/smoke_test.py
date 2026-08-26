#!/usr/bin/env python3
"""End-to-end smoke test for a running LocalTrack server.

Usage: python3 scripts/smoke_test.py [BASE_URL]
Default BASE_URL: http://127.0.0.1:8080

Checks: health, setup/login, offline-style sync (idempotent replay),
file import (GPX duplicate detection), export, stats, static PWA files.
"""

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080"
PASSED = []
FAILED = []


def check(name, condition, detail=""):
    if condition:
        PASSED.append(name)
        print(f"[OK]   {name}")
    else:
        FAILED.append(name)
        print(f"[FAIL] {name} {detail}")


def req(method, path, token=None, payload=None, raw_body=None, content_type=None):
    url = BASE + path
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    if raw_body is not None:
        data = raw_body
        if content_type:
            headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            body = response.read()
            try:
                return response.status, json.loads(body)
            except json.JSONDecodeError:
                return response.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read()
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body


def multipart(filename, content, mime="application/gpx+xml"):
    boundary = "----localtrack-smoke"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def make_gpx(n_points=120, name="Smoke-Lauf"):
    start_lat, start_lon = 52.52, 13.405
    m_per_deg_lon = 111320 * math.cos(math.radians(start_lat))
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="smoke" xmlns="http://www.topografix.com/GPX/1/1">',
        f"<trk><name>{name}</name><trkseg>",
    ]
    t0 = int(time.time()) - n_points
    for i in range(n_points):
        lat = start_lat + (3.0 * i) / 111320
        lon = start_lon + (3.0 * i) / m_per_deg_lon
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 + i))
        lines.append(
            f'<trkpt lat="{lat:.7f}" lon="{lon:.7f}"><ele>50</ele><time>{iso}</time></trkpt>'
        )
    lines.append("</trkseg></trk></gpx>")
    return "\n".join(lines).encode()


def make_points_payload(operation_id, n=1300):
    start_lat, start_lon = 48.137, 11.575
    m_per_deg_lon = 111320 * math.cos(math.radians(start_lat))
    t0 = int(time.time()) - n
    points = [
        {
            "t": t0 + i,
            "lat": start_lat + (3.2 * i) / 111320,
            "lon": start_lon + (3.2 * i) / m_per_deg_lon,
            "alt": 500 + (i % 4),
            "hr": 150 + (i % 6),
        }
        for i in range(n)
    ]
    return {
        "operation_id": operation_id,
        "kind": "activity.create",
        "client_id": "smoke-test",
        "payload": {
            "sport_type": "running",
            "name": "Smoke-Testlauf",
            "timezone_name": "Europe/Berlin",
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
            "points": points,
        },
    }


def main():
    print(f"== LocalTrack Smoke-Test gegen {BASE} ==")

    status, health = req("GET", "/api/v1/health")
    check("Health-Endpoint", status == 200 and health.get("status") == "ok", str(health))

    status, index = req("GET", "/")
    check("Web UI (index.html)", status == 200 and b"<div id=\"root\">" in index)

    status, sw = req("GET", "/sw.js")
    check("Service Worker ausgeliefert", status == 200 and b"localtrack-v" in sw)

    status, _manifest = req("GET", "/manifest.webmanifest")
    check("Manifest ausgeliefert", status == 200)

    setup_done = health.get("setup_complete", False)
    username = f"smoke-{int(time.time())}"
    token = None
    if not setup_done:
        status, auth = req("POST", "/api/v1/auth/setup", payload={"username": username, "password": "smoke-pass-123"})
        check("Setup (erster Benutzer)", status == 201 and bool(auth.get("token")))
        token = auth.get("token")
    elif os.environ.get("LT_SMOKE_USER") and os.environ.get("LT_SMOKE_PASS"):
        status, auth = req(
            "POST",
            "/api/v1/auth/login",
            payload={"username": os.environ["LT_SMOKE_USER"], "password": os.environ["LT_SMOKE_PASS"]},
        )
        check("Login bestehender Benutzer", status == 200 and bool(auth.get("token")))
        token = auth.get("token")
    else:
        print("[SKIP] Server bereits eingerichtet – Auth-/Sync-Tests übersprungen")
        print("       (LT_SMOKE_USER/LT_SMOKE_PASS setzen für den vollen Durchlauf)")
        print("")
        print(f"== Ergebnis: {len(PASSED)} OK, 0 FEHLER ==")
        return

    op_id = f"smoke-op-{int(time.time()*1000)}"
    status, sync1 = req("POST", "/api/v1/sync", token, {"operations": [make_points_payload(op_id)]})
    result1 = sync1.get("results", [{}])[0] if isinstance(sync1, dict) else {}
    check("Sync: Aktivität akzeptiert", result1.get("status") == "accepted", str(sync1))
    activity_id = result1.get("activity_id")

    status, sync2 = req("POST", "/api/v1/sync", token, {"operations": [make_points_payload(op_id)]})
    result2 = sync2.get("results", [{}])[0] if isinstance(sync2, dict) else {}
    check(
        "Sync: Replay -> duplicate (genau einmal)",
        result2.get("status") == "duplicate" and result2.get("activity_id") == activity_id,
        str(result2),
    )

    status, listing = req("GET", "/api/v1/activities?per_page=5", token)
    names = [a.get("name") for a in listing] if isinstance(listing, list) else []
    count_for_op = len([a for a in (listing or []) if a.get("name") == "Smoke-Testlauf"])
    check("Sync: keine Duplikate angelegt", count_for_op <= 1, str(names))

    gpx = make_gpx()
    body, content_type = multipart("smoke-lauf.gpx", gpx)
    imp_op = f"smoke-imp-{int(time.time()*1000)}"
    status, imp1 = req(
        "POST", f"/api/v1/imports?operation_id={imp_op}", token, raw_body=body, content_type=content_type
    )
    check("Import GPX", imp1.get("status") == "imported", str(imp1)[:200])

    body2, ct2 = multipart("anderer-name.gpx", gpx)
    status, imp2 = req(
        "POST", f"/api/v1/imports?operation_id={imp_op}", token, raw_body=body2, content_type=ct2
    )
    check(
        "Import: Retry gleiche operation_id -> duplicate_file",
        imp2.get("status") == "duplicate_file",
        str(imp2)[:200],
    )

    body3, ct3 = multipart("kopie.gpx", gpx)
    status, imp3 = req("POST", "/api/v1/imports", token, raw_body=body3, content_type=ct3)
    check(
        "Import: gleiche Datei ohne op-id -> duplicate_file (Hash)",
        imp3.get("status") == "duplicate_file",
        str(imp3)[:200],
    )

    if activity_id:
        status, detail = req("GET", f"/api/v1/activities/{activity_id}", token)
        stream = detail.get("stream") or {}
        splits = detail.get("splits") or []
        check(
            "Detail: Stream + berechnete Metriken",
            len(stream.get("time", [])) >= 1200 and detail.get("distance_m", 0) > 3000 and len(splits) >= 3,
            f"time={len(stream.get('time', []))} dist={detail.get('distance_m')} splits={len(splits)}",
        )

        status, exported = req("GET", f"/api/v1/activities/{activity_id}/export.gpx", token)
        check("GPX-Export", status == 200 and b"<trkpt" in exported)

        status, _deleted = req("DELETE", f"/api/v1/activities/{activity_id}", token)
        check("Löschen der Test-Aktivität", status in (204, 200))

    status, stats = req("GET", "/api/v1/stats/overview", token)
    totals = stats.get("totals", {}) if isinstance(stats, dict) else {}
    check("Statistiken", status == 200 and "count" in totals and "weekly_last_12" in stats, str(totals))

    print("")
    print(f"== Ergebnis: {len(PASSED)} OK, {len(FAILED)} FEHLER ==")
    if FAILED:
        print("Fehlgeschlagen:", ", ".join(FAILED))
        sys.exit(1)
    print("Alle Checks bestanden.")


if __name__ == "__main__":
    main()
