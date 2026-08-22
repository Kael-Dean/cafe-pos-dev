import { z } from 'zod';

/**
 * Client-side mirrors of the API's validation rules. The server is still the
 * authority — these exist so a founder finds out about a bad slug while typing
 * it rather than after a round trip.
 */

const SLUG_RE = /^[a-z0-9-]+$/;
const PACKAGE_KEY_RE = /^[A-Z0-9_]+$/;
/** condecimal(max_digits=10, decimal_places=2) → at most 8 integer digits. */
const PRICE_RE = /^\d{1,8}(\.\d{1,2})?$/;

const slug = z
  .string()
  .trim()
  .min(2, 'อย่างน้อย 2 ตัวอักษร')
  .max(60, 'ยาวได้ไม่เกิน 60 ตัวอักษร')
  .regex(SLUG_RE, 'ใช้ได้เฉพาะ a–z ตัวเล็ก ตัวเลข และขีดกลาง');

const name120 = z
  .string()
  .trim()
  .min(1, 'กรอกข้อมูลนี้')
  .max(120, 'ยาวได้ไม่เกิน 120 ตัวอักษร');

/**
 * Optional free text. Kept as a plain string (no zod .transform) so the form's
 * input and output types stay identical — react-hook-form is much happier that
 * way. An empty field becomes `undefined` at submit time via `optional()`.
 */
const optionalText = (max: number) =>
  z.string().trim().max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`);

const price = z
  .string()
  .trim()
  .min(1, 'กรอกราคา')
  .regex(PRICE_RE, 'ตัวเลขเท่านั้น ทศนิยมไม่เกิน 2 ตำแหน่ง');

export const tenantCreateSchema = z.object({
  name: name120,
  slug,
  legal_name: optionalText(255),
  tax_id: optionalText(20),
  billing_email: z.union([z.literal(''), z.email('รูปแบบอีเมลไม่ถูกต้อง')]),
  billing_address: optionalText(500),
});
export type TenantCreateForm = z.infer<typeof tenantCreateSchema>;

/** Drop the empty optional fields — the API wants them absent, not "". */
export function toTenantPayload(v: TenantCreateForm) {
  const trimmed = (s: string) => {
    const t = s.trim();
    return t.length > 0 ? t : undefined;
  };
  return {
    name: v.name.trim(),
    slug: v.slug.trim(),
    legal_name: trimmed(v.legal_name),
    tax_id: trimmed(v.tax_id),
    billing_email: trimmed(v.billing_email),
    billing_address: trimmed(v.billing_address),
  };
}

export const storeCreateSchema = z.object({
  name: name120,
  slug,
  owner_name: name120,
  vat_enabled: z.boolean(),
});
export type StoreCreateForm = z.infer<typeof storeCreateSchema>;

export const packageFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, 'อย่างน้อย 2 ตัวอักษร')
    .max(40, 'ยาวได้ไม่เกิน 40 ตัวอักษร')
    .regex(PACKAGE_KEY_RE, 'ใช้ได้เฉพาะ A–Z ตัวใหญ่ ตัวเลข และขีดล่าง'),
  name_th: name120,
  name_en: name120,
  /** Entered as one key per line; split on submit. */
  feature_keys: z.string(),
  price_monthly: price,
  price_annual: price,
});
export type PackageForm = z.infer<typeof packageFormSchema>;

export const suspendSchema = z.object({
  reason: z
    .string()
    .min(1, 'ต้องระบุเหตุผล')
    .max(500, 'ยาวได้ไม่เกิน 500 ตัวอักษร')
    .refine((v) => v.trim().length > 0, 'ต้องระบุเหตุผล ไม่ใช่เว้นว่าง'),
});
export type SuspendForm = z.infer<typeof suspendSchema>;

export const resumeSchema = z.object({
  reason: z.string().max(500, 'ยาวได้ไม่เกิน 500 ตัวอักษร'),
});
export type ResumeForm = z.infer<typeof resumeSchema>;

export const loginSchema = z.object({
  email: z.email('รูปแบบอีเมลไม่ถูกต้อง'),
  // bcrypt's own limit is 72 bytes; this is not a strength gate.
  password: z.string().min(1, 'กรอกรหัสผ่าน'),
});
export type LoginForm = z.infer<typeof loginSchema>;

/** "2500" / "2500.5" → "2500.00" / "2500.50" — the API wants 2 decimal places. */
export function normalizePrice(input: string): string {
  const [intPart, decPart = ''] = input.trim().split('.');
  return `${intPart || '0'}.${decPart.padEnd(2, '0').slice(0, 2)}`;
}

/** Textarea (one per line) → deduped, trimmed feature key list. */
export function parseFeatureKeys(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !seen.has(s) && seen.add(s));
}
