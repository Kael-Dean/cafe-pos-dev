# `src/components/ui` — login primitives

The app runs the **pre-redesign UI** (legacy `.btn*` / `.card` classes and the tokens in
`app/globals.css`). The only redesigned surface that was kept is the **login / PIN screen**
(`screens/login.tsx` + `screens/login/login.module.css`). This folder holds just the primitives it
renders:

```tsx
import { Banner, Button, Input, Keypad, Spinner } from '@/components/ui';
```

`numpad-field.tsx` (legacy look, see below) and `skeleton.tsx` are imported by path. `skeleton.tsx` is the legacy loading helper the old screens import by path
(`@/components/ui/skeleton`). It predates the redesign and is not part of the barrel.

## Isolation rules (why the login cannot change the other screens)

- **Styles ship with the primitives.** Each primitive imports `./tokens.css` and `./ui.css`;
  `app/globals.css` imports neither.
- **Own token namespace.** `tokens.css` defines only `--ds-*` custom properties (light on `:root`,
  dark on `:root[data-theme='dark']`). The legacy globals never define or read a `--ds-` name, and
  `ui.css` / `login.module.css` read only `--ds-*` tokens (plus the runtime layout var `--app-h`).
  Never re-declare a legacy token (`--color-*`, `--space-*`, `--radius-*` …) here.
- **Class selectors only.** Every rule in `ui.css` targets a `.ui-*` class. No element, `:root` or
  bare attribute selectors.
- Helpers the primitives borrow from the legacy globals, unchanged since before the redesign:
  `.spinner`, `.sr-only`, `.hit-44`, the `button { … }` reset, the global `:focus-visible` ring.

## Components

| Component | Variants | Sizes | Key props / notes |
|---|---|---|---|
| `Button` | `primary` · `secondary` · `ghost` · `danger` · `accent` | `sm` 36 (+44 hit) · `md` 44 · `lg` 56 · `xl` 64 | `loading` (spinner, width locked, aria-busy), `icon`, `trailing`, `fullWidth`, `disabled` + `disabledReason` (stays focusable, reason announced and shown as a tooltip). |
| `Input` | — | `md` 44 · `lg` 56 | `label`, `hint`, `error` (aria-invalid + role=alert message), `leading`, `trailing`. 16px text on phones. Built on `Field`. |
| `Keypad` | `cash` · `pin` | key 64 · PIN 64 / 72 (≥768) | `onKey(key)`. Keys are `0-9 . 00 back clear enter`. Keys fire on pointerdown. `captureKeyboard` mirrors physical keys by `e.code`, so the Thai layout works. `extraKey`, `showEnter`. The pad never raises the OS keyboard. |
| `Banner` | `neutral` `info` `warning` `danger` `accent` | `md` 40 · `lg` 48 | Persistent state strip, not dismissible. `live`: `status` (default), `alert` or `off`. |
| `Spinner` | — | `md` 16 · `lg` 20 | Extends the global `.spinner`; keeps spinning under reduced motion (functional). |
| `Field` / `fieldIds` | — | — | Label + control + hint/error column used by `Input`. |

i18n: accessible names come from `t.ui` (keypad keys) and the screen copy from `t.login`
(`src/lib/i18n/{th,en}.ts`).

## Legacy-look components (touch foundation)

These render in the **legacy app look** (`--color-*` / `--tap-*` tokens, CSS in `app/globals.css`),
not the `--ds-*` login look. Import them **by path**, never from the barrel: the barrel pulls in
`tokens.css` / `ui.css`.

### `NumpadField`: `@/components/ui/numpad-field`

Money, quantity or digit-string entry with its own on-screen keypad, for the touch core flow
(payment, membership phone lookup, qty edit). It renders no `<input>`, so no tablet or phone raises
its soft keyboard. Same pattern as the cash tender (`screens/payment-cash.tsx`): keys fire on
`pointerdown`, the trailing click is swallowed, keyboard and assistive-tech clicks still work, every
key press gives an 8ms haptic tick.

```tsx
import { NumpadField } from '@/components/ui/numpad-field';

const [cash, setCash] = useState('');            // raw numeric string, never formatted text
<NumpadField
  label="เงินที่รับมา"
  value={cash}
  onChange={setCash}
  mode="money"                                   // money (default) · qty · digits
  allowDecimal={!Number.isInteger(total)}        // money: '.' key instead of '00'
  presets={[{ label: '฿100', value: '100' }, { label: '฿500', value: '500' }]}
  onEnter={confirm}                              // hardware Enter
/>

// Membership phone lookup: leading zeros kept, 10 digits max, custom display.
<NumpadField label="เบอร์โทร" mode="digits" value={phone} onChange={setPhone}
  format={(v) => v.replace(/^(\d{3})(\d{0,3})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'))}
  error={notFound ? 'ไม่พบสมาชิกเบอร์นี้' : undefined} />
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | `string` | required | Visible label inside the display; also the accessible name. |
| `value` / `onChange` | `string` / `(next: string) => void` | required | `''` = empty. `parseFloat(value)` is always safe in money/qty. |
| `mode` | `'money' \| 'qty' \| 'digits'` | `'money'` | money: ฿ prefix, thousands separators, no leading zeros. qty: whole numbers. digits: raw string, leading zeros kept. |
| `allowDecimal` | `boolean` | `false` | money only: up to 2 satang digits. |
| `maxLength` | `number` | 7 / 3 / 10 | Integer digits (money, qty) or total digits (digits). |
| `prefix`, `format`, `placeholder` | | `'฿'` for money | Display only; never changes `value`. |
| `hint` / `error` | `string` | | Line under the display; `error` sets `aria-invalid` and is announced. |
| `presets` | `{ label, value }[]` | | Quick-fill buttons (48px). The one matching `value` shows pressed. |
| `onEnter` | `() => void` | | Hardware Enter when focus is not on a button. |
| `captureKeyboard` | `boolean` | `true` | Mirrors digits (by `e.code`, so the Thai layout works), Numpad, `.`, Backspace, Delete, Enter. **Set `false` when two NumpadFields are on screen.** |
| `size` | `'md' \| 'lg'` | `'lg'` | Key height: lg = `--tap-key` (72px ≥768, 56px phones); md = `--tap-lg` 56. Per-use override: `style={{ '--numpad-key-h': '64px' }}`. |
| `disabled`, `className` | | | |

The pure reducer `applyNumpadKey(prev, key, { mode, allowDecimal, maxLength })` is exported and
unit-tested (`numpad-field.test.ts`).

### Other shared touch pieces

- `haptic(kind?)` in `@/lib/haptics`: `'tap'` (8ms: add-to-cart, qty ±, keypad, KDS bump) or
  `'success'` (12·40·12: payment done). Never on errors or navigation. Safe everywhere (no-op on iOS).
- `useToast()` in `app-common.tsx`: same signature as before, plus an optional
  `action: { label, onAction }` (e.g. retry). Toasts sit top-center, each has a 44px close button,
  `danger` stays until dismissed, the rest auto-dismiss after `duration` (default 3s).
- Tokens and classes (`--tap-*`, `--fs-*`, `.tap`, `.tap-std`, `.text-body`, `.num` …): see the
  "Touch foundation" comment block in `app/globals.css`.
