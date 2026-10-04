# `src/components/ui` — design-system primitives

Mode **Operate**. Spec: `docs/specs/UI-SPEC-core.md` §6–§8. Import from the barrel:

```tsx
import { Button, Modal, NumberField, useToast } from '@/components/ui';
```

Styles: `ui.css` (imported once by `app/globals.css`). Tokens: `app/globals.css`.

## Rules for screens

- Read **semantic** (`--color-*`) or **component** (`--btn-*`, `--tap-*`, `--cart-w` …) tokens.
  Never the primitives (`--brown-*`, `--cream-*`, `--caramel-*` …). They do not follow the theme.
- Do not put a colour in an inline `style={{}}`. Use a primitive, a class, or a Tailwind utility
  (`bg-surface`, `text-text-secondary`, `border-border-input`; these resolve to the same variables).
- Text on a tint uses the `*-fg` token: `--color-success-fg` on `--color-success-50`.
  `--color-accent-600` is a **fill** only. As text it measures 3.1:1. Use `--color-accent-fg`.
- Inputs, steppers and outline controls use `--color-border-input` (≥3:1). `--color-border` is for dividers only.
- Motion: only `transform` and `opacity` animate. Colour changes on hover are instant. Under
  `prefers-reduced-motion` all scale and translate effects are removed.
- Every target is ≥44px. POS secondary actions are 56px (`lg`). Charge, confirm and "next order" are 64px (`xl`).
- Toasts are for errors and async results only. Never toast routine success: the new cart line is the feedback.
- Gotcha: `globals.css` has an unlayered `button { padding:0; border:none; background:none }` reset.
  Tailwind utilities live in `@layer utilities`, so `p-4` / `bg-*` on a raw `<button>` **lose** to it.
  Use these primitives (or a non-layered class) for buttons.

## Components

| Component | Variants | Sizes | Key props / notes |
|---|---|---|---|
| `Button` | `primary` · `secondary` · `ghost` · `danger` · `accent` | `sm` 36 (+44 hit, desktop admin only) · `md` 44 · `lg` 56 · `xl` 64 | `loading` (spinner, width locked, aria-busy), `icon`, `trailing`, `kbd="F12"` (shown ≥1024 with a fine pointer, also aria-keyshortcuts), `fullWidth`, `disabled` + `disabledReason` (stays focusable, reason announced and shown as a tooltip). Replaces `.btn*` and `PayButton`. |
| `IconButton` | `ghost` · `outline` · `danger` · `onInverse` | `sm` 36 (+44 hit) · `md` 44 · `lg` 56 | **`label` is required** (becomes aria-label and tooltip). `badge={n}`, `loading`. |
| `PayAction` | `kind="charge"` (primary xl, full width) · `kind="method"` (secondary lg) | 64 / 56 | `amount` (tabular, right-aligned, part of the name), `pending`, `disabledReason`, `kbd`. |
| `Input` | `default` · `search` (magnifier + 44px clear) · `inverse` | `md` 44 · `lg` 56 | `label`, `hint`, `error` (aria-invalid + role=alert message), `leading`, `trailing`, `onClear`. 16px text on phones. |
| `NumberField` | `stepper` (− value +) · `plain` (typed amount) | `md` 44 · `lg` 56 | `min` `max` `step` `integer` `unit`. Built on `lib/number-input`: the box can be cleared while typing and clamps on blur. Hold − / + to repeat. ↑ / ↓ step. `role="spinbutton"`. |
| `Select` | — | `md` 44 · `lg` 56 | Same props as the legacy `app-common` `Select` (`value`, `onChange(value)`, `options`, `placeholder`, `ariaLabel`, `disabled`) plus `label` / `hint` / `error`. Uses the APG select-only combobox pattern: ↑ ↓ Home End, Enter/Space, Esc, typeahead. |
| `SegmentedControl` | `default` · `onInverse` | `md` 44 · `lg` 56 | `ariaLabel` required. A radiogroup with roving focus; the arrow keys move and select. Use it for payment method, density and KDS filter. |
| `Keypad` | `cash` · `pin` | key 64 · PIN 64 / 72 (≥768) | `onKey(key)`. Keys are `0-9 . 00 back clear enter`. Keys fire on pointerdown. `captureKeyboard` mirrors physical keys by `e.code`, so the Thai layout works. `extraKey`, `showEnter`. The pad never raises the OS keyboard. |
| `Modal` | `dialog` · `alert` (alertdialog) | `sm` 400 · `md` 560 · `lg` 640 | **Controlled `open`** (keep it mounted so the 120ms exit fade plays). `title`, `description`, `footer`, `dismissible={false}` blocks Esc, backdrop, × and Back (use it while payment is processing). `closeOnBackdrop` defaults to true for dialog and false for alert. `historyAware` is opt-in (§2.5). Focus trap, Esc and focus restore come from `use-modal-a11y`; only the topmost overlay handles keys. |
| `Sheet` | `side="bottom"` · `side="side"` (right panel ≥1024) | `size="auto"` · `"full"` | Same contract as `Modal` plus drag-to-dismiss on the 44px handle (30% or flick). Centred and capped at 640px on tablets. |
| `ToastProvider` / `useToast` | `info` · `success` · `warning` · `danger` | — | Same API as before: `toast({ kind, title, msg?, duration? })`. A maximum of 2 are visible. Danger toasts last 6s and go to an assertive live region; the rest are polite. Each live region announces once. Placement is `bottom-right` (default) or `bottom-left` (use it on POS ≥768 so toasts stay clear of the cart). Phones always show toasts at the top. |
| `Snackbar` | — | 48 | Undo: `open`, `message`, `onAction`, `onClose`, `duration` 5000, `resetKey`. Bottom-centre, above the tab bar, polite. |
| `Badge` | tone `neutral` `info` `success` `warning` `danger` `accent` · kind `status` / `count` | 20 · `lg` 24 | Not interactive. Text uses the `*-fg` token on a `*-50` tint. `count` is solid primary (or danger). |
| `Chip` | `kind="filter"` (aria-pressed) · `"status"` · `"removable"` | `md` 32 (+44 hit) · `lg` 44 | Use filter chips for categories (POS: `size="lg"`). Removable chips have an × with a 44px hit area. |
| `Kbd` | `default` · `onInverse` | 20 | Key cap. Hidden on touch-only devices. |
| `Card` | `surface` · `sunken` | padding `none` `sm` `md` `lg` | With `onClick` it renders a `<button>`: hover lift, press, focus. `selected` draws a primary ring. `pending` shows a 2px bar after 150ms. Do not nest cards. |
| `EmptyState` | `neutral` · `search` · `danger` (role=alert) | icon 56 | `title`, `body`, `action` (e.g. "ลองอีกครั้ง"). Replaces the ad-hoc versions in pos, floor and kds. |
| `Banner` | `neutral` `info` `warning` `danger` `accent` | `md` 40 · `lg` 48 | Shows a persistent state; it is not dismissible. Use offline → `danger`, stale → `warning`, table mode → `accent`. `live` sets the role: `status` (default), `alert` or `off`. |
| `Timer` | auto: neutral <5 · warning 5–10 · danger >10 min | 24 | `since`, `warnAfter`, `dangerAfter`, `tickMs` 15000, `format`. Shown by icon + tint + number, never hue alone. |
| `Spinner` | — | `md` 16 · `lg` 20 | Keeps spinning under reduced motion (functional). |
| `Skeleton*` | `Skeleton` `SkeletonText` `SkeletonCard` `SkeletonTable` | — | The existing `skeleton.tsx`, unchanged. |

