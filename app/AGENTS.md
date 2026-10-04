<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# UI conventions

## Dropdowns: always use the shared `Select`

Never use a native `<select>` in this app. Native `<select>` popups are drawn by the
OS and cannot be styled, so they look inconsistent (plain grey list) next to the rest
of the UI. Always use the shared, fully-styled `Select` component:

```tsx
import { Select } from '@/components/app-common'; // or '../app-common' from screens/

<Select
  value={value}
  onChange={setValue}                                  // receives the string value, not an event
  ariaLabel="หมวดหมู่"
  placeholder="— เลือก —"                              // optional; shown (muted) when value matches no option
  options={items.map(i => ({ value: i.id, label: i.name }))}
/>
```

- `options` is `{ value: string; label: string; disabled?: boolean }[]`.
- `disabled`, `style` (wrapper), and `triggerStyle` (button — for compact/inline variants) are optional.
- For a typed setter, cast in `onChange`: `onChange={v => set('type', v as PromotionType)}`.

## Responsive conventions (phones < 768px)

**Breakpoint.** One breakpoint: "phone" = below Tailwind `md` — `@media (max-width: 767px)` in CSS,
`useIsPhone()` in JS. Targets: 390×844 (iPhone 13) and 360×800 (Android), portrait, browser tab and
installed PWA. At ≥ 768px (tablet / desktop) nothing may change.

**Shell.** Phones have no sidebar. `<MobileNav>` (`src/components/mobile-nav.tsx`, mounted once in
`app/page.tsx`) renders a bottom tab bar (4 screens per role + "เมนู") and a sheet listing every screen.
It and `Sidebar` both read `useVisibleNav()` / `visibleNavSections()` in `app-common.tsx` — add nav
items and visibility rules to `NAV` there, never in either component.

**Rules.**
- Layout that must change on phones goes in a **class**, not an inline `style` (inline styles cannot
  hold media queries). Use the toolkit below before writing new CSS.
- Tap targets: globals.css sets `min-height: var(--tap-std)` (48px) on every `button` / `[role=button]` / `a`
  on touch devices (`@media (any-pointer: coarse)`, any width) and 44px on phones, but **an inline
  `minHeight` below that beats the rule**: remove it or raise it. Tap/type tokens, `.tap*` / `.text-*`
  classes and the tier queries are documented in the "Touch foundation" block of `globals.css`
  (contract: `docs/specs/TOUCH-SPEC.md`). Every `:hover` rule goes inside
  `@media (hover: hover) and (pointer: fine)`.
- Money and quantities: `inputMode="decimal"` / `"numeric"` (or the shared `NumberInput`), not a bare
  `type="number"`. Inputs must render ≥ 16px on phones (an inline `fontSize` below 16 beats the global rule).
- Never rely on hover — every hover-only affordance needs a visible or tap equivalent.
- Size with `var(--app-h)` / `dvh`, not `vh` / `100vw` (`vh` ignores browser chrome, `vw` ignores scrollbars).
- Anything a screen pins to the bottom edge with `position: fixed` must sit at `bottom: var(--tabbar-h)`.

**CSS variables** (`globals.css`)

| Variable | Meaning |
|---|---|
| `--app-h` | Visible app height: `100dvh` minus the system bar / top safe-area inset. |
| `--tabbar-h` | Real height of the bottom tab bar (64px + home-indicator inset). `0px` on tablet/desktop and while the keyboard is open. |
| `--kb-inset` | On-screen keyboard height (`0px` when closed); `html[data-kb-open]` is set while it is open. |
| `--top-inset` | Space taken at the top: system bar, else the status-bar inset. |
| `--screen-pad` | Page gutter: 24px desktop, `clamp(12px, 4vw, 20px)` on phones. |

**Z-index scale** — use the variables, do not invent numbers:
`--z-tabbar` 40 < `--z-screen` 45 (the screen area on phones) < `--z-modal` 50 < `--z-sheet` 1900 (phone
nav sheet) < `--z-popover` 2000 (Select / row menus) < `--z-toast` 2100 < `--z-sysbar` 2200.
An overlay rendered inside a screen may keep a local z-index of 50–1000; it already covers the tab bar.

**Toolkit classes** (section `/* ── Responsive toolkit ── */` in `globals.css`). Desktop values are
plain defaults — an inline style still wins — and phone values are `!important`. So the usual move is
to **add the class and leave the inline desktop style alone**: ≥ 768px stays pixel-identical.

