# TOUCH-SPEC — Touch-first evolution of the existing Kafé OS UI

Owner: product-ux-designer · For: design-system-engineer (§2), dashboard-app-dev (§3–4) · Mode: **Operate**
Status: ready to build. Supersedes nothing visual. `UI-SPEC-core.md` (reverted) is reused only for UX ideas (optimistic add, no "added" toasts, KDS stale bar, undo).
Assumptions (no owner interview possible from this pass, correct if wrong): Windows touch tablets and all-in-ones are the main counter devices (DECISIONS.md D2); a mouse may be attached at the same time; Thai-first copy.

## 1. Principles and guardrails

**Thesis: same café, bigger fingers.** A regular should open the app and not notice a "new design". They should notice that nothing is fiddly anymore. Every change in this spec makes something bigger, calmer or faster. None of them adds decoration.

1. **Size, not style.** Increase tap targets and type, and keep colour, radius, shadow, font and layout as they are.
2. **Group with space and surface tone.** Use a `--color-surface-2` band or 16–24px of air. Never add a line where space can do the job.
3. **The cart is the feedback.** Routine success (adding an item) shows up where the eye already is, never in a toast.
4. **Touch rules apply wherever there is touch.** Gate on `any-pointer: coarse` (Windows AIOs report `pointer: fine` when a mouse is plugged in), not on width alone.
5. **Readable at arm's length.** Counter screens sit 50–70cm away and the KDS sits 1.5–2m away. Size the type for that distance.

| DO | DON'T |
|---|---|
| Keep espresso/caramel/cream tokens, Anuphan, sidebar + 60/40 menu/cart, all flows | Introduce new hues, a new font, a new layout or new screens |
| 1px hairline (`--hairline`) only where two same-tone surfaces touch | Borders >1px (focus ring excepted); `border-left/top` accents of 3–4px (toast, KDS ticket today) |
| Separate groups with spacing or a `surface-2` band | Divider lines between every row; nested cards; card-in-card modals |
| Solid fills; existing soft `--shadow-sm/md` only on floating layers (modal, popover, toast) | Gradients (incl. the product placeholder `linear-gradient` and stripe overlay), glow, glassmorphism, `backdrop-filter` on new elements |
| Radius stays 6/8/12/16; chips keep the current pill only where they already are (category tabs, status tags) | Turning buttons, inputs, cards or badges into pills |
| Drawn icons from `icons.tsx` | Emoji or unicode glyphs as icons |
| Press feedback = darker surface tone + `scale(.97)` | Hover lift as the only affordance; bounce or elastic effects; infinite pulses (`payment-modal.tsx:202`) |

## 2. Foundation tokens (globals.css, `:root`, theme-agnostic)

```css
/* Tap sizes: one ladder for the whole app (replaces --ds-tap-* in components/ui/tokens.css; keep aliases) */
--tap-min: 44px;   /* absolute floor, any pointer: icon buttons, close X, chips */
--tap-std: 48px;   /* default control on touch: buttons, inputs, list rows, qty ± */
--tap-lg: 56px;    /* modal primary, category chips on POS/KDS, rail items */
--tap-xl: 64px;    /* money actions: pay methods, confirm payment, KDS bump */
--tap-key: 72px;   /* numeric keypads (cash, PIN) at ≥768 */
--tap-gap: 8px;    /* min gap between adjacent tap targets */

/* Type scale: 10 steps max, replaces ~20 ad-hoc sizes. Nothing <13px on core screens. */
--fs-cap: 13px;    /* captions, meta, badges, tab labels (was 10–12) */
--fs-sm: 14px;     /* secondary text, mods under a cart line */
--fs-body: 15px;   /* body, product name, cart line name */
--fs-lg: 16px;     /* inputs (no iOS zoom), button labels on touch */
--fs-title: 18px;  /* modal titles, floor table name */
--fs-h2: 20px;     /* screen titles */
--fs-h1: 24px;     /* bill no., change due */
--fs-num-lg: 28px; /* totals in cart + payment */
--fs-num-xl: 40px; /* amount due in payment, KDS queue no. */
/* (keep old --fs-12…--fs-48 as aliases during migration; --fs-12 → 13px) */
--lh-tight: 1.25; --lh-body: 1.45;

/* Lines and states */
--hairline: 1px solid var(--color-border);
--press-bg: rgba(61,40,23,0.08);           /* dark: rgba(240,220,192,0.10) */
--press-scale: 0.97;
--selected-bg: var(--color-primary-50);
```

