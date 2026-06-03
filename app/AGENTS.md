<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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
