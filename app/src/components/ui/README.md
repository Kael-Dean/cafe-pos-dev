# `src/components/ui` — login primitives

The app runs the **pre-redesign UI** (legacy `.btn*` / `.card` classes and the tokens in
`app/globals.css`). The only redesigned surface that was kept is the **login / PIN screen**
(`screens/login.tsx` + `screens/login/login.module.css`). This folder holds just the primitives it
renders:

```tsx
import { Banner, Button, Input, Keypad, Spinner } from '@/components/ui';
```

`skeleton.tsx` is the legacy loading helper the old screens import by path
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
