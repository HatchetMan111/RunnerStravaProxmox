import struct
from datetime import UTC, datetime

FIT_EPOCH = datetime(1989, 12, 31, tzinfo=UTC)

TYPE_ENUM = 0x00
TYPE_UINT8 = 0x02
TYPE_SINT16 = 0x83
TYPE_UINT16 = 0x84
TYPE_SINT32 = 0x85
TYPE_UINT32 = 0x86


def crc16(data: bytes, crc: int = 0) -> int:
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def _definition(local_type: int, global_num: int, fields: list[tuple[int, int, int]]) -> bytes:
    body = struct.pack(
        "<BBH",
        0,
        0,
        global_num,
    ) + bytes([len(fields)])
    for num, size, base_type in fields:
        body += bytes([num, size, base_type])
    return bytes([0x40 | local_type]) + body


def _data(local_type: int, payload: bytes) -> bytes:
    return bytes([local_type]) + payload


def fit_timestamp(dt: datetime) -> int:
    return int((dt - FIT_EPOCH).total_seconds())


class FitBuilder:
    def __init__(self):
        self.messages: list[bytes] = []

    def file_id(self, ts: datetime):
        self.messages.append(_definition(0, 0, [(0, 1, TYPE_ENUM), (4, 4, TYPE_UINT32)]))
        self.messages.append(_data(0, bytes([4]) + struct.pack("<I", fit_timestamp(ts))))

    def record_definition(self, include_position=True, include_hr=True, include_alt=True):
        fields = [(253, 4, TYPE_UINT32)]
        if include_position:
            fields += [(0, 4, TYPE_SINT32), (1, 4, TYPE_SINT32)]
        if include_alt:
            fields += [(78, 4, TYPE_UINT32)]
        if include_hr:
            fields += [(3, 1, TYPE_UINT8)]
        self._record_fields = fields
        self.messages.append(_definition(1, 20, fields))

    def record(self, dt: datetime, lat=None, lon=None, alt=None, hr=None):
        def semicircles(deg):
            if deg is None:
                return 0
            return int(deg / 180.0 * (2**31))

        values = struct.pack("<I", fit_timestamp(dt))
        if any(f[0] == 0 for f in self._record_fields):
            values += struct.pack("<i", semicircles(lat))
            values += struct.pack("<i", semicircles(lon))
        if any(f[0] == 78 for f in self._record_fields):
            values += struct.pack("<I", int((alt + 500) * 5) if alt is not None else 0xFFFFFFFF)
        if any(f[0] == 3 for f in self._record_fields):
            values += bytes([int(hr) if hr is not None else 0])
        self.messages.append(_data(1, values))

    def session(self, sport_value: int, ts: datetime):
        self.messages.append(
            _definition(2, 18, [(5, 1, TYPE_ENUM), (253, 4, TYPE_UINT32)]))
        self.messages.append(
            _data(2, bytes([sport_value]) + struct.pack("<I", fit_timestamp(ts)))
        )

    def build(self) -> bytes:
        body = b"".join(self.messages)
        body_crc = crc16(body)
        header = bytearray(struct.pack("<BBHI", 14, 0x10, 2117, len(body)) + b".FIT")
        header += struct.pack("<H", crc16(bytes(header[:12])))
        return bytes(header) + body + struct.pack("<H", body_crc)


def build_fit_activity(
    start: datetime,
    n_records: int = 60,
    step_s: float = 1.0,
    start_lat: float = 52.52,
    start_lon: float = 13.405,
    speed_ms: float = 3.0,
    base_alt: float = 50.0,
    sport_value: int = 11,
    include_hr: bool = True,
) -> bytes:
    import math

    builder = FitBuilder()
    builder.file_id(start)
    builder.record_definition(include_position=True, include_hr=include_hr, include_alt=True)
    lat_rad = math.radians(start_lat)
    m_per_deg_lon = 111320.0 * math.cos(lat_rad)
    for i in range(n_records):
        t = start.timestamp() + i * step_s
        dt = datetime.fromtimestamp(t, tz=UTC)
        east = speed_ms * i
        north = speed_ms * i * 0.3
        lat = start_lat + north / 111320.0
        lon = start_lon + east / m_per_deg_lon
        alt = base_alt + (2.0 if i % 7 == 0 else 0.0)
        hr = 140 + (i % 10)
        builder.record(dt, lat=lat, lon=lon, alt=alt, hr=hr if include_hr else None)
    builder.session(sport_value, datetime.fromtimestamp(start.timestamp() + n_records * step_s, tz=UTC))
    return builder.build()
