import math

from app.services.activity_calc import duration_label, pace_label
from app.services.geo import (
    GeoPoint,
    cumulative_distances,
    elevation_gain_loss,
    haversine_m,
    moving_time_s,
    serialize_series,
)


def test_haversine_known_distance():
    d = haversine_m(52.5200, 13.4050, 52.5210, 13.4050)
    assert abs(d - 111.3) < 2.0
    d2 = haversine_m(52.52, 13.405, 48.137, 11.575)
    assert abs(d2 - 504_000) < 3000


def test_cumulative_distances_monotonic_and_sum():
    pts = [GeoPoint(t=i, lat=52.52 + i * 9e-6, lon=13.405) for i in range(100)]
    cum = cumulative_distances(pts)
    assert cum[0] == 0.0
    assert all(b >= a for a, b in zip(cum, cum[1:], strict=False))
    assert abs(cum[-1] - math.hypot(99 * 9e-6 * 111320, 0)) < 50


def test_elevation_threshold_hysteresis():
    alts = [100.0, 101.0, 102.4, 102.5, 103.9, 104.2, 98.0]
    gain, loss = elevation_gain_loss(alts, threshold=2.0)
    assert abs(gain - 2.4) < 0.05
    assert abs(loss - 4.4) < 0.05
    flat = [50.0 + (i % 3) * 0.4 for i in range(200)]
    gain_flat, loss_flat = elevation_gain_loss(flat, threshold=2.0)
    assert gain_flat == 0.0 and loss_flat == 0.0


def test_moving_time_excludes_stops():
    t = 0
    pts = []
    for i in range(60):
        pts.append(GeoPoint(t=t, lat=52.52 + i * 1e-5, lon=13.405))
        t += 1
    pause_start = t
    for _ in range(120):
        pts.append(GeoPoint(t=t, lat=52.52 + 59 * 1e-5, lon=13.405))
        t += 1
    for i in range(60, 120):
        pts.append(GeoPoint(t=t, lat=52.52 + i * 1e-5, lon=13.405))
        t += 1
    cum = cumulative_distances(pts)
    moving = moving_time_s(pts, cum, threshold=0.3)
    total = pts[-1].t - pts[0].t
    assert moving < total - 100
    assert moving >= (pause_start - pts[0].t) - 2
    del pause_start


def test_serialize_series_drops_empty_metrics():
    pts = [GeoPoint(t=i, lat=52.5, lon=13.4) for i in range(5)]
    series = serialize_series(pts, cumulative_distances(pts))
    assert "time" in series and "distance" in series
    assert "lat" in series and "lon" in series
    assert "hr" not in series and "power" not in series
    assert "speed" in series


def test_pace_and_duration_labels():
    assert pace_label(3.33) == "5:00"
    assert pace_label(None) is None
    assert duration_label(3725) == "1:02:05"
    assert duration_label(65) == "1:05"
