import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_TEST_ENV_SET = False


def _set_test_env(data_dir: Path, db_path: Path):
    global _TEST_ENV_SET
    os.environ["LOCALTRACK_DATA_DIR"] = str(data_dir)
    os.environ["LOCALTRACK_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ.pop("LOCALTRACK_FRONTEND_DIST", None)


@pytest.fixture()
def app_ctx(tmp_path, monkeypatch):

    from app import config as config_mod
    from app.auth import _login_attempts

    _login_attempts.clear()

    data_dir = tmp_path / "data"
    db_path = tmp_path / "test.db"
    _set_test_env(data_dir, db_path)
    config_mod.get_settings.cache_clear()

    from fastapi.testclient import TestClient

    from app.main import create_app

    api = create_app(config_mod.get_settings())
    with TestClient(api) as client:
        yield {"client": client, "data_dir": data_dir}


@pytest.fixture()
def auth_headers(app_ctx):
    client = app_ctx["client"]
    resp = client.post(
        "/api/v1/auth/setup",
        json={"username": "athlet", "password": "geheim-1234"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def make_loop_points(
    start_epoch: float,
    n_points: int,
    step_s: float,
    speed_ms: float,
    start_lat: float = 52.52,
    start_lon: float = 13.405,
    alt_fn=None,
    hr_fn=None,
):
    import math

    points = []
    lat_rad = math.radians(start_lat)
    meters_per_deg_lon = 111320.0 * math.cos(lat_rad)
    for i in range(n_points):
        t = start_epoch + i * step_s
        dist_north = speed_ms * i * 0.3
        dist_east = speed_ms * i * 0.95
        lat = start_lat + dist_north / 111320.0
        lon = start_lon + dist_east / meters_per_deg_lon
        alt = alt_fn(i) if alt_fn else None
        hr = hr_fn(i) if hr_fn else None
        point = {
            "t": t,
            "lat": round(lat, 7),
            "lon": round(lon, 7),
            "alt": alt,
            "hr": hr,
        }
        points.append(point)
    return points


@pytest.fixture(scope="session")
def fixtures_dir():
    return Path(__file__).parent / "fixtures"


@pytest.fixture()
def clean_temp_cwd():
    old = os.getcwd()
    new_dir = tempfile.mkdtemp(prefix="lt-cwd-")
    os.chdir(new_dir)
    try:
        yield Path(new_dir)
    finally:
        os.chdir(old)
