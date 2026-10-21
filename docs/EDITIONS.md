# Editions monorepo — Kafé OS café + board-game

Two sellable editions share one core. Owner decisions (final):

- `apps/cafe` + `apps/boardgame` + `packages/pos-core`, built in the dev repo first.
- The table / session / bill system is **core**, switched on per store by feature
  (`self_ordering` for mr.bar-style bars, `vertical.boardgame` for board-game cafés).
- The board-game app adds board-game-only things on top: time billing (rate plans with
  hourly charge), the table-time product rules, and later lending, reservations, game
  library and a board-game report.

## 1. Layout

```
package.json            npm workspaces root + turbo scripts (no app code)
turbo.json              task graph: build / typecheck / lint / test (+ transit node)
package-lock.json       single lockfile for every workspace
vercel.json             keeps the EXISTING Vercel project (root dir = repo root) building apps/cafe
packages/pos-core/      @pos/core — TypeScript source, no build step (Next transpiles it)
  edition/              the edition contract: types.ts, nav.ts (CORE_NAV + visibility rules),
                        core-screens.tsx (CORE_SCREENS, lazyScreen), define.ts, context.tsx
  shell/                pos-app.tsx (login gate + shell), root-document.tsx, metadata.ts, providers.tsx
  components/           screens/, ui/, pwa/, app-common.tsx, mobile-nav.tsx, layout.tsx, icons.tsx
  hooks/  lib/          data hooks, api-client, i18n, theme, motion, money, printer bridge …
  lib/server/           BFF: bff.ts, session.ts, csp.ts, proxy.ts, routes/*.ts (route handlers)
  styles/globals.css    design tokens + Tailwind entry (declares @source for core)
  public/               shared static assets (sw.js, offline.html, icons, logo, ePOS SDK)
  next-config.mjs       createNextConfig(): security headers, image allowlist, monorepo roots
  scripts/              sync-public.mjs (bin: pos-sync-public), PWA icon + receipt logo generators
apps/cafe/              @pos/cafe — café edition (Next 16 app)
  src/edition/          brand.ts (server-safe), nav.ts, index.tsx (EditionConfig), nav.test.ts
  src/app/              layout.tsx, page.tsx, manifest.ts, favicon.ico, api/** (thin re-exports)
  src/proxy.ts          Next 16 proxy wrapper + literal matcher (proxy-matcher.test.ts)
  e2e/                  Playwright specs + support (fake upstream, MockApi, seed)
apps/boardgame/         @pos/boardgame — board-game edition
  src/tables/           rate-plans-section.tsx, rate-plan-billing.tsx, table-time.ts
  src/hooks/            use-rate-plans.ts
  src/screens/          planned.tsx (placeholder screens for the reserved slots)
bridge/ docs/ …         unchanged
```

`apps/*/public/` is **generated** (gitignored) by `pos-sync-public`, which runs in
`predev` / `prebuild`. Edit assets in `packages/pos-core/public/`. An edition that needs
its own asset puts it in `apps/<edition>/public-overrides/` (copied on top).

### Why npm workspaces (not pnpm)

Vercel installs with npm today (`vercel.json` `installCommand`), `pnpm-workspace.yaml` in
the old `app/` had no `packages` key (it was not a real workspace), and no lockfile was
committed at all. npm workspaces work with zero new tooling on the build machines; Turborepo
runs on top of npm for caching / parallel tasks. The stale `app/pnpm-lock.yaml` and
`app/pnpm-workspace.yaml` were removed and one root `package-lock.json` is committed
(it contains the Linux native binaries Vercel needs: `@next/swc-linux-x64-gnu`,
`lightningcss-linux-x64-gnu`, `@tailwindcss/oxide-linux-x64-gnu`).

## 2. The edition contract

```ts
// packages/pos-core/edition/types.ts
interface EditionConfig {
  id: string;                    // 'cafe' | 'boardgame'
  displayName: string;           // login title, <title>, PWA name
  shortName: string;             // PWA short_name
  description: string;           // PWA / meta description
  nav: readonly NavItem[];       // composed nav (headers + items)
  screens: ScreenRegistry;       // screen id -> ComponentType<{ navigate(id) }>
  defaultScreen?: string;        // default 'pos'
  features: readonly string[];   // store feature keys this edition ships UI for (informational)
  productRules?: readonly ProductRule[];   // hiddenFromSale / systemManaged / hiddenFromRecipes
  tables?: TableBillingExtension;          // SetupSection + useOpenSessionBilling hook
}
```

Two layers decide what a user sees:

| Layer | When | Where |
|---|---|---|
| Edition composition | build time | `apps/<edition>/src/edition/{nav.ts,index.tsx}` — which screens / items / plugins ship |
| Store + role gating | runtime | `visibleNavSections(nav, role, features)` in `edition/nav.ts` (`/me/features`, `adminOnly`, `ownerOnly`, `feature`) — and inside each screen |

`NavItem.feature` may be a string or an array (any-of). Core table items use
`TABLE_FEATURES = ['vertical.boardgame', 'self_ordering']`.

`defineEdition()` throws at module load (so in `next build` and in the unit tests) when a
nav item has no screen, an id repeats, or `defaultScreen` is not registered.

Core ↔ edition seams that replaced hard-coded board-game logic:

| Before (single app) | Now |
|---|---|
| `page.tsx` held `tableSession` state and passed `session` / `onClearSession` to POS, `onOrderForSession` to Floor | `TableTabProvider` / `useTableTab()` (`hooks/use-table-tab.tsx`), mounted by the shell inside the logged-in tree |
| POS / catalog / BOM compared `p.name === TABLE_TIME_PRODUCT_NAME` | `useProductRules()`; the board-game edition supplies `tableTimeProductRule` |
| Rate plans section + modal inside core `table-setup.tsx` | `tables.SetupSection` (boardgame `rate-plans-section.tsx`) |
| Rate-plan picker + "no plan" notice inside the open-table dialog | `tables.useOpenSessionBilling` (boardgame `rate-plan-billing.tsx`) |
| Nav array `NAV` in `app-common.tsx` | `CORE_NAV` in `edition/nav.ts`; editions compose with `insertNav()` |

## 3. Add a screen

**To both editions (core screen)**

1. Create `packages/pos-core/components/screens/<name>.tsx` (default export, accepts
   optional `ScreenProps` if it needs `navigate`).
2. Register it in `CORE_SCREENS` (`packages/pos-core/edition/core-screens.tsx`) with `lazyScreen`.
3. Add the nav item to `CORE_NAV` (`packages/pos-core/edition/nav.ts`) and its label to
   `lib/i18n/th.ts` + `en.ts` (`nav.<id>`).
4. Update `PRE_SPLIT_NAV` in `apps/cafe/src/edition/nav.test.ts` (it pins the café nav).

**To one edition only**

1. Create the screen under `apps/<edition>/src/screens/`.
2. Add a `NavItem` with its own `label: { th, en }` (and `feature` if it is an add-on) in
   `apps/<edition>/src/edition/nav.ts` — usually `insertNav(CORE_NAV, '<after-id or section header>', [...])`.
3. Register it in `screens` in `apps/<edition>/src/edition/index.tsx` with `lazyScreen(() => import('@/screens/<name>'))`.
4. Extend the edition's `nav.test.ts`.

The reserved board-game slots (`bg-lending`, `bg-reservations`, `bg-library`, `bg-report`)
point at placeholder screens in `apps/boardgame/src/screens/planned.tsx` and carry
`soft: true` (the existing "P1" marker). To ship one: build the screen, point its registry
entry at it, drop `soft`.

Imports: in core always `@pos/core/...` (or relative). In an app, `@/...` = that app's `src/`.

## 4. Commands (repo root)

| Command | What |
|---|---|
| `npm install` | install every workspace (one lockfile) |
| `npm run dev:cafe` | café edition on http://127.0.0.1:3000 |
| `npm run dev:boardgame` | board-game edition on http://127.0.0.1:3001 |
| `npm run build` / `build:cafe` / `build:boardgame` | production builds (turbo) |
| `npm run start:cafe` / `start:boardgame` | serve a build (3000 / 3001) |
| `npm run typecheck` / `lint` / `test` | quality gate across core + both apps (turbo, cached) |
| `npm run check` | all four in one go |
| `npm run test:e2e:cafe` | Playwright suite against apps/cafe (builds first; `E2E_SKIP_BUILD=1` to reuse) |

Local env: copy `apps/<edition>/.env.example` to `apps/<edition>/.env.local`.

## 5. Vercel — what the owner must do by hand

Nothing changes until this branch is merged. Then:

**Existing project `cafe-pos` (café edition)** — two options:

- *No settings change*: the root `vercel.json` now installs at the root and builds
  `@pos/cafe` (`outputDirectory: apps/cafe/.next`). It keeps working as-is.
- *Recommended*: Project → Settings → Build & Deployment → **Root Directory = `apps/cafe`**,
  keep "Include files outside the root directory" **on** (it needs `packages/pos-core`).
  `apps/cafe/vercel.json` then drives install/build. Framework preset: Next.js.

