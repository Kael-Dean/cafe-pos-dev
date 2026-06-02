# Unit Price Per Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `unit_price` from ingredient creation to receipt lot addition, so cost is captured per-bill rather than fixed at ingredient setup time.

**Architecture:** `StockLotCreate` gains a required `unit_price` field; `add_lot` computes `cost_per_unit = unit_price / item.unit_size` per lot. `InventoryItemCreate` drops `unit_price` and initialises `cost_per_unit` to `0` (updated to real cost on first receipt confirm). `StockLotRead` back-computes and exposes `unit_price = cost_per_unit × unit_size` so the frontend can display the pack price paid per bill.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.x async, Pydantic v2, pytest-asyncio

---

## Files

| Action | Path |
|--------|------|
| Modify | `api/app/schemas/receipts.py` |
| Modify | `api/app/services/receipts.py` |
| Modify | `api/app/schemas/inventory.py` |
| Modify | `api/app/services/inventory.py` |
| Modify | `api/tests/test_receipts_api.py` |
| Modify | `api/tests/test_inventory_api.py` |
| Modify | `api/tests/conftest.py` |

No migration needed — `InventoryItem.unit_price` is already `nullable=True`; we simply stop writing to it.

---

## Task 1: Update receipt tests to require `unit_price` in lot payloads

**Files:**
- Modify: `api/tests/test_receipts_api.py`

- [ ] **Step 1: Update `test_add_lot_to_draft`**

Replace the `make_item` call and lot payload in `test_add_lot_to_draft`:

```python
async def test_add_lot_to_draft(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(
        db, store_id=store_a.id, name="Milk-Lot", stock=Decimal("0"),
        unit_size=Decimal("2"),
    )

    receipt_resp = await client.post(
        "/api/v1/receipts",
        headers=_headers(token),
        json={"received_at": "2026-05-14"},
    )
    receipt_id = receipt_resp.json()["id"]

    resp = await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={
            "inventory_item_id": item.id,
            "qty_packs": "5",
            "unit_price": "170.00",
            "expiry_date": "2026-06-15",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert len(data["lots"]) == 1
    assert Decimal(data["lots"][0]["qty_packs"]) == Decimal("5")
    assert Decimal(data["lots"][0]["qty_received"]) == Decimal("10")  # 5 packs × 2 units
    assert Decimal(data["lots"][0]["unit_price"]) == Decimal("170.00")
    assert Decimal(data["lots"][0]["cost_per_unit"]) == Decimal("85.0000")
    assert data["lots"][0]["expiry_date"] == "2026-06-15"
```

- [ ] **Step 2: Update `test_confirm_receipt_increments_stock`**

```python
async def test_confirm_receipt_increments_stock(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(
        db, store_id=store_a.id, name="Beans-Confirm", stock=Decimal("0"),
        unit_size=Decimal("3"),
    )

    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]

    await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "4", "unit_price": "255.00"},
    )

    resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "CONFIRMED"

    inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_headers(token))
    assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("12")  # 4 packs × 3 units
```

- [ ] **Step 3: Update tests that add lots incidentally (not testing cost)**

These tests use `make_item` with default `unit_size=1` and add lots to test other behaviour (confirm idempotency, remove lot, get lots, FIFO). Add `unit_price` to every lot payload and remove `unit_price`/`cost` kwargs from `make_item` calls.

`test_confirm_already_confirmed_returns_409` — the lot add at lines ~124-127:
```python
await client.post(
    f"/api/v1/receipts/{receipt_id}/lots",
    headers=_headers(token),
    json={"inventory_item_id": item.id, "qty_packs": "5", "unit_price": "10.00"},
)
```

`test_add_lot_to_confirmed_returns_409` — both lot adds:
```python
# first lot (before confirm)
json={"inventory_item_id": item.id, "qty_packs": "5", "unit_price": "10.00"},

# second lot (after confirm, expects 409)
json={"inventory_item_id": item2.id, "qty_packs": "3", "unit_price": "10.00"},
```

