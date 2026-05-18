# Cafe POS Prototype

Source: Claude Design (claude.ai/design) — exported 2026-04-28

## How to run

The HTML loads JSX files via `<script type="text/babel" src="...">`. Browsers block this over `file://` for security, so you need a local HTTP server.

### Option 1: Python (simplest, no install on most systems)
```bash
cd d:/POS/prototype
python -m http.server 8000
```
Then open: <http://localhost:8000/Cafe%20POS%20Prototype.html>

### Option 2: Node.js
```bash
npx serve d:/POS/prototype
```

### Option 3: VS Code Live Server
1. Install "Live Server" extension by Ritwick Dey
2. Right-click `Cafe POS Prototype.html` → "Open with Live Server"

## What works (per design chat — Phase P0)

- **POS Terminal** — full Flow A: tap menu → modifier modal → cart update → QR PromptPay payment → success → reset
- **KDS** — order ticket grid with timer (yellow ≥5min, red ≥10min), Bump/Done flow
- **Dashboard** — KPI cards, hourly sales chart, top items, live orders, low stock alerts
- **Sidebar navigation** — switch between all 7 screens

## What's a placeholder (P1)

- Inventory, Customers, Reports, Settings — layout preview only

## File structure

```
prototype/
├── Cafe POS Prototype.html  ← entry point
├── tokens.css               ← design system (colors, type, spacing)
├── data.js                  ← mock data (menu, orders, customers)
├── icons.jsx                ← Lucide-style icon set
├── app-common.jsx           ← shared components (Sidebar, Toast, KPICard, etc.)
├── app.jsx                  ← root + screen routing
└── screens/
    ├── pos.jsx              ← POS Terminal
    ├── modifier-modal.jsx
    ├── payment-modal.jsx
    ├── kds.jsx
    ├── dashboard.jsx
    └── placeholders.jsx     ← Inventory/Customers/Reports/Settings stubs
```

## Tech notes

- React 18 + Babel Standalone via CDN — no build step
- For production, this should be ported to Next.js + tRPC + Prisma per `../POS_BUILD_PROMPT.md`
