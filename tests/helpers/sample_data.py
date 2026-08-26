import time as _time
from datetime import UTC


def sample_points(n=120, start_epoch=None):
    from tests.conftest import make_loop_points

    if start_epoch is None:
        start_epoch = _time.time() - 7200
    return make_loop_points(
        start_epoch=start_epoch,
        n_points=n,
        step_s=1.0,
        speed_ms=3.0,
        alt_fn=lambda i: 50 + (i % 5),
        hr_fn=lambda i: 140 + (i % 8),
    )


def points_to_gpx(points) -> bytes:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="TestGen" xmlns="http://www.topografix.com/GPX/1/1"',
        ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
        "<trk><name>Morgentraining</name><trkseg>",
    ]
    for p in points:
        from datetime import datetime as dt

        iso = (
            dt.fromtimestamp(p["t"], tz=UTC)
            .isoformat()
            .replace("+00:00", "Z")
        )
        ext = ""
        if p.get("hr") is not None:
            hr_val = int(p["hr"])
            ext = (
                "<extensions><gpxtpx:TrackPointExtension>"
                f"<gpxtpx:hr>{hr_val}</gpxtpx:hr>"
                "</gpxtpx:TrackPointExtension></extensions>"
            )
        lines.append(
            f'<trkpt lat="{p["lat"]}" lon="{p["lon"]}"><ele>{p["alt"]}</ele><time>{iso}</time>{ext}</trkpt>'
        )
    lines.append("</trkseg></trk></gpx>")
    return "\n".join(lines).encode()


def points_to_tcx(points) -> bytes:
    from datetime import datetime as dt

    def iso(t):
        return (
            dt.fromtimestamp(t, tz=UTC).isoformat().replace("+00:00", ".000Z")
        )

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">',
        '<Activities><Activity Sport="Running"><Id>' + iso(points[0]["t"]) + "</Id>",
        "<Lap StartTime=\"" + iso(points[0]["t"]) + "\">",
        "<TotalTimeSeconds>" + str(int(points[-1]["t"] - points[0]["t"])) + "</TotalTimeSeconds>",
        "<Track>",
    ]
    for p in points:
        hr = f"<HeartRateBpm><Value>{int(p['hr'])}</Value></HeartRateBpm>" if p.get("hr") is not None else ""
        pos = (
            f"<Position><LatitudeDegrees>{p['lat']}</LatitudeDegrees>"
            f"<LongitudeDegrees>{p['lon']}</LongitudeDegrees></Position>"
            if p.get("lat") is not None
            else ""
        )
        lines.append(
            f"<Trackpoint><Time>{iso(p['t'])}</Time>{pos}"
            f"<AltitudeMeters>{p['alt']}</AltitudeMeters>"
            f"{hr}<Cadence>88</Cadence></Trackpoint>"
        )
    lines.append("</Track></Lap></Activity></Activities></TrainingCenterDatabase>")
    return "\n".join(lines).encode()



def sync_payload_from_points(points, sport="running", name="Testlauf"):
    return {
        "operation_id": "op-" + str(abs(hash(tuple(str(p['t']) for p in points))) % 10**12).zfill(12),
        "kind": "activity.create",
        "client_id": "test-client",
        "payload": {
            "sport_type": sport,
            "name": name,
            "timezone_name": "Europe/Berlin",
            "points": points,
        },
    }
