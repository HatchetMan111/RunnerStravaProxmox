import io
import re
from dataclasses import dataclass, field

from app.services.geo import GeoPoint

NS_STRIP = re.compile(r"\{.*\}")


def strip_ns(tag: str) -> str:
    return NS_STRIP.sub("", tag).lower()


def iter_children(element, name: str):
    for child in element:
        if strip_ns(child.tag) == name.lower():
            yield child


def find_first(element, *names: str):
    current = [element]
    for name in names:
        nxt = []
        for el in current:
            for child in iter_children(el, name):
                nxt.append(child)
        current = nxt
        if not current:
            return None
    return current[0] if current else None


@dataclass
class ParsedActivity:
    points: list[GeoPoint] = field(default_factory=list)
    sport_hint: str | None = None
    name_hint: str | None = None
    device_hint: str | None = None


def detect_format(data: bytes, filename: str | None = None) -> str | None:
    if len(data) >= 12 and data[8:12] == b".FIT":
        return "fit"
    head = data[:512].lstrip()
    if head.startswith(b"<"):
        lowered = data[:4096].lower()
        if b"<gpx" in lowered:
            return "gpx"
        if b"trainingcenterdatabase" in lowered:
            return "tcx"
    if filename:
        lower_name = filename.lower()
        for fmt in ("gpx", "tcx", "fit"):
            if lower_name.endswith("." + fmt):
                return fmt
    return None


def parse_gpx(data: bytes) -> ParsedActivity:
    import gpxpy as gpxlib

    try:
        parsed = gpxlib.parse(io.BytesIO(data))
    except Exception as exc:
        raise ValueError(f"invalid GPX file: {exc}") from exc
    result = ParsedActivity(sport_hint="other")
    tracks = getattr(parsed, "tracks", None) or []
    if tracks:
        result.name_hint = parsed.name or tracks[0].name or None

    last_t: float | None = None

    def extract_ext(point) -> dict:
        values: dict[str, float] = {}
        for ext in getattr(point, "extensions", []) or []:
            for child in ext.iter():
                tag = strip_ns(str(child.tag))
                text = (child.text or "").strip()
                if not text:
                    continue
                if tag in ("hr", "heartrate"):
                    try:
                        values["hr"] = float(text)
                    except ValueError:
                        pass
                elif tag in ("cad", "cadence"):
                    try:
                        values["cad"] = float(text)
                    except ValueError:
                        pass
                elif tag in ("power", "watts"):
                    try:
                        values["power"] = float(text)
                    except ValueError:
                        pass
                elif tag in ("atemp", "temp"):
                    try:
                        values["temp"] = float(text)
                    except ValueError:
                        pass
        return values

    for track in tracks:
        for segment in track.segments:
            for pt in segment.points:
                extras = extract_ext(pt)
                if pt.time is not None:
                    t = pt.time.timestamp()
                    last_t = t
                elif last_t is not None:
                    t = last_t + 1.0
                    last_t = t
                else:
                    continue
                result.points.append(
                    GeoPoint(
                        t=t,
                        lat=pt.latitude,
                        lon=pt.longitude,
                        alt=pt.elevation,
                        hr=extras.get("hr"),
                        cad=extras.get("cad"),
                        power=extras.get("power"),
                        temp=extras.get("temp"),
                    )
                )
    return result