Global rules to add:
```css
.num, [data-num] { font-variant-numeric: tabular-nums; }      /* every price, qty, total, timer */
button, [role="button"], a, .menu-card { touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none; }
.scroll { overscroll-behavior: contain; }                    /* no rubber-band pulling the whole app */
.pressable:active:not(:disabled) { background-color: var(--press-bg); transform: scale(var(--press-scale)); }
/* Hover gating: every :hover rule moves inside this block. Remove inline onMouseEnter/Leave (core: app-common.tsx:1, row-menu.tsx:1). */
@media (hover: hover) and (pointer: fine) { /* .btn-*:hover, .icon-btn:hover, .help-badge:hover, .menu-card:hover … */ }
```

Breakpoint + pointer application (replace `globals.css:442-452`, which is phone-only today):

| Tier | Query | Applies |
|---|---|---|
| All | none | `--tap-min` floor on every control in core screens; type scale; tabular nums; hover gating |
| Touch (any width) | `@media (any-pointer: coarse)` | `button,[role=button],a { min-height: var(--tap-std) }`; inputs/selects `min-height: var(--tap-std); font-size: var(--fs-lg)`; `.hit-44` pseudo-area expands to 48px |
| Phone | `(max-width: 767px)` | existing phone shell; keypads 56px; sheets instead of centered modals (unchanged behaviour) |
| Tablet | `(min-width: 768px) and (max-width: 1279px)` | sidebar defaults to labelled rail; `--tap-key: 72px` |
| POS | `(min-width: 1280px)` | sidebar defaults expanded; same tap sizes as tablet (AIO screens are touch) |

Inline-style rule for devs: an inline `minHeight` below the token beats the CSS floor (AGENTS.md note), so **delete inline `minHeight: 44` and inline `fontSize: 10–12` in core screens** rather than fighting them with `!important`.

## 3. Per-screen change list

Core screens = POS, payment (all methods), receipt, modifier, membership, table session, settle, cancel order, KDS, floor, sidebar, mobile nav.

### 3.1 Shell: sidebar (`app-common.tsx:192-400`, `page.tsx:74`)
- **Change:** default state comes from the tier. Tablet (768–1279) = **labelled rail, 80px**. POS (≥1280) = expanded 240px. Remember the user's toggle per tier in `localStorage` (`kafe.sb.tablet` / `kafe.sb.pos`).
- Rail item: 80×64, icon 22px, label **13px** under the icon, 1 line, ellipsis. Short labels come from a new `t.navShort` (≤6 Thai chars, e.g. ขาย, ครัว, จอง, เงินสด, โต๊ะ). The active item keeps the current `--sb-active-bg` raised style. The 4px gap between items comes from spacing; there are no divider lines.
- Group headers in the rail = 16px of empty space (drop the `--sb-guide` lines). The rail scrolls vertically if it overflows.
- Remove the `title` tooltip as the only label (labels are now visible). The collapse toggle grows from 28px to a 44×44 button at the rail bottom, above the user block.
- Expanding from the rail on tablet opens the 240px panel as an **overlay** over the menu (backdrop tap closes it). It does not push the content, so the POS grid never reflows. Remove the `width`/`padding` transitions (`:261,305,354`) and slide the overlay with `transform` instead.
- **Keep:** grouping, order, colours, user block, logout confirm.

### 3.2 POS: menu (`pos.tsx`)
- **Layout:** the menu column gets `container-type: inline-size`. The cart column becomes `width: clamp(340px, 40%, 440px)` and the menu takes the rest (still ≈60/40 at 1024–1366, and the cart stops growing past 440px on AIOs).
- **Grid columns by menu container width** (replace `grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]`, `pos.tsx:630,1038`): <420 → 2 · 420–499 → 3 · 500–759 → 4 · 760–979 → 5 · ≥980 → 6. Gap 12px (10px below 500). Padding 16px.

| Viewport | Sidebar | Menu inner width | Columns |
|---|---|---|---|
| 390 phone | none | ~358 | 2 |
| 1024×768 tablet | rail 80 | 944−378 cart −32 = ~534 | **4** |
| 1280 POS | 240 | ~584 | 4 |
| 1366 POS | 240 | ~646 | 4 (5 if rail) |
| 1600 POS | 240 | ~880 | 5 |
| 1920 POS | 240 | ~1200 | **6** |