`test_remove_lot_from_draft`:
```python
json={"inventory_item_id": item.id, "qty_packs": "5", "unit_price": "10.00"},
```

`test_get_item_lots`:
```python
json={"inventory_item_id": item.id, "qty_packs": "8", "unit_price": "10.00"},
```

- [ ] **Step 4: Update `test_fifo_deducts_oldest_lot_first`**

Remove `unit_price`/`cost` from `make_item`, add `unit_price` to both lot payloads:

```python
async def test_fifo_deducts_oldest_lot_first(client, db, store_a, manager_a):
    """Confirm two lots then place a simulated deduction — oldest lot consumed first."""
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(
        db, store_id=store_a.id, name="FIFO-Milk", stock=Decimal("0"),
        unit_size=Decimal("1"),
    )

    # Receipt 1 (older) — 4 packs × 1 = 4 units
    r1 = await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-01"})
    r1_id = r1.json()["id"]
    await client.post(f"/api/v1/receipts/{r1_id}/lots", headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "4", "unit_price": "80.00"})
    await client.post(f"/api/v1/receipts/{r1_id}/confirm", headers=_headers(token))

    # Receipt 2 (newer) — 6 packs × 1 = 6 units
    r2 = await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-10"})
    r2_id = r2.json()["id"]
    await client.post(f"/api/v1/receipts/{r2_id}/lots", headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "6", "unit_price": "80.00"})
    await client.post(f"/api/v1/receipts/{r2_id}/confirm", headers=_headers(token))

    # Verify total stock = 10
    inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_headers(token))
    assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("10.000")

    # Directly call _deduct_fifo to consume 5 units
    from app.services.orders import _deduct_fifo
    async with db.begin():
        await _deduct_fifo(
            db,
            store_id=store_a.id,
            user_id=manager_a.id,
            inventory_item_id=item.id,
            total_qty=Decimal("5"),
            ref_order_id="test_order_id",
            order_number=999,
        )

    # Fetch lots and check FIFO: older lot (4 units) fully consumed, newer lot (6-1=5 remaining)
    lots_resp = await client.get(f"/api/v1/inventory/{item.id}/lots?status=all", headers=_headers(token))
    lots = sorted(lots_resp.json(), key=lambda x: x["created_at"])
    assert Decimal(lots[0]["qty_remaining"]) == Decimal("0.000")   # older lot exhausted
    assert Decimal(lots[1]["qty_remaining"]) == Decimal("5.000")   # newer lot: 6 - 1 consumed
```

- [ ] **Step 5: Run receipt tests — expect failures**

```bash
cd api && uv run pytest tests/test_receipts_api.py -v
```

