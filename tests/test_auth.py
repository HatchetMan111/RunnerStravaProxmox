def test_setup_creates_first_user(app_ctx):
    client = app_ctx["client"]
    resp = client.post("/api/v1/auth/setup", json={"username": "athlet", "password": "geheim-1234"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"] and body["username"] == "athlet"


def test_setup_second_time_conflict(app_ctx):
    client = app_ctx["client"]
    first = client.post("/api/v1/auth/setup", json={"username": "anna", "password": "geheim-1234"})
    assert first.status_code == 201
    second = client.post("/api/v1/auth/setup", json={"username": "bert", "password": "geheim-5678"})
    assert second.status_code == 409


def test_login_wrong_password(app_ctx):
    client = app_ctx["client"]
    client.post("/api/v1/auth/setup", json={"username": "athlet", "password": "geheim-1234"})
    resp = client.post("/api/v1/auth/login", json={"username": "athlet", "password": "falsch-12345"})
    assert resp.status_code == 401


def test_login_rate_limited(app_ctx):
    client = app_ctx["client"]
    client.post("/api/v1/auth/setup", json={"username": "athlet", "password": "geheim-1234"})
    for _ in range(10):
        client.post("/api/v1/auth/login", json={"username": "athlet", "password": "falsch-12345"})
    resp = client.post("/api/v1/auth/login", json={"username": "athlet", "password": "geheim-1234"})
    assert resp.status_code == 429


def test_me_requires_token(app_ctx):
    client = app_ctx["client"]
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_login_and_logout_roundtrip(app_ctx):
    client = app_ctx["client"]
    client.post("/api/v1/auth/setup", json={"username": "athlet", "password": "geheim-1234"})
    login = client.post("/api/v1/auth/login", json={"username": "athlet", "password": "geheim-1234"})
    token = login.json()["token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["username"] == "athlet"
    out = client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert out.status_code == 200
    after = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert after.status_code == 401


def test_health_endpoint(app_ctx):
    body = app_ctx["client"].get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["version"]