- **Menu card** (`MenuCard`, `:1053`): name 13 → **15px/600**, 2-line clamp, min-height 2 lines. Price 15 → **16px/700**, tabular. Padding 12px. The image stays 4:3. Placeholder: **flat `item.color`**, no gradient or stripe overlay. `nameEn` goes from 11px mono uppercase to 14px Anuphan 600 at 0.92 white (mono was a costume). Bestseller tag 10 → 13px, 24px tall. SKU tag (`item.tag`) 10 → 13px, or hide it on tablet when the card is <140px. Whole card is the target (≥126×170).
- **Category chips** (`CategoryTab`, `:1043`): 38 → **48px** tall (56px on POS tier), 15px/600, padding 0 18px, gap 8px. Keep the pill shape and the active espresso fill. The skeleton chips match at 48px.
- **Search:** 44 → 48px, 16px text, clear button 44×44 inside on the right when the field has text.

### 3.3 POS: add to cart (optimistic) and feedback (`pos.tsx:101-120, 261-264, 860`)
- **Data:** the product list must carry `modifierGroupIds` (or `hasModifiers`). Backend-api-engineer adds it to the list endpoint. Until that lands, prefetch `useProductDetail` for every product in the active category after the list loads (`queryClient.prefetchQuery`, staggered, low priority).
- **On tap** (pointerup within the card, see §4): known no-modifier → `addLine` **synchronously** (≤50ms). Has modifiers → open `ModifierModal` immediately (it shows its own skeleton while groups load). Detail unknown → card enters the *pending* state (surface dims to 0.7, 16px spinner replaces the price). The add completes when the fetch resolves. Taps on the same card during pending are queued, not dropped.
- **Feedback without toast:** delete both `addedToCart` toasts (`:117,860`). Instead:
  1. the touched cart line (new or incremented) gets a `--color-accent-50` background that fades out over 600ms, and the list scrolls it into view;
  2. a **qty badge** (13px, caramel fill, ink `--color-on-accent`, 24px min) sits on the menu card's image corner showing how many of that product are in the bill. This persists, so it is also state, not just a flash;
  3. `navigator.vibrate(8)`.
  On phones, the existing cart bar count bump stays as is.
- **Error:** the fetch fails → the card returns to normal and a toast "เพิ่ม {name} ไม่สำเร็จ · ลองอีกครั้ง" appears with a retry action.

### 3.4 POS: cart (`pos.tsx:700-870, 1103-1140`)
- **Cart line:** padding 14px 16px. Name 14 → **15px**, mods 12 → **14px** secondary. Remove the `borderBottom` line and separate lines with 4px vertical gap + `surface-2` on press only.
- **Qty stepper:** ± 34 → **48×48** (`qtyBtnStyle`), radius 8, `surface-2` fill, icon 18px. Qty number 16px/700 tabular, min-width 32. Gap 4px. The stepper is one `surface-2` group (buttons + number), not 3 boxes.
- **Remove:** replace the 11px red text link with a 48×48 icon button (trash, `--color-danger-fg`) at the line end. Tapping `−` at qty 1 also removes the line. Every removal shows an **undo snackbar** (5s, see 3.5).
- **Line amount:** 14 → 16px/600 tabular.
- **Member chip** (`:703-719`): name 12 → 14px, points/sales 10 → 13px. The remove-member X goes from 22 → 44×44 visible (not pseudo-area). Keep the accent-50 fill and 1px accent border.
- **Header buttons** (ลูกค้า / สมัคร): 12 → 14px, 48px tall.
- **Park bill (`:733`):** dead button. **Hide it** until the park feature exists (no dead controls). If dev wires it later, it is a 48×48 icon button with a visible label on POS tier.
- **Totals:** subtotal/discount rows 13 → 14px, grand total → `--fs-num-lg` 28px/700. Bill no. label 12 → 13px.
- **Pay methods** (desktop `PayButton`): keep the 64px height. Label 12 → **15px/600**, icon 22px. Grid 2×2 at tablet, 4×1 at POS tier if the cart ≥400px. Promotions / void row: 48px, 14px text, badge 13px.

