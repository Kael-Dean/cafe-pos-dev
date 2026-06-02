
from app.enums import Role, StaffPosition
from tests.conftest import make_user


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_NEW_STAFF = {
    "name": "Bob Tester",
    "role": "BARISTA",
    "position": "JUNIOR",
    "pin": "9999",
    "phone": "0899999999",
    "email": "bob@cafe.com",
    "address": "123 Test Road",
}


# ---------------------------------------------------------------------------
# List staff
# ---------------------------------------------------------------------------

async def test_list_staff_includes_active_members(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get("/api/v1/hr/staff", headers=_headers(token))
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert manager_a.id in ids


# ---------------------------------------------------------------------------
# Create staff
# ---------------------------------------------------------------------------

async def test_create_staff_returns_201_with_all_fields(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=_NEW_STAFF)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Bob Tester"
    assert data["position"] == "JUNIOR"
    assert data["phone"] == "0899999999"
    assert data["email"] == "bob@cafe.com"
    assert data["address"] == "123 Test Road"
    assert data["is_active"] is True
    assert "pin" not in data
    assert "pin_hash" not in data


async def test_create_staff_barista_returns_403(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=_NEW_STAFF)
    assert resp.status_code == 403


async def test_create_staff_missing_phone_returns_422(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload = {k: v for k, v in _NEW_STAFF.items() if k != "phone"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload)
    assert resp.status_code == 422


async def test_create_staff_missing_position_returns_422(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload = {k: v for k, v in _NEW_STAFF.items() if k != "position"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload)
    assert resp.status_code == 422


async def test_create_staff_duplicate_phone_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    await client.post("/api/v1/hr/staff", headers=_headers(token), json=_NEW_STAFF)
    dupe = {**_NEW_STAFF, "name": "Charlie", "email": "charlie@cafe.com", "pin": "8888"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=dupe)
    assert resp.status_code == 409


async def test_create_staff_duplicate_email_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload_1 = {**_NEW_STAFF, "phone": "0877770001"}
    await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload_1)
    payload_2 = {**_NEW_STAFF, "phone": "0877770002", "name": "Dana", "pin": "7777"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload_2)
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Get single staff
# ---------------------------------------------------------------------------

async def test_get_staff_by_id_returns_full_profile(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get(f"/api/v1/hr/staff/{manager_a.id}", headers=_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == manager_a.id
    assert data["phone"] == "0822222222"
    assert "position" in data


async def test_get_staff_barista_can_read(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.get(f"/api/v1/hr/staff/{manager_a.id}", headers=_headers(token))
    assert resp.status_code == 200


async def test_get_staff_not_found_returns_404(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.get("/api/v1/hr/staff/nonexistent000000000000", headers=_headers(token))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update staff
# ---------------------------------------------------------------------------

async def test_update_staff_name(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Eve", pin="5555", phone="0855550001", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"name": "Eve Updated"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Eve Updated"


async def test_update_staff_position(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Frank", pin="4444", phone="0844440001",
        position=StaffPosition.JUNIOR, role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"position": "SENIOR"},
    )
    assert resp.status_code == 200
    assert resp.json()["position"] == "SENIOR"


async def test_update_staff_clear_email(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Grace", pin="3333", phone="0833330001",
        email="grace@cafe.com", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"email": None},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] is None


async def test_update_staff_barista_returns_403(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.patch(
        f"/api/v1/hr/staff/{manager_a.id}",
        headers=_headers(token),
        json={"name": "Hacked"},
    )
    assert resp.status_code == 403


async def test_update_staff_duplicate_phone_returns_409(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Hank", pin="2221", phone="0811110001", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    # Try to update Hank's phone to manager_a's phone
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"phone": "0822222222"},
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Delete (resign) staff
# ---------------------------------------------------------------------------

async def test_delete_staff_soft_deactivates(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Ida", pin="1112", phone="0811120001", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.delete(f"/api/v1/hr/staff/{member.id}", headers=_headers(token))
    assert resp.status_code == 204

    list_resp = await client.get("/api/v1/hr/staff", headers=_headers(token))
    ids = [s["id"] for s in list_resp.json()]
    assert member.id not in ids


async def test_delete_staff_barista_returns_403(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.delete(f"/api/v1/hr/staff/{manager_a.id}", headers=_headers(token))
    assert resp.status_code == 403