**New project for the board-game edition**

1. Vercel → Add New → Project → import the same GitHub repo.
2. Root Directory = **`apps/boardgame`**, "Include files outside the root directory" on,
   framework Next.js (`apps/boardgame/vercel.json` sets install/build).
3. Optional: Ignored Build Step `npx turbo-ignore @pos/boardgame` (and `@pos/cafe` on the café
   project) so a change in one edition does not redeploy the other — core changes still
   deploy both.
4. Own domain (e.g. `bg.<domain>`). Each edition is its own origin, so session cookies, the
   service-worker cache and installed PWAs are separate per edition.

**Environment variables — set per project** (same names in both, see `.env.example`):

| Var | Notes |
|---|---|
| `RAILWAY_API_URL` | backend; both editions use the same FastAPI backend |
| `ALLOWED_ORIGINS` | usually empty (own origin is always allowed) |
| `BRIDGE_TOKEN` | print-bridge shared secret (per shop) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | menu images |
| `NEXT_PUBLIC_APP_NAME` | not read by the code today; product names live in `src/edition/brand.ts` |

**Store provisioning**: a board-game store must have `vertical.boardgame` in its
`feature_keys` (backend) and should be pointed at the board-game deployment. See §8.

## 6. Quality gate

`npm run check` = typecheck + lint + vitest + build for core and both apps. Lint has a
**baseline** in `packages/pos-core/eslint.config.mjs`: ~50 React-Compiler findings
(`react-hooks/set-state-in-effect`, `purity`, `refs`, `static-components`,
`react/no-unescaped-entities`) that already failed `npm run lint` in the pre-split app are
downgraded to warnings for the listed files only. Do not add files to that list; remove a file
once you fix it. `apps/cafe/e2e/visual/perf.capture.ts` has a scoped `no-explicit-any`
disable for the same reason.

Known flaky e2e (fails identically on the pre-split build 28029d8):
`pos-touch.spec.ts › taps while the product detail is still loading are queued, not dropped`.

## 7. Migrating the production repo `D:\POS` later

`D:\POS` (origin `cafe-pos`, the live site) still has the single `app/` layout.
`sync-to-main.ps1` now refuses to copy `apps/…` / `packages/…` files into an old-layout
`D:\POS` (core imports `@pos/core/...`, which the old app cannot resolve).

Recommended once the editions branch is merged to dev `main` and verified on a preview:

1. In `D:\POS`, make sure the working tree is clean and on `main`; create a branch.
2. Bring the dev history over in one step instead of file copies — e.g.
   `git -C D:\POS fetch https://github.com/Kael-Dean/cafe-pos-dev main` and merge (or
   reset the branch to it if prod has no prod-only commits), using the index2 workaround
   from `CLAUDE.md` for the commit.
3. `npm install` at the root, `npm run check`.
4. Merge to `main`. The root `vercel.json` keeps the `cafe-pos` project building without a
   settings change; switch Root Directory to `apps/cafe` when convenient (§5).
5. After that, `sync-to-main.ps1` works with the new paths and typechecks at the root.
6. Update the sync example paths in the root `CLAUDE.md` (`app/src/...` →
   `packages/pos-core/...` / `apps/cafe/...`).

## 8. Behaviour notes / risks

- **Café edition = pre-split app for every store without a table entitlement** (verified:
  same nav item for item, same login, same BFF routes, same headers; `nav.test.ts` pins it).
- **A store with `vertical.boardgame` on the café deployment** still gets floor + table setup
  (core), but **no time billing**: no rate-plan section, no plan picker, and the table-time
  product is no longer hidden/locked. Board-game stores belong on the board-game deployment,
  which behaves exactly like the pre-split app for them (verified: same table-setup sections).
  Opening a table on the café edition sends `rate_plan_id: null`; the backend currently
  rejects that with 422 when the store has no default plan.
- **`self_ordering`** is reserved: the backend does not issue it yet, so nobody sees a change.
  When it ships, those stores get the core floor; the backend must allow sessions without a
  rate plan and the floor endpoints must not be gated on `vertical.boardgame` only.
- The table tab now clears on any logout (including token expiry), not only on the logout
  button — a tab can no longer survive into the next user's session.
- Sidebar header text "Kafé OS" is unchanged in both editions (umbrella brand); the login
  title, `<title>` and PWA name come from `brand.ts`.
- Turbo: `cacheDir` is pinned to `.turbo/cache`; without it Turbo shares the cache with the
  main git worktree.
