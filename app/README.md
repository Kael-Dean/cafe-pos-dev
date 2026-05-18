# Kafé OS — POS Frontend

Next.js 15 front-end for the Kafé OS cafe point-of-sale system. Connects to the FastAPI backend in `../caf-pos-repo-main/api`.

## Stack

- **Next.js 15** (App Router, client components)
- **React Query** (`@tanstack/react-query`) for server state
- **Prisma** (local dev DB / migrations)
- **pnpm** workspaces

## Getting Started

```bash
# From repo root
pnpm --filter app dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_BASE_URL` to your backend URL.

## Screens

| Screen | Route key | Role |
|--------|-----------|------|
| POS Terminal | `pos` | All |
| Kitchen (KDS) | `kds` | All |
| Dashboard | `dashboard` | All |
| BOM Builder | `bom` | All |
| Inventory | `inventory` | All |
| Pre-Orders | `pre-orders` | All |
| Shopping List | `shopping-list` | All |
| Cash Reconciliation | `cash` | OWNER / MANAGER |
| Promotions | `promotions` | All |
| Protocols / SOP | `protocols` | All |
| ตารางกะ | `shifts` | All |
| HR & Admin | `hr` | OWNER / MANAGER |
| Hardware | `hardware` | All |
| Catalog Admin | `catalog` | **OWNER only** |
| Settings | `settings` | All |

## Catalog Admin

OWNER-only page (`catalog`) for managing:
- **หมวดหมู่ (Categories)** — create, rename, re-sort, delete. Feeds the "หมวดหมู่" dropdown in the New Menu dialog.
- **กลุ่มตัวเลือก (Modifier Groups)** — create groups with child modifier options, edit flags (`required`, `min_select`, `max_select`), bulk-replace modifiers on save. Feeds the "เปลี่ยนตัวเลือก" picker in BOM Builder and the POS options modal.

## Project Structure

```
app/src/
  app/          Next.js app router (page.tsx is the single-page root)
  components/
    screens/    One file per screen
    app-common  Sidebar, ToastProvider, shared UI helpers
    icons       Icon component
  hooks/        React Query hooks (one file per domain)
  lib/
    api-client  Typed fetch wrapper with bearer token
    token-store JWT token storage
```

## API

All requests go to `NEXT_PUBLIC_API_BASE_URL/api/v1/`. The bearer token is stored in `localStorage` via `token-store.ts` and attached automatically by `api-client.ts`.
