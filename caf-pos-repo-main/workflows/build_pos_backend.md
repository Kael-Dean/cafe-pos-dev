# Workflow — Build & Run the Cafe POS Backend

> **For:** Future agent + future engineer
> **What this is:** The single SOP for setting up, running, testing, and deploying the FastAPI backend in [api/](../api/). Update this doc whenever you discover a quirk or change a process.

---

## Objective

Stand up the Cafe POS API locally, verify it works against a real Postgres, run the test suite, and (when ready) deploy to Railway. The backend is a single FastAPI service with two modules wired today: **auth** (PIN → JWT) and **inventory** (8 endpoints).

## Required tools (host)

- Python 3.12+
- [`uv`](https://astral.sh/uv) (Python package manager)
- Docker (for local Postgres)
- `psql` or pgAdmin (optional, for inspection)
- Git

## Inputs

- A running Postgres instance (local Docker container or Railway plugin)
- A populated `.env` (see `.env.example` in [api/](../api/.env.example))

## Steps

### 1. Boot Postgres locally

```bash
docker run -d --name cafe-pos-pg \
  -e POSTGRES_PASSWORD=pos \
  -p 5432:5432 \
  postgres:16
```

Create the dev and test databases:

```bash
docker exec -it cafe-pos-pg psql -U postgres -c 'CREATE DATABASE cafe_pos;'
docker exec -it cafe-pos-pg psql -U postgres -c 'CREATE DATABASE cafe_pos_test;'
```

### 2. Install dependencies

```bash
cd api
uv sync
```

`uv sync` reads `pyproject.toml`, resolves the lockfile, and installs into `.venv/`.

### 3. Configure environment

```bash
cp .env.example .env
# Required edits:
#   JWT_SECRET=$(openssl rand -hex 32)   # any 32+ byte hex
# Defaults work for the local Docker Postgres above.
```

### 4. Apply migrations

```bash
uv run alembic upgrade head
```

The initial migration `0001_initial.py` creates: `tenants`, `stores`, `users`, `inventory_items`, `stock_movements`, plus the `role` and `movement_type` Postgres enum types.

### 5. Seed dev data

```bash
uv run python scripts/seed.py
```

Creates 1 tenant (`cafe-co`), 1 store (`sukhumvit-49`), 5 users, 22 inventory items. **Idempotent** — safe to re-run.

| Name | Role | PIN |
|---|---|---|
| Tan | OWNER | 1234 |
| Ploy | MANAGER | 1234 |
| Nat | BARISTA | 1111 |
| Mint | BARISTA | 2222 |
| Jay | BARISTA | 3333 |

### 6. Run the dev server

```bash
uv run uvicorn app.main:app --reload --port 8000
```

- OpenAPI: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>
- All routes prefixed `/api/v1`

### 7. Smoke test from `/docs`

1. `POST /api/v1/auth/login` body `{"store_slug": "sukhumvit-49", "pin": "1111"}` → copy the `access_token`.
2. Click **Authorize** in `/docs`, paste `Bearer <access_token>` (or just the token; the helper handles both).
3. `GET /api/v1/inventory` returns 22 seeded items, each with a computed `status` (`ok`/`low`/`critical`).
4. `POST /api/v1/inventory/receive` with one of the item ids → stock increments.
5. `GET /api/v1/inventory/movements` shows the new `RECEIVE` event.

### 8. Run the test suite

```bash
uv run pytest -q
```

Tests connect to `cafe_pos_test` (or `TEST_DATABASE_URL` if set). The conftest creates all tables once per session and `TRUNCATE`s between tests.

> [!warning] Pytest needs a local (non-SSL) Postgres
> On Windows, `pytest-asyncio` + `asyncpg`'s SSL teardown sequence races during
> per-test event-loop disposal, surfacing as `Event loop is closed` /
> `Future attached to a different loop` during fixture teardown. The fix is to
> point `TEST_DATABASE_URL` at a **local non-SSL Postgres** — e.g. the Docker
> container in step 1, or a Railway *plugin* DB attached to a Railway service
> (where SSL is not enforced from inside the network). Running pytest against a
> remote SSL-only Postgres from a Windows host is known-flaky and not worth
> chasing. CI on Linux usually works without this constraint.

To check coverage on the service layer:

```bash
uv run pytest --cov=app/services --cov-report=term-missing
```

### 9. Deploy to Railway

Railway auto-detects via Nixpacks; configuration lives in `api/railway.toml` and `api/Procfile`.

1. Create a Railway project and link the repo. Set the **service root** to `api/`.
2. Add a **PostgreSQL plugin** (separate service in the same project).
3. Set service env vars:
   - `DATABASE_URL` — copy from the Postgres plugin's connection string. **Replace `postgresql://` with `postgresql+asyncpg://`** so the async driver kicks in.
   - `JWT_SECRET` — 32+ byte hex.
   - `CORS_ORIGINS` — your Vercel frontend origin.
   - `ENVIRONMENT=production`
   - `LOG_LEVEL=INFO`
   - Pusher creds — leave blank until KDS scope arrives.
4. Deploy. The release command (`alembic upgrade head`) runs before the web container takes traffic.
5. Verify `<service>.up.railway.app/health` returns `{"status": "ok"}`.
6. (Optional) Run the seed once on the prod DB:
   ```bash
   railway run python scripts/seed.py
   ```

---

## Adding a new migration

```bash
# Make model edits in app/models/*, then:
uv run alembic revision --autogenerate -m "describe_change"
# Inspect the generated file in alembic/versions/ — autogenerate misses renames,
# enum value changes, and server defaults. Edit by hand if needed.
git add alembic/versions/<file>.py
uv run alembic upgrade head
```

**Never edit a committed migration.** Create a new one.

---

## Known gotchas

- **`store_id` is read from JWT, never from request body.** Cross-store access returns `404` (do not leak with `403`). Enforced at the service layer via `WHERE store_id = current_user.store_id`.
- **Negative stock is allowed.** Real-world receipts often arrive after sales. Service emits a `WARNING` log line; no block.
- **Latest-cost-wins on receive.** Each `RECEIVE` overwrites `cost_per_unit`. Phase 2 may switch to weighted-average — flag in [resources/BACKEND_HANDOFF.md](../resources/BACKEND_HANDOFF.md) §10 #4.
- **Wastage reason encoding.** Stored as a single `TEXT`: `"<CODE>|<note>"` for `WASTE`, `"RECEIVE|supplier=X;note=Y"` for `RECEIVE`, `"ADJUST±|<reason>"` for `ADJUST`. Decoded into structured fields on read in `_decode_movement_reason()`.
- **`async with db.begin():`** must wrap every mutation. Don't sprinkle individual `db.commit()` calls — they bypass the rollback-on-exception guarantee.
- **`StockMovement` is append-only.** No service method updates or deletes one. Errors are corrected via a compensating `ADJUST`.
- **Inactive items reject receive/waste/adjust** with `409 CONFLICT`.
- **Async driver only.** `DATABASE_URL` MUST start with `postgresql+asyncpg://`. The config validator rejects sync URLs.
- **Rate limit on login** is global per-IP (slowapi in-memory). On Railway with a single replica this is fine; if scaled out, swap to Redis storage.

---

## Self-improvement loop

When something breaks:

1. Read the full error and trace.
2. Fix the underlying issue (not a bypass).
3. Add a regression test in [api/tests/](../api/tests/).
4. Update this workflow if the gotcha is non-obvious.

---

## Outputs (where to find things)

- **Source:** [api/app/](../api/app/)
- **Migrations:** [api/alembic/versions/](../api/alembic/versions/)
- **Tests:** [api/tests/](../api/tests/)
- **Reference UI:** prototype lives in [resources/BACKEND_HANDOFF.md](../resources/BACKEND_HANDOFF.md) §1 (not yet checked in locally)
- **Human docs:** Obsidian vault at `G:\Other computers\My Computer\obsidian\POS`
- **Route priority list (all 7 modules):** [workflows/route_priorities.md](route_priorities.md)
