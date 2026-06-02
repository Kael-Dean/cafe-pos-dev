

async def test_login_returns_token_pair(client, store_a, user_a):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": store_a.slug, "pin": "1111"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]


async def test_login_wrong_pin_returns_401(client, store_a, user_a):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": store_a.slug, "pin": "9999"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"


async def test_login_unknown_store_returns_401(client):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": "no-such-store", "pin": "1111"},
    )
    assert resp.status_code == 401


async def test_me_round_trip(client, store_a, user_a):
    login = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": store_a.slug, "pin": "1111"},
    )
    token = login.json()["access_token"]
    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["id"] == user_a.id
    assert body["name"] == user_a.name
    assert body["role"] == user_a.role.value
    assert body["store_id"] == store_a.id
    assert body["store_name"] == store_a.name


async def test_refresh_yields_new_access_token(client, store_a, user_a):
    login = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": store_a.slug, "pin": "1111"},
    )
    refresh_token = login.json()["refresh_token"]
    resp = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_token}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["access_token"]


async def test_refresh_rejects_access_token(client, store_a, user_a):
    login = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": store_a.slug, "pin": "1111"},
    )
    access = login.json()["access_token"]
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": access})
    assert resp.status_code == 401


async def test_login_rate_limited(client, store_a, user_a):
    for _i in range(5):
        await client.post(
            "/api/v1/auth/login",
            json={"store_slug": store_a.slug, "pin": "0000"},
        )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"store_slug": store_a.slug, "pin": "1111"},
    )
    assert resp.status_code == 429
