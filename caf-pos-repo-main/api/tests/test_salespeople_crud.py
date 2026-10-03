"""CRUD route tests for the salespeople module.

Covers POST/PATCH/DELETE /salespeople added for frontend management:
  - create (success, duplicate-name conflict, role gating)
  - update (rename, deactivate/reactivate, duplicate conflict, 404, cross-store)
  - delete (soft-delete, drops from list, 404)
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sales import Salesperson

# ---------- helpers ----------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _manager(client, store_a) -> dict[str, str]:
    return _headers(await _login(client, store_a.slug, "2222"))


async def make_salesperson(
    db: AsyncSession, *, store_id: str, name: str = "Test Sales", is_active: bool = True
) -> Salesperson:
    sp = Salesperson(store_id=store_id, name=name, is_active=is_active)
    db.add(sp)
    await db.commit()
    await db.refresh(sp)
    return sp


# ---------- create ----------


async def test_create_salesperson(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    resp = await client.post("/api/v1/salespeople", json={"name": "New Seller"}, headers=hdrs)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "New Seller"
    assert body["is_active"] is True
    assert body["id"]

    row = (await db.execute(select(Salesperson).where(Salesperson.id == body["id"]))).scalar_one()
    assert row.store_id == store_a.id


async def test_create_salesperson_duplicate_name_conflict(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    await make_salesperson(db, store_id=store_a.id, name="Dup Seller")

    resp = await client.post("/api/v1/salespeople", json={"name": "Dup Seller"}, headers=hdrs)
    assert resp.status_code == 409, resp.text


async def test_create_salesperson_blank_name_422(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    resp = await client.post("/api/v1/salespeople", json={"name": ""}, headers=hdrs)
    assert resp.status_code == 422, resp.text


async def test_create_salesperson_forbidden_for_barista(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")  # BARISTA
    resp = await client.post("/api/v1/salespeople", json={"name": "Nope"}, headers=_headers(token))
    assert resp.status_code == 403, resp.text


# ---------- update ----------


async def test_update_salesperson_rename(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    sp = await make_salesperson(db, store_id=store_a.id, name="Old Name")

    resp = await client.patch(f"/api/v1/salespeople/{sp.id}", json={"name": "New Name"}, headers=hdrs)
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "New Name"


async def test_update_salesperson_deactivate_and_reactivate(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    sp = await make_salesperson(db, store_id=store_a.id, name="Toggle")

    resp = await client.patch(f"/api/v1/salespeople/{sp.id}", json={"is_active": False}, headers=hdrs)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False

    resp = await client.patch(f"/api/v1/salespeople/{sp.id}", json={"is_active": True}, headers=hdrs)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is True


async def test_update_salesperson_duplicate_name_conflict(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    await make_salesperson(db, store_id=store_a.id, name="Taken")
    target = await make_salesperson(db, store_id=store_a.id, name="Renamable")

    resp = await client.patch(f"/api/v1/salespeople/{target.id}", json={"name": "Taken"}, headers=hdrs)
    assert resp.status_code == 409, resp.text


async def test_update_salesperson_404_unknown(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    resp = await client.patch("/api/v1/salespeople/nonexistent_id_00000000", json={"name": "X"}, headers=hdrs)
    assert resp.status_code == 404, resp.text


async def test_update_salesperson_404_cross_store(client, db, store_a, store_b, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    sp_b = await make_salesperson(db, store_id=store_b.id, name="Store-B Seller")

    resp = await client.patch(f"/api/v1/salespeople/{sp_b.id}", json={"name": "Hijack"}, headers=hdrs)
    assert resp.status_code == 404, resp.text


# ---------- delete ----------


async def test_delete_salesperson_soft_deletes_and_drops_from_list(client, db, store_a, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    sp = await make_salesperson(db, store_id=store_a.id, name="Doomed")

    resp = await client.delete(f"/api/v1/salespeople/{sp.id}", headers=hdrs)
    assert resp.status_code == 204, resp.text

    # Soft-deleted: row still exists but is inactive
    await db.refresh(sp)
    assert sp.is_active is False

    # No longer in the active list
    resp = await client.get("/api/v1/salespeople", headers=hdrs)
    assert sp.id not in [s["id"] for s in resp.json()]


async def test_delete_salesperson_404_cross_store(client, db, store_a, store_b, manager_a) -> None:
    hdrs = await _manager(client, store_a)
    sp_b = await make_salesperson(db, store_id=store_b.id, name="Store-B Doomed")

    resp = await client.delete(f"/api/v1/salespeople/{sp_b.id}", headers=hdrs)
    assert resp.status_code == 404, resp.text


async def test_delete_salesperson_forbidden_for_barista(client, db, store_a, user_a) -> None:
    token = await _login(client, store_a.slug, "1111")  # BARISTA
    sp = await make_salesperson(db, store_id=store_a.id, name="Protected")

    resp = await client.delete(f"/api/v1/salespeople/{sp.id}", headers=_headers(token))
    assert resp.status_code == 403, resp.text