### 3.5 Toasts and snackbar (`globals.css:362-383`)
- **Placement:** move the stack from bottom-right to **top-center**, 12px below the sys-bar (`top: calc(var(--sys-bar-h) + 12px)`), max-width 420px. It then never covers pay buttons, the cart total or the keypad. Phone: same, full width minus 16px.
- **Style:** drop `border-left: 3px`. Use a tinted surface instead (`--color-success-50` / `warning-50` / `danger-50`) + coloured 20px icon + 1px `--color-border`. Text 15px title / 14px message.
- **Dismiss:** every toast gets a 44×44 close button. Errors stay until dismissed. Info/success auto-dismiss at 3s, and the timer pauses while the pointer is down on the toast.
- **Undo snackbar** (cart line removed, void, KDS bump): bottom of the **cart column** (not the viewport), above the totals, `--color-primary` fill, white 15px text, "เลิกทำ" 48px button. Lasts 5s. Only one at a time.

### 3.6 Modals: shared (payment, receipt, modifier, membership, table session, settle, cancel order)
- **Close X:** 30–32px → **48×48** visible hit, 20px icon, top-right with 8px inset. Files: `payment-modal.tsx:102`, `receipt-modal.tsx:238`, `modifier-modal.tsx:187`, `membership-modal.tsx:229`, `table-session-modal.tsx:63`, `cancel-order-modal.tsx:74`, and the settle header.
- **Footer actions:** primary 56px (`--tap-lg`). Money-committing actions use **64px**: confirm payment `payment-modal.tsx:131`, the QR/card "รับเงินแล้ว" actions (`:198,257,289`), settle confirm. Cancel buttons are 56px ghost. Labels 16px.
- **Captions** 11–12px → 13px (`modifier-modal.tsx:203-204,231,244,273`, `membership-modal.tsx:350,377,392,397`, `table-session-modal.tsx:445,533`, `settle-modal.tsx:143,221`, `receipt-modal.tsx:233,254`). The receipt **paper preview** (`receipt-modal.tsx:489`, 11.5px) is exempt because it mimics 58/80mm print.
- **Modifier modal:** option rows 56px, whole row tappable (radio/checkbox drawn 22px). Qty ± 36 → **56×56**, qty value 20px tabular. The "จำเป็น" tag is 13px danger-fg.
- **Payment:** amount due `--fs-num-xl` 40px; "บิล A0xx" 13px. Remove the infinite scale pulse (`:202`); the QR waiting dot uses an opacity fade, max 1 property. The method switch is a segmented control at 56px.
- **Cash keypad (`payment-cash.tsx`):** **keep it as is.** This is the reference pattern (pointerdown, vibrate 8ms, `inputMode="none"`, 52–72px keys). Only lift the 44px quick-amount chips (`:331-351`) to 48px.
- **Membership:** the phone-number entry reuses the cash keypad pattern (no soft keyboard on tablet); result rows 64px.

### 3.7 KDS (`kds.tsx`), viewed at 1.5–2m
- **Grid:** `1 / md:2 / lg:3` → 1 col <768, 2 cols 768–1279, **3 cols ≥1280, 4 cols ≥1700**. Gap 16px.
- **Ticket:** queue no. 28 → **36px/700**. Item name → **20px/600**, qty "×2" → **22px/700** tabular (caramel stays). Mods 16px. Elapsed timer 18px tabular.
- **Urgency without thick lines:** replace `borderTop: 4px` with a **tinted header band**: normal = `surface-2`, yellow = `--color-warning-50` + timer in `--color-warning-fg`, red = `--color-danger-50` + timer in `--color-danger-fg` + timer icon. The status tag 11 → 14px, 28px tall.
- **Contrast:** the header sub-lines `rgba(255,255,255,0.55)` (`:192,199,215`) → `rgba(255,255,255,0.78)` (≥7:1 on espresso), 14px. Status counters label 12 → 14px, count 16 → 20px. On white tickets, no `#9CA3AF`: muted text uses `--color-text-muted`.
- **Help badge** ("วิธีทำ", `:373`): 22px circle → a 44×44 icon button (book icon, 20px) with the visible label "วิธีทำ" 13px on tickets ≥320px wide.
- **Actions:** bump/done 52 → **64px**, 17px/700. Cancel order (`:420`, 12px text link) → 48px ghost button, 15px danger-fg, separated from bump by 16px and placed on the opposite side (left vs right). Bump shows the undo snackbar.
- **Keep:** dark espresso screen, white paper tickets, sort order, no swipe-to-bump.

