/**
 * Pure logic for session reconciliation (handoff session-reconciliation/api-handoff.md):
 * payment-group config validation, the per-group close form, and the variance shown
 * before the server stores its own. Money is decimal strings throughout (lib/money).
 */
import { moneySign, moneyToSatang, satangToMoney, subMoney, sumMoney } from './money';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const PAYMENT_METHODS = ['CASH', 'CARD', 'QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'เงินสด',
  CARD: 'บัตรเครดิต / เดบิต',
  QR_PROMPTPAY: 'พร้อมเพย์ QR',
  LINE_PAY: 'LINE Pay',
  TRUEMONEY: 'TrueMoney',
  OTHER: 'อื่น ๆ',
};

export const GROUP_NAME_MAX = 100;
export const NOTES_MAX = 1000;

// ── API shapes ────────────────────────────────────────────────────────────────

export interface PaymentGroupConfig { name: string; methods: PaymentMethod[] }

export interface SessionGroupSummary { name: string; methods: PaymentMethod[]; system_total: string }

export interface SessionSummaryRead {
  session_id: string;
  period_from: string;
  period_to: string;
  groups: SessionGroupSummary[];
}

export interface ReconciliationEntryCreate { group_name: string; actual_amount: string; notes: string | null }

export interface CashSessionClosePayload { entries: ReconciliationEntryCreate[] }

export interface SessionPaymentEntryRead {
  id: string;
  session_id: string;
  group_name: string;
  methods: PaymentMethod[];
  system_total: string;
  actual_amount: string;
  variance: string;
  notes: string | null;
}

// ── Payment-group config editor ───────────────────────────────────────────────

/**
 * Editor model: group names in display order + which group each method belongs to.
 * Assigning by method (one Select per method) makes "a method in two groups" impossible
 * by construction; the validator still checks every rule the backend enforces (422).
 */
export interface GroupsDraft {
  /** Stable client keys so renaming a group does not re-mount its row. */
  groups: { key: string; name: string }[];
  /** method → group key ('' = not assigned yet). */
  assignment: Record<PaymentMethod, string>;
}

export interface GroupsDraftErrors {
  /** Per group key. */
  group: Record<string, string>;
  /** Per method. */
  method: Partial<Record<PaymentMethod, string>>;
  /** Form-level. */
  form: string[];
}

export function draftFromConfig(config: readonly PaymentGroupConfig[], keyOf: (i: number) => string = (i) => `g${i}`): GroupsDraft {
  const groups = config.map((g, i) => ({ key: keyOf(i), name: g.name }));
  const assignment = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, ''])) as Record<PaymentMethod, string>;
  config.forEach((g, i) => {
    for (const m of g.methods) if ((PAYMENT_METHODS as readonly string[]).includes(m) && !assignment[m]) assignment[m] = groups[i].key;
  });
  return { groups, assignment };
}

export function validateGroupsDraft(d: GroupsDraft): GroupsDraftErrors {
  const errors: GroupsDraftErrors = { group: {}, method: {}, form: [] };
  if (d.groups.length === 0) errors.form.push('ต้องมีอย่างน้อย 1 กลุ่ม');
  const seen = new Map<string, string>();
  for (const g of d.groups) {
    const name = g.name.trim();
    if (!name) errors.group[g.key] = 'ตั้งชื่อกลุ่ม';
    else if (name.length > GROUP_NAME_MAX) errors.group[g.key] = `ชื่อยาวได้ไม่เกิน ${GROUP_NAME_MAX} ตัวอักษร`;
    // Names are the join key of the close payload (exact, case-sensitive): a repeat
    // would make two rows indistinguishable.
    else if (seen.has(name)) errors.group[g.key] = 'ชื่อกลุ่มซ้ำกัน';
    else seen.set(name, g.key);
  }
  const keys = new Set(d.groups.map((g) => g.key));
  for (const m of PAYMENT_METHODS) {
    if (!d.assignment[m] || !keys.has(d.assignment[m])) errors.method[m] = 'ยังไม่ได้เลือกกลุ่ม';
  }
  for (const g of d.groups) {
    if (errors.group[g.key]) continue;
    if (!PAYMENT_METHODS.some((m) => d.assignment[m] === g.key)) errors.group[g.key] = 'ยังไม่มีช่องทางชำระเงินในกลุ่มนี้';
  }
  return errors;
}

export const hasDraftErrors = (e: GroupsDraftErrors) =>
  e.form.length > 0 || Object.keys(e.group).length > 0 || Object.keys(e.method).length > 0;