Expected: failures on `test_add_lot_to_draft` (missing `unit_price` in response, `unit_price` rejected by schema), and on any test where `make_item` no longer receives `unit_price`/`cost` kwargs (TypeError if signature hasn't been updated yet — but `make_item` still has defaults, so kwargs being removed from call sites is fine).

The key failures will be:
- `unit_price` not in `data["lots"][0]` (KeyError / assertion error)
- `StockLotCreate` rejects `unit_price` as extra field OR silently ignores it, causing `cost_per_unit` to be wrong

---

## Task 2: Update receipt schemas

**Files:**
- Modify: `api/app/schemas/receipts.py`

- [ ] **Step 1: Add `unit_price` to `StockLotCreate` and `StockLotRead`**

Replace the two classes:

```python
class StockLotCreate(BaseModel):
    inventory_item_id: str
    qty_packs: Decimal = Field(gt=0, le=Decimal("999999.999"))
    unit_price: Decimal = Field(gt=0, le=Decimal("99999.99"))
    expiry_date: date | None = None


class StockLotRead(_Cfg):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    qty_packs: Decimal
    qty_received: Decimal
    qty_remaining: Decimal
    unit_price: Decimal
    cost_per_unit: Decimal
    expiry_date: date | None
    created_at: datetime
```

---

## Task 3: Update `add_lot` service

**Files:**
- Modify: `api/app/services/receipts.py:119-154`

- [ ] **Step 1: Compute `cost_per_unit` from payload, simplify error guard**

Replace the `add_lot` function body after the receipt/item load:

```python
async def add_lot(
    db: AsyncSession,
    *,
    store_id: str,
    receipt_id: str,
    payload: StockLotCreate,
) -> StockReceiptRead:
    async with db.begin():
        receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
        _require_draft(receipt)

        item_result = await db.execute(
            select(InventoryItem).where(
                InventoryItem.id == payload.inventory_item_id,
                InventoryItem.store_id == store_id,
            )
        )
        item = item_result.scalar_one_or_none()
        if item is None:
            raise NotFound("Inventory item not found")
        if item.unit_size is None:
            raise Unprocessable("ITEM_MISSING_UNIT_SIZE")

        cost_per_unit = payload.unit_price / item.unit_size
        qty_received = payload.qty_packs * item.unit_size

        lot = StockLot(
            store_id=store_id,
            receipt_id=receipt.id,
            inventory_item_id=payload.inventory_item_id,
            qty_received=qty_received,
            qty_remaining=qty_received,
            cost_per_unit=cost_per_unit,
            expiry_date=payload.expiry_date,
        )
        db.add(lot)
    return await _receipt_to_read(db, receipt)
```

---

## Task 4: Back-compute `unit_price` in read helpers

**Files:**
- Modify: `api/app/services/receipts.py:278-313` (`_receipt_to_read`)
- Modify: `api/app/services/receipts.py:222-252` (`list_item_lots`)

- [ ] **Step 1: Update `_receipt_to_read`**

Replace the `lots` list comprehension inside `_receipt_to_read`:

```python
lots = [
    StockLotRead(
        id=lot.id,
        inventory_item_id=lot.inventory_item_id,
        inventory_item_name=item_name,
        qty_packs=lot.qty_received / unit_size if unit_size else lot.qty_received,
        qty_received=lot.qty_received,
        qty_remaining=lot.qty_remaining,
        unit_price=lot.cost_per_unit * unit_size if unit_size else lot.cost_per_unit,
        cost_per_unit=lot.cost_per_unit,
        expiry_date=lot.expiry_date,
        created_at=lot.created_at,
    )
    for lot, item_name, unit_size in rows
]
```

- [ ] **Step 2: Update `list_item_lots`**

Replace the return list comprehension inside `list_item_lots`:

```python
return [
    StockLotRead(
        id=lot.id,
        inventory_item_id=lot.inventory_item_id,
        inventory_item_name=item_name,
        qty_packs=lot.qty_received / unit_size if unit_size else lot.qty_received,
        qty_received=lot.qty_received,
        qty_remaining=lot.qty_remaining,
        unit_price=lot.cost_per_unit * unit_size if unit_size else lot.cost_per_unit,
        cost_per_unit=lot.cost_per_unit,
        expiry_date=lot.expiry_date,
        created_at=lot.created_at,
    )
    for lot, item_name, unit_size in rows
]
```

- [ ] **Step 3: Run receipt tests — expect pass**

```bash
cd api && uv run pytest tests/test_receipts_api.py -v
```

Expected: all receipt tests pass.

- [ ] **Step 4: Commit receipt changes**

```bash
git add api/app/schemas/receipts.py api/app/services/receipts.py api/tests/test_receipts_api.py
git commit -m "feat: unit_price captured per receipt lot, not at ingredient creation"
```

---

## Task 5: Update inventory creation tests

**Files:**
- Modify: `api/tests/test_inventory_api.py`

- [ ] **Step 1: Rewrite `test_create_item_computes_cost_per_unit`**

Rename the test and remove `unit_price` from payload; `cost_per_unit` is now `0` at creation:

```python
async def test_create_item_stores_unit_size(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.post(
        "/api/v1/inventory",
        headers=_headers(token),
        json={"name": "Whole Milk 2L", "unit": "ml", "unit_size": "2000"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Whole Milk 2L"
    assert body["unit"] == "ml"
    assert Decimal(body["unit_size"]) == Decimal("2000")
    assert Decimal(body["cost_per_unit"]) == Decimal("0")
```

- [ ] **Step 2: Update `test_create_item_duplicate_name_returns_409`**

Remove `unit_price` from payload:

```python
async def test_create_item_duplicate_name_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload = {"name": "Sugar 1kg", "unit": "g", "unit_size": "1000"}
    await client.post("/api/v1/inventory", headers=_headers(token), json=payload)
    resp = await client.post("/api/v1/inventory", headers=_headers(token), json=payload)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFLICT"
```

- [ ] **Step 3: Update `test_create_item_barista_returns_403`**

Remove `unit_price` from payload:

```python
async def test_create_item_barista_returns_403(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/inventory",
        headers=_headers(token),
        json={"name": "Oat Milk 1L", "unit": "ml", "unit_size": "1000"},
    )
    assert resp.status_code == 403
```

- [ ] **Step 4: Run inventory tests — expect failures on the creation tests**

```bash
cd api && uv run pytest tests/test_inventory_api.py -v
```

Expected: `test_create_item_stores_unit_size` fails because `InventoryItemCreate` still requires `unit_price` (payload missing it → 422 validation error).

---

## Task 6: Update `InventoryItemCreate` schema and `create_item` service

**Files:**
- Modify: `api/app/schemas/inventory.py:44-50`
- Modify: `api/app/services/inventory.py:45-54`

- [ ] **Step 1: Remove `unit_price` from `InventoryItemCreate`**

```python
class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(min_length=1, max_length=24)
    unit_size: Decimal = Field(gt=0, le=Decimal("9999999.999"))
    par_level: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("9999999.999"))
    is_active: bool = True
```

- [ ] **Step 2: Update `create_item` service — default `cost_per_unit` to `0`, stop writing `unit_price`**

```python
item = InventoryItem(
    store_id=store_id,
    name=payload.name,
    unit=payload.unit,
    par_level=payload.par_level,
    cost_per_unit=Decimal("0"),
    is_active=payload.is_active,
    unit_size=payload.unit_size,
)
```

- [ ] **Step 3: Run inventory tests — expect pass**

```bash
cd api && uv run pytest tests/test_inventory_api.py -v
```

Expected: all inventory tests pass.

---

## Task 7: Update `make_item` fixture and run full suite

**Files:**
- Modify: `api/tests/conftest.py:196-222`

- [ ] **Step 1: Remove `unit_price` and `cost` params from `make_item`**

```python
async def make_item(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Beans",
    unit: str = "g",
    unit_size: Decimal = Decimal("1"),
    stock: Decimal = Decimal("100"),
    par: Decimal = Decimal("80"),
    is_active: bool = True,
) -> InventoryItem:
    item = InventoryItem(
        store_id=store_id,
        name=name,
        unit=unit,
        unit_size=unit_size,
        cost_per_unit=Decimal("0"),
        stock_on_hand=stock,
        par_level=par,
        is_active=is_active,
    )
    db.add(item)
    await db.commit()
    return item
```

- [ ] **Step 2: Run full test suite**

```bash
cd api && uv run pytest -v
```

Expected: all tests pass.

- [ ] **Step 3: Commit remaining changes**

```bash
git add api/app/schemas/inventory.py api/app/services/inventory.py api/tests/test_inventory_api.py api/tests/conftest.py
git commit -m "feat: remove unit_price from ingredient creation — price captured per receipt"
```
