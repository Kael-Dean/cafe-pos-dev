/**
 * Join class names, skipping falsy values. The primitives keep variants as typed
 * unions mapped to BEM-style classes in ui.css (`ui-btn--primary`), so this is all
 * the "cva" they need — no runtime dependency, and an invalid variant is a type
 * error rather than a silently missing class.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const p of parts) if (p) out = out ? `${out} ${p}` : p;
  return out;
}