def parse_tcx(data: bytes) -> ParsedActivity:
    import xml.etree.ElementTree as ET

    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError(f"invalid TCX file: {exc}") from exc

    activities_el = find_first(root, "Activities")
    if activities_el is None:
        raise ValueError("invalid TCX file: no Activities element")
    activity_els = list(iter_children(activities_el, "Activity"))
    if not activity_els:
        raise ValueError("invalid TCX file: no Activity element")

    result = ParsedActivity()
    sport_attr = activity_els[0].get("Sport")
    sport_map = {
        "running": "running",
        "biking": "cycling",
        "cycling": "cycling",
        "walking": "walking",
        "hiking": "hiking",
        "swimming": "swimming",
        "other": "other",
    }
    result.sport_hint = sport_map.get((sport_attr or "").lower(), "other")

    notes_el = find_first(activity_els[0], "Notes")
    if notes_el is not None and (notes_el.text or "").strip():
        result.name_hint = notes_el.text.strip()

    for lap in iter_children(activity_els[0], "Lap"):
        for track in iter_children(lap, "Track"):
            for tp in iter_children(track, "Trackpoint"):
                time_el = find_first(tp, "Time")
                if time_el is None or not (time_el.text or "").strip():
                    continue
                raw_time = time_el.text.strip()
                try:
                    from datetime import datetime

                    dt = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                    t = dt.timestamp()
                except ValueError:
                    continue
                pos = find_first(tp, "Position")
                lat = lon = None
                if pos is not None:
                    lat_el = find_first(pos, "LatitudeDegrees")
                    lon_el = find_first(pos, "LongitudeDegrees")
                    try:
                        lat = float(lat_el.text) if lat_el is not None else None
                        lon = float(lon_el.text) if lon_el is not None else None
                    except (ValueError, TypeError):
                        lat = lon = None
                alt = None
                alt_el = find_first(tp, "AltitudeMeters")
                if alt_el is not None:
                    try:
                        alt = float(alt_el.text)
                    except (ValueError, TypeError):
                        alt = None
                hr = None
                hr_el = find_first(tp, "HeartRateBpm", "Value")
                if hr_el is not None:
                    try:
                        hr = float(hr_el.text)
                    except (ValueError, TypeError):
                        hr = None
                cad = None
                cad_el = find_first(tp, "Cadence")
                if cad_el is not None:
                    try:
                        cad = float(cad_el.text)
                    except (ValueError, TypeError):
                        cad = None
                power = None
                tpx = find_first(tp, "Extensions", "TPX")
                if tpx is not None:
                    watts_el = find_first(tpx, "Watts")
                    if watts_el is not None:
                        try:
                            power = float(watts_el.text)
                        except (ValueError, TypeError):
                            power = None
                result.points.append(
                    GeoPoint(t=t, lat=lat, lon=lon, alt=alt, hr=hr, cad=cad, power=power)
                )
    return result


SPORT_MAP_FIT = {
    "running": "running",
    "treadmill_running": "treadmill",
    "trail_running": "running",
    "cycling": "cycling",
    "road_biking": "cycling",
    "mountain_biking": "cycling",
    "virtual_ride": "cycling",
    "walking": "walking",
    "hiking": "hiking",
    "swimming": "swimming",
}


def _semi_to_deg(value):
    if value is None:
        return None
    try:
        return value * (180.0 / 2**31)
    except TypeError:
        return None


def _fit_num(frame, field_name):
    try:
        v = frame.get_value(field_name)
    except KeyError:
        return None
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_fit(data: bytes) -> ParsedActivity:
    import fitdecode

    result = ParsedActivity()
    last_t: float | None = None
    try:
        reader = fitdecode.FitReader(io.BytesIO(data))
        for frame in reader:
            if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                continue
            name = str(frame.name).lower()
            if name == "record":
                t = None
                try:
                    ts = frame.get_value("timestamp")
                    if ts is not None:
                        t = ts.timestamp()
                except KeyError:
                    t = None
                if t is None:
                    if last_t is None:
                        continue
                    t = last_t
                last_t = t

                lat = _semi_to_deg(_fit_num(frame, "position_lat"))
                lon = _semi_to_deg(_fit_num(frame, "position_long"))
                alt = _fit_num(frame, "enhanced_altitude")
                if alt is None:
                    alt = _fit_num(frame, "altitude")
                speed = _fit_num(frame, "enhanced_speed")
                if speed is None:
                    speed = _fit_num(frame, "speed")
                result.points.append(
                    GeoPoint(
                        t=t,
                        lat=lat,
                        lon=lon,
                        alt=alt,
                        hr=_fit_num(frame, "heart_rate"),
                        cad=_fit_num(frame, "cadence"),
                        power=_fit_num(frame, "power"),
                        speed=speed,
                        temp=_fit_num(frame, "temperature"),
                    )
                )
            elif name == "session":
                try:
                    sport = frame.get_value("sport")
                except KeyError:
                    sport = None
                if sport:
                    key = str(sport).lower()
                    result.sport_hint = SPORT_MAP_FIT.get(key, "other")
                for name_field in ("session_name", "name", "desc"):
                    try:
                        value = frame.get_value(name_field)
                    except KeyError:
                        value = None
                    if value and not result.name_hint:
                        result.name_hint = str(value)
    except Exception as exc:
        raise ValueError(f"invalid FIT file: {exc}") from exc
    return result


def parse_any(data: bytes, filename: str | None = None) -> ParsedActivity:
    fmt = detect_format(data, filename)
    if fmt == "gpx":
        return parse_gpx(data)
    if fmt == "tcx":
        return parse_tcx(data)
    if fmt == "fit":
        return parse_fit(data)
    raise ValueError(
        f"unsupported or unrecognized file format (filename={filename!r}, size={len(data)} bytes)"
    )