/** PATCH /hr/payment-groups body — group order kept, methods in enum order, names trimmed. */
export function draftToConfig(d: GroupsDraft): PaymentGroupConfig[] {
  return d.groups.map((g) => ({
    name: g.name.trim(),
    methods: PAYMENT_METHODS.filter((m) => d.assignment[m] === g.key),
  }));
}

// ── Close form ────────────────────────────────────────────────────────────────

export interface CloseRow {
  name: string;
  methods: PaymentMethod[];
  /** null when the summary has no figure for this group (config changed underneath). */
  systemTotal: string | null;
}

/**
 * Form rows come from the configured groups (handoff: "do not hardcode group names");
 * the system total is looked up by exact name in the session summary. `mismatch` is true
 * when the two disagree — the close would 422, so the form asks for a reload instead.
 */
export function buildCloseRows(groups: readonly PaymentGroupConfig[], summary: SessionSummaryRead | null | undefined): { rows: CloseRow[]; mismatch: boolean } {
  const byName = new Map((summary?.groups ?? []).map((g) => [g.name, g]));
  const rows = groups.map((g) => ({ name: g.name, methods: [...g.methods], systemTotal: byName.get(g.name)?.system_total ?? null }));
  const mismatch = !!summary && (summary.groups.length !== groups.length || rows.some((r) => r.systemTotal == null));
  return { rows, mismatch };
}

export type ActualCheck = { ok: true; value: string } | { ok: false; error: string };

/** Validation for an "actual amount" input: required, ≥ 0, at most 2 decimals. */
export function checkActualAmount(input: string): ActualCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'กรอกยอดนับจริง' };
  if (raw.startsWith('-')) return { ok: false, error: 'ยอดต้องไม่ติดลบ' };
  const s = moneyToSatang(raw);
  if (s == null) {
    return /^\+?[\d,]*\.\d{3,}$/.test(raw)
      ? { ok: false, error: 'ทศนิยมได้ไม่เกิน 2 ตำแหน่ง' }
      : { ok: false, error: 'กรอกเป็นตัวเลข เช่น 4100 หรือ 4100.50' };
  }
  return { ok: true, value: satangToMoney(s) };
}

export type VarianceTone = 'short' | 'over' | 'even';

/** variance = actual − system (negative = counted less than expected). */
export function variance(actual: string | null | undefined, system: string | null | undefined): { value: string; tone: VarianceTone } | null {
  const v = subMoney(actual, system);
  if (v == null) return null;
  const s = moneySign(v);
  return { value: v, tone: s! < 0 ? 'short' : s! > 0 ? 'over' : 'even' };
}

export interface CloseDraftRow { actual: string; notes: string }

export type CloseBuild =
  | { ok: true; payload: CashSessionClosePayload }
  | { ok: false; actual: Record<string, string>; notes: Record<string, string> };

/** Close payload: exactly one entry per configured group, by exact name; notes trimmed, empty → null. */
export function buildClosePayload(rows: readonly CloseRow[], draft: Readonly<Record<string, CloseDraftRow | undefined>>): CloseBuild {
  const actualErr: Record<string, string> = {};
  const notesErr: Record<string, string> = {};
  const entries: ReconciliationEntryCreate[] = [];
  for (const r of rows) {
    const d = draft[r.name] ?? { actual: '', notes: '' };
    const a = checkActualAmount(d.actual);
    if (!a.ok) actualErr[r.name] = a.error;
    const notes = d.notes.trim();
    if (notes.length > NOTES_MAX) notesErr[r.name] = `หมายเหตุยาวได้ไม่เกิน ${NOTES_MAX} ตัวอักษร`;
    if (a.ok) entries.push({ group_name: r.name, actual_amount: a.value, notes: notes || null });
  }
  if (rows.length === 0) return { ok: false, actual: { '': 'ยังไม่มีกลุ่มการชำระเงิน' }, notes: {} };
  if (Object.keys(actualErr).length || Object.keys(notesErr).length) return { ok: false, actual: actualErr, notes: notesErr };
  return { ok: true, payload: { entries } };
}

/** Totals across rows for the footer: system, actual (valid inputs only), variance. */
export function closeTotals(rows: readonly CloseRow[], draft: Readonly<Record<string, CloseDraftRow | undefined>>) {
  const system = sumMoney(rows.map((r) => r.systemTotal));
  const actuals = rows.map((r) => {
    const a = checkActualAmount(draft[r.name]?.actual ?? '');
    return a.ok ? a.value : null;
  });
  const complete = actuals.every((a) => a != null);
  const actual = sumMoney(actuals);
  return { system, actual, complete, variance: complete ? variance(actual, system) : null };
}