### 3.8 Floor (`floor.tsx`)
- **Grid:** `minmax(200px,1fr)` → **minmax(220px,1fr)** at ≥768 (yields 3 cols at 1024 with rail, 5–6 at 1920). Phone stays 2 cols.
- **Table tile:** min-height 132 → **148px**, padding 16. Name 18 → 22px/700. Capacity 12 → 14px. Status tag 10–11 → 13px. Opened-at 11 → 13px. Running total 20 → 24px tabular.
- **Busy vs free from surface, not border weight:** busy = `--color-primary-50` fill + 1px primary hairline (current), free = surface + hairline. Section headings (`:142`, 13px uppercase tracked) → 15px/700 sentence case, no uppercase tracking (Thai has no case).
- The whole tile is the target. "เปิดโต๊ะ" goes straight into POS with the session (UI-SPEC-core idea: one tap fewer).

### 3.9 Mobile nav (`mobile-nav.tsx`, `globals.css:820-860`)
- Tab label 11 → **13px**, tab min-width 64, bar content height 58 → 64px. The active pill stays 52×28 (visual only, the whole tab is the target). Sheet rows 56px, 15px.

## 4. Interaction rules

- **Instant actions use `pointerdown`:** keypad keys, qty ±, category chips, and tab/segment switches. Copy `payment-cash.tsx:145` (preventDefault to keep focus, then act).
- **Commit and navigate actions use `click`:** menu card add, pay, confirm, bump, close, remove. This lets a finger that started a scroll on a card cancel the action. The card does not add if the pointer moved >10px.
- **Haptics:** `navigator.vibrate?.(8)` on add-to-cart, qty ±, keypad, and KDS bump. Use `vibrate?.([12,40,12])` on payment success. Never vibrate on errors or navigation. Wrap in try/catch, because haptics are optional (iOS has none).
- **No long-press required anywhere.** Every action has a visible button. Long-press may exist only as a shortcut.
- **No hover-dependent info:** nothing appears only on hover or `title`. Tooltips are allowed only as a duplicate of visible text. The prefetch-on-hover comment at `pos.tsx:101` becomes prefetch-on-load (§3.3).
- **Press state on every control:** within 1 frame, `--press-bg` + `scale(.97)`, 120ms out. Disabled controls get no press state and keep their size (do not shrink).
- **No double-tap zoom or 300ms delay:** `touch-action: manipulation` globally (§2). Pinch zoom stays enabled for accessibility.
- **Spacing between adjacent targets ≥8px** (`--tap-gap`). Destructive actions (remove, void, cancel order) never sit directly next to the primary action.
- **Reduced motion:** keep the opacity fades and drop the scale/translate (existing global rule).

## 5. Acceptance checks (measurable, run with `playwright-cli` at 390×844, 1024×768, 1366×768, 1920×1080, plus `npx impeccable detect` on changed files)

1. **Targets:** in all core screens and their open modals, 0 interactive elements with a rendered box <44×44 (script: query `button,a,[role=button],input,select` and read `getBoundingClientRect`; pseudo-element hit areas don't count). Qty ± ≥48, close X ≥48, money actions ≥64, KDS bump ≥64.
2. **Type:** 0 text nodes with computed `font-size` <13px in core screens (receipt paper preview exempt). Product name ≥15px, cart line name ≥15px, KDS item ≥20px.
3. **Contrast:** all text ≥4.5:1 (≥3:1 for ≥18.66px bold). KDS header text on espresso ≥7:1. Tool: axe via playwright, 0 `color-contrast` violations.
4. **Grid columns:** POS menu shows exactly 4 cols at 1024×768 (rail), 4 at 1366, 6 at 1920, 2 at 390. KDS shows 2 at 1024, 3 at 1366/1920. Floor shows ≥3 at 1024.
5. **Lines:** 0 computed `border-*-width` >1px outside `:focus-visible` in core screens. 0 `linear-gradient`/`radial-gradient` and 0 `backdrop-filter` added by this work.
6. **Add-to-cart:** with a cached product, the cart line appears ≤100ms after pointerup (Performance mark). 0 toasts fire on a successful add.
7. **Toasts:** none render in the bottom 40% of the viewport on tablet/POS. Every toast has a close button ≥44.
8. **Hover:** 0 `onMouseEnter/onMouseLeave` in core screen files. All `:hover` selectors sit inside `@media (hover:hover) and (pointer:fine)`.
9. **No dead controls:** every visible button in core screens has a handler (park bill hidden).
10. **Unchanged identity:** a palette diff of `globals.css` colour tokens = 0 changes. Font family unchanged. Sidebar/menu/cart order unchanged. Owner side-by-side review at 1024 before merge.
