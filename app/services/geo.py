import math
from dataclasses import dataclass

EARTH_RADIUS_M = 6371000.0
SPEED_EPSILON_MS = 0.3
ELEVATION_THRESHOLD_M = 2.0


@dataclass
class GeoPoint:
    t: float
    lat: float | None = None
    lon: float | None = None
    alt: float | None = None
    hr: float | None = None
    cad: float | None = None
    power: float | None = None
    speed: float | None = None
    temp: float | None = None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def cumulative_distances(points: list[GeoPoint]) -> list[float]:
    cum = [0.0]
    for prev, cur in zip(points, points[1:], strict=False):
        if prev.lat is None or prev.lon is None or cur.lat is None or cur.lon is None:
            cum.append(cum[-1])
            continue
        step = haversine_m(prev.lat, prev.lon, cur.lat, cur.lon)
        dt = cur.t - prev.t
        if dt > 0 and step / dt > 60.0:
            step = 0.0
        cum.append(cum[-1] + step)
    return cum


def smooth_elevations(points: list[GeoPoint], window: int = 5) -> list[float | None]:
    alts = [p.alt for p in points]
    n = len(alts)
    smoothed: list[float | None] = [None] * n
    for i in range(n):
        lo, hi = max(0, i - window // 2), min(n, i + window // 2 + 1)
        vals = [a for a in alts[lo:hi] if a is not None]
        if vals:
            smoothed[i] = sum(vals) / len(vals)
    return smoothed


def elevation_gain_loss(
    altitudes: list[float | None], threshold: float = ELEVATION_THRESHOLD_M
) -> tuple[float, float]:
    gain = 0.0
    loss = 0.0
    reference: float | None = None
    for alt in altitudes:
        if alt is None:
            continue
        if reference is None:
            reference = alt
            continue
        delta = alt - reference
        if abs(delta) >= threshold:
            if delta > 0:
                gain += delta
            else:
                loss += -delta
            reference = alt
    return round(gain, 1), round(loss, 1)


def segment_speeds(points: list[GeoPoint], cumdist: list[float]) -> list[float]:
    speeds: list[float] = []
    for i in range(len(points)):
        if i == 0:
            speeds.append(0.0)
            continue
        dt = points[i].t - points[i - 1].t
        dd = cumdist[i] - cumdist[i - 1]
        speeds.append(dd / dt if dt > 0 else 0.0)
    return speeds


def moving_time_s(points: list[GeoPoint], cumdist: list[float], threshold: float = SPEED_EPSILON_MS) -> float:
    total = 0.0
    for i in range(1, len(points)):
        dt = points[i].t - points[i - 1].t
        if dt <= 0:
            continue
        speed = (cumdist[i] - cumdist[i - 1]) / dt
        if speed > threshold:
            total += dt
    return round(total, 1)


def compute_splits(
    points: list[GeoPoint],
    cumdist: list[float],
    unit_m: float = 1000.0,
    max_splits: int = 500,
) -> list[dict]:
    splits: list[dict] = []
    total = cumdist[-1] if cumdist else 0.0
    if total <= 0 or not points:
        return splits
    boundary = unit_m
    start_i = 0
    while boundary <= total and len(splits) < max_splits:
        end_i = None
        for i in range(start_i + 1, len(points)):
            if cumdist[i] >= boundary:
                end_i = i
                break
        if end_i is None:
            break
        frac_prev = 0.0
        seg_len = cumdist[end_i] - cumdist[end_i - 1]
        if seg_len > 0:
            frac_prev = (boundary - cumdist[end_i - 1]) / seg_len
        split_end_t = points[end_i - 1].t + frac_prev * (points[end_i].t - points[end_i - 1].t)
        start_boundary = boundary - unit_m
        frac_start = 0.0
        seg_len_start = cumdist[start_i + 1] - cumdist[start_i] if start_i + 1 < len(points) else 0.0
        if seg_len_start > 0 and start_boundary > cumdist[start_i]:
            frac_start = (start_boundary - cumdist[start_i]) / seg_len_start
        split_start_t = points[start_i].t
        if frac_start > 0 and start_i + 1 < len(points):
            split_start_t = points[start_i].t + frac_start * (
                points[start_i + 1].t - points[start_i].t
            )
        duration = split_end_t - split_start_t
        hrs = [
            p.hr
            for p in points[start_i : end_i + 1]
            if p.hr is not None
        ]
        gains = smooth_elevations(points[start_i : end_i + 1])
        gain_vals = [a for a in gains if a is not None]
        gain = 0.0
        if gain_vals:
            for a, b in zip(gain_vals, gain_vals[1:], strict=False):
                d = b - a
                if d > 0:
                    gain += d
        splits.append(
            {
                "index": len(splits) + 1,
                "kind": "km" if unit_m == 1000.0 else "mile",
                "start_offset_s": round(split_start_t - points[0].t, 1),
                "duration_s": round(duration, 1),
                "distance_m": round(unit_m, 1),
                "avg_speed_ms": round(unit_m / duration, 3) if duration > 0 else None,
                "avg_hr": round(sum(hrs) / len(hrs), 1) if hrs else None,
                "elevation_gain_m": round(gain, 1),
            }
        )
        start_i = end_i
        boundary += unit_m
    return splits


def serialize_series(points: list[GeoPoint], cumdist: list[float]) -> dict[str, list]:
    series: dict[str, list] = {
        "time": [round(p.t, 3) for p in points],
        "distance": [round(d, 2) for d in cumdist],
    }
    metric_keys = ("lat", "lon", "alt", "hr", "cad", "power", "speed", "temp")
    for key in metric_keys:
        values = [getattr(p, key) for p in points]
        if any(v is not None for v in values):
            series[key] = [None if v is None else round(v, 6) for v in values]
    speeds = segment_speeds(points, cumdist)
    if "speed" not in series:
        series["speed"] = [round(s, 3) for s in speeds]
    return series


def avg_of(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return round(sum(clean) / len(clean), 2)


def max_of(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return round(max(clean), 2)