### Not built here (POS composites, owned by the build agents)

`CartLine`, `TotalBlock`, `QRPanel`, `ReceiptPaper`, the menu / table / ticket cards. Compose them from
`Card`, `NumberField`, `Badge`, `Kbd` and `Timer` with the component tokens (`--cart-w`, `--menu-card-min`,
`--menu-tile-h`, `--pay-charge-h`, `--kds-*`).

## Examples

```tsx
// Pay block
<PayAction kind="charge" amount={baht(total)} kbd="F12" pending={paying}
  disabledReason={offline ? 'ออฟไลน์ — รับเงินไม่ได้' : undefined} onClick={charge}>รับเงินสด</PayAction>

// Confirm that cannot be dismissed by accident
<Modal open={confirmVoid} onClose={() => setConfirmVoid(false)} variant="alert" size="sm"
  title="ยกเลิกบิลนี้?" description="รายการทั้งหมดในตะกร้าจะถูกลบ"
  footer={<>
    <Button variant="secondary" onClick={() => setConfirmVoid(false)}>กลับไป</Button>
    <Button variant="danger" onClick={voidCart}>ยกเลิกบิล</Button>
  </>} />

// Load error with retry
<EmptyState tone="danger" title="โหลดเมนูไม่สำเร็จ" body="ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
  action={<Button variant="secondary" onClick={() => refetch()}>ลองอีกครั้ง</Button>} />
```

## Migration notes

- `useToast` / `ToastProvider` moved to `@/components/ui/toast` with the same API. `app-common` still
  re-exports them (deprecated). Toasts no longer use a 3px coloured left edge; the status icon carries the
  kind. They now have a × button. The old `.toast*` CSS classes are gone.
- `ModalShell` (`components/layout.tsx`) and the legacy `Select` in `app-common` are untouched. Move screens to
  `Modal` / `Select` from here as they are rebuilt.
- `use-modal-a11y` now tracks a stack of open dialogs, so only the topmost reacts to Esc / Tab. Before
  this, a confirm opened over another dialog closed both on Esc.