| Class | On phones |
|---|---|
| `.screen-pad` / `.screen-pad-lg` | Screen-root padding (24px / 32px desktop) becomes `--screen-pad`. |
| `.page-header` + `.page-header-actions` | Title row stacks: actions drop below the title, full width. `.grow` on one action fills the row; `.page-header.inline` keeps a single small action beside the title. |
| `.page-title` | Screen `<h1>`: 24px → 20px. |
| `.kpi-grid` | Stat row: `--cols` columns (default 4) → 2 (`--cols-phone`). `KPICard` already shrinks itself. |
| `.form-2col` | Two form columns → one. |
| `.cols-1-phone` / `.cols-2-phone` | Force any inline grid to 1 / 2 columns. |
| `.stack-phone` | Flex row → stretched column. |
| `.wrap-phone` | Lets a flex row wrap. |
| `.full-phone` | Drops a fixed width: `width: 100%`. |
| `.pad-phone` | Card / panel padding (20–32px) → 16px. |
| `.hide-phone` / `.only-phone` | Hidden on phones / shown only on phones. |
| `.tab-strip` (+ `.bleed`) | Tab / chip row scrolls sideways (snap, no scrollbar) instead of wrapping; `.bleed` runs it through the page gutter. |
| `.table-scroll` | Sideways-scroll wrapper for a wide table; the child keeps `--table-min` (default 640px). Add `tabIndex={0} role="region" aria-label="…"`. |
| `.row-cards` | Table rows → stacked cards: header row `.row-cards-head`, each row `.row-card`, each cell `data-label="…"`; `.row-card-title` for the headline cell, `.row-card-actions` for buttons. |

```tsx
<div className="scroll screen-pad" style={{ height: '100%', overflow: 'auto', padding: 24 }}>
  <div className="page-header" style={{ marginBottom: 20 }}>
    <h1 className="page-title">ยอดขาย</h1>
    <div className="page-header-actions">
      <button className="btn btn-primary grow">{t.common.add}</button>
    </div>
  </div>
  <div className="kpi-grid" style={{ '--cols': 3 } as React.CSSProperties}>…</div>
</div>
```

**Hook** — only when the JSX *structure* must differ; plain layout belongs in a class.

```tsx
import { useIsPhone, useMediaQuery } from '@/hooks/use-media-query';
const isPhone = useIsPhone();                      // (max-width: 767px); false during SSR
```

**`MasterDetail`** — list + detail screens. Desktop: a plain flex row (fixed-width list, flexible
detail). Phones: the list fills the screen; with a selection the detail replaces it under a back bar
(the list stays mounted, so scroll position and search text survive).

```tsx
import { MasterDetail } from '../app-common';

<MasterDetail
  listWidth={380}                         // desktop px, default 320
  hasSelection={selected != null}
  onBack={() => setSelected(null)}        // phones: back button
  backLabel="พรีออเดอร์"                  // optional, default "ย้อนกลับ / Back"
  detailTitle={selected?.name}            // optional, shown beside the back button
  list={<OrderList … />}                  // each pane's root is stretched to fill its pane;
  detail={<OrderDetail … />}              // keep borders / backgrounds on that root
/>
```

On desktop `detail` is always rendered, so it must show its own empty state when nothing is selected.
A screen that auto-selects the first item should do so only when `!isPhone`, or a phone never sees the list.

**`ModalShell`** — header + scrollable body + pinned footer; never taller than the visible screen;
Escape, focus trap and focus restore built in; portaled to `<body>`. Use it instead of a hand-rolled
`position: fixed` overlay. Mount it only while open.

```tsx
import { ModalShell } from '../app-common';

{editing && (
  <ModalShell
    title="แก้ไขสินค้า" subtitle={editing.name}
    onClose={() => setEditing(null)}
    width={560}                           // min(560px, 94vw); default 520
    busy={saving}                         // blocks close while saving
    footer={<>
      <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t.common.cancel}</button>
      <button className="btn btn-primary" onClick={save}>{t.common.save}</button>
    </>}
  >
    …form…
  </ModalShell>
)}
```

Existing `.modal-backdrop` / `.modal-card` dialogs need no change: on phones the card is capped to the
visible screen and scrolls as a whole if it has no scroll area of its own.
