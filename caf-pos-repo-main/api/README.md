# Cafe POS API

FastAPI backend for Cafe POS. See [`workflows/build_pos_backend.md`](../workflows/build_pos_backend.md) for the full SOP.

## 30-second setup

```bash
# 1. Postgres up (any way you like)
docker run -d --name cafe-pos-pg -e POSTGRES_PASSWORD=pos -p 5432:5432 postgres:16

# 2. Deps
uv sync

# 3. Env
cp .env.example .env   # fill in JWT_SECRET; defaults work for local Postgres

# 4. Migrate + seed
uv run alembic upgrade head
uv run python scripts/seed.py

# 5. Run
uv run uvicorn app.main:app --reload --port 8000
# OpenAPI: http://localhost:8000/docs
```

## Layout

- `app/main.py` — FastAPI app, JSON logging, exception envelope, `/health`
- `app/api/v1/` — thin routers (auth, inventory)
- `app/services/` — business logic (no FastAPI imports)
- `app/models/` — SQLAlchemy 2.x `Mapped[...]` models
- `app/schemas/` — Pydantic v2 request/response models
- `alembic/` — migrations (async-aware `env.py`)
- `scripts/seed.py` — idempotent seed for local dev / staging
- `tests/` — pytest + httpx + factory_boy

## Conventions

- `store_id` always read from JWT, never request payload
- Atomic mutations: `async with db.begin():`
- Decimal precision: money 2dp · inventory 3dp · cost 4dp
- Append-only `StockMovement` (corrections via compensating `ADJUST`)
- Negative stock allowed (warn, don't block)
