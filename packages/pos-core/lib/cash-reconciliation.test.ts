import { describe, expect, it } from 'vitest';
import {
  buildClosePayload, buildCloseRows, checkActualAmount, closeTotals, draftFromConfig, draftToConfig,
  hasDraftErrors, validateGroupsDraft, variance, PAYMENT_METHODS,
  type PaymentGroupConfig, type SessionSummaryRead,
} from './cash-reconciliation';

const DEFAULT_GROUPS: PaymentGroupConfig[] = [
  { name: 'Cash', methods: ['CASH'] },
  { name: 'Online', methods: ['CARD', 'QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY', 'OTHER'] },
];
const SUMMARY: SessionSummaryRead = {
  session_id: 'abc123', period_from: '2026-06-07T08:00:00+07:00', period_to: '2026-06-07T20:14:00+07:00',
  groups: [
    { name: 'Cash', methods: ['CASH'], system_total: '4250.00' },
    { name: 'Online', methods: ['CARD', 'QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY', 'OTHER'], system_total: '12800.50' },
  ],
};

describe('variance (actual − system, decimal strings)', () => {
  it('handoff example: counted 4100 vs 4250 → -150.00 short', () => {
    expect(variance('4100.00', '4250.00')).toEqual({ value: '-150.00', tone: 'short' });
  });
  it('even and over', () => {
    expect(variance('12800.50', '12800.50')).toEqual({ value: '0.00', tone: 'even' });
    expect(variance('100.10', '100.00')).toEqual({ value: '0.10', tone: 'over' });
  });
  it('no float drift on satang', () => {
    expect(variance('0.30', '0.10')?.value).toBe('0.20');
    expect(variance('1000000.01', '999999.99')?.value).toBe('0.02');
  });
  it('invalid → null', () => expect(variance('', '1.00')).toBeNull());
});

describe('checkActualAmount', () => {
  it('normalises to 2 decimals', () => {
    expect(checkActualAmount('4100')).toEqual({ ok: true, value: '4100.00' });
    expect(checkActualAmount('4100.5')).toEqual({ ok: true, value: '4100.50' });
    expect(checkActualAmount('1,234.50')).toEqual({ ok: true, value: '1234.50' });
    expect(checkActualAmount('0')).toEqual({ ok: true, value: '0.00' });
  });
  it('rejects empty, negative, >2 decimals, garbage', () => {
    expect(checkActualAmount('')).toEqual({ ok: false, error: 'กรอกยอดนับจริง' });
    expect(checkActualAmount('-1')).toEqual({ ok: false, error: 'ยอดต้องไม่ติดลบ' });
    expect(checkActualAmount('10.555')).toEqual({ ok: false, error: 'ทศนิยมได้ไม่เกิน 2 ตำแหน่ง' });
    expect(checkActualAmount('สิบบาท').ok).toBe(false);
  });
});

describe('buildCloseRows', () => {
  it('rows follow the configured groups, system totals by exact name', () => {
    const { rows, mismatch } = buildCloseRows(DEFAULT_GROUPS, SUMMARY);
    expect(mismatch).toBe(false);
    expect(rows.map((r) => [r.name, r.systemTotal])).toEqual([['Cash', '4250.00'], ['Online', '12800.50']]);
  });
  it('4 custom groups → 4 rows (handoff scenario 7)', () => {
    const groups: PaymentGroupConfig[] = [
      { name: 'Cash', methods: ['CASH'] }, { name: 'Card', methods: ['CARD'] },
      { name: 'QR / Wallet', methods: ['QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY'] }, { name: 'Other', methods: ['OTHER'] },
    ];
    const summary = { ...SUMMARY, groups: groups.map((g) => ({ ...g, system_total: '0.00' })) };
    expect(buildCloseRows(groups, summary).rows).toHaveLength(4);
  });
  it('flags a name mismatch (case-sensitive) — the close would 422', () => {
    const { rows, mismatch } = buildCloseRows([{ name: 'cash', methods: ['CASH'] }, DEFAULT_GROUPS[1]], SUMMARY);
    expect(mismatch).toBe(true);
    expect(rows[0].systemTotal).toBeNull();
  });
  it('no summary yet → no mismatch, null totals', () => {
    expect(buildCloseRows(DEFAULT_GROUPS, undefined).mismatch).toBe(false);
  });
});

describe('buildClosePayload', () => {
  const { rows } = buildCloseRows(DEFAULT_GROUPS, SUMMARY);

  it('one entry per group, exact names, 2-dp amounts, empty notes → null', () => {
    const r = buildClosePayload(rows, {
      Cash: { actual: '4100', notes: '  Missing 150 baht — recount tomorrow ' },
      Online: { actual: '12800.50', notes: '   ' },
    });
    expect(r).toEqual({
      ok: true,
      payload: {
        entries: [
          { group_name: 'Cash', actual_amount: '4100.00', notes: 'Missing 150 baht — recount tomorrow' },
          { group_name: 'Online', actual_amount: '12800.50', notes: null },
        ],
      },
    });
  });

  it('never submits a partial close: a missing group is an error, not an omitted entry', () => {
    const r = buildClosePayload(rows, { Cash: { actual: '4100', notes: '' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.actual).toEqual({ Online: 'กรอกยอดนับจริง' });
  });

  it('notes > 1000 chars rejected', () => {
    const r = buildClosePayload(rows, { Cash: { actual: '1', notes: 'x'.repeat(1001) }, Online: { actual: '1', notes: '' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.notes.Cash).toMatch(/1000/);
  });

  it('zero-sales session closes with 0.00 everywhere (handoff scenario 8)', () => {
    const zero = buildCloseRows(DEFAULT_GROUPS, { ...SUMMARY, groups: SUMMARY.groups.map((g) => ({ ...g, system_total: '0.00' })) }).rows;
    const r = buildClosePayload(zero, { Cash: { actual: '0', notes: '' }, Online: { actual: '0.00', notes: '' } });
    expect(r.ok && r.payload.entries.map((e) => e.actual_amount)).toEqual(['0.00', '0.00']);
  });

  it('closeTotals sums exactly and only reports variance when every row is filled', () => {
    expect(closeTotals(rows, { Cash: { actual: '4100', notes: '' } })).toMatchObject({ system: '17050.50', complete: false, variance: null });
    expect(closeTotals(rows, { Cash: { actual: '4100', notes: '' }, Online: { actual: '12800.50', notes: '' } }))
      .toMatchObject({ system: '17050.50', actual: '16900.50', complete: true, variance: { value: '-150.00', tone: 'short' } });
  });
});

describe('payment-group config draft', () => {
  it('round-trips the default config', () => {
    const d = draftFromConfig(DEFAULT_GROUPS);
    expect(hasDraftErrors(validateGroupsDraft(d))).toBe(false);
    expect(draftToConfig(d)).toEqual(DEFAULT_GROUPS);
  });

  it('every method must be assigned (backend 422: missing method)', () => {
    const d = draftFromConfig([{ name: 'Cash', methods: ['CASH'] }]);
    const e = validateGroupsDraft(d);
    expect(Object.keys(e.method).sort()).toEqual(PAYMENT_METHODS.filter((m) => m !== 'CASH').sort());
  });

  it('a method listed twice in the source config is assigned to the first group only', () => {
    const d = draftFromConfig([{ name: 'A', methods: ['CASH', 'CARD'] }, { name: 'B', methods: ['CARD', 'QR_PROMPTPAY', 'LINE_PAY', 'TRUEMONEY', 'OTHER'] }]);
    expect(draftToConfig(d)[1].methods).not.toContain('CARD');
  });

  it('names: required, ≤ 100 chars, unique (exact, after trim)', () => {
    const d = draftFromConfig(DEFAULT_GROUPS);
    expect(validateGroupsDraft({ ...d, groups: [{ key: 'g0', name: '  ' }, d.groups[1]] }).group.g0).toBe('ตั้งชื่อกลุ่ม');
    expect(validateGroupsDraft({ ...d, groups: [{ key: 'g0', name: 'x'.repeat(101) }, d.groups[1]] }).group.g0).toMatch(/100/);
    expect(validateGroupsDraft({ ...d, groups: [d.groups[0], { key: 'g1', name: ' Cash ' }] }).group.g1).toBe('ชื่อกลุ่มซ้ำกัน');
    // Case differs → allowed (the backend matches case-sensitively).
    expect(validateGroupsDraft({ ...d, groups: [d.groups[0], { key: 'g1', name: 'cash' }] }).group.g1).toBeUndefined();
  });

  it('an empty group is an error (each group needs ≥ 1 method)', () => {
    const d = draftFromConfig(DEFAULT_GROUPS);
    const withEmpty = { ...d, groups: [...d.groups, { key: 'g9', name: 'Spare' }] };
    expect(validateGroupsDraft(withEmpty).group.g9).toBe('ยังไม่มีช่องทางชำระเงินในกลุ่มนี้');
  });

  it('removing a group unassigns its methods', () => {
    const d = draftFromConfig(DEFAULT_GROUPS);
    const e = validateGroupsDraft({ ...d, groups: [d.groups[1]] });
    expect(e.method.CASH).toBe('ยังไม่ได้เลือกกลุ่ม');
  });

  it('no groups → form error', () => {
    const d = draftFromConfig([]);
    expect(validateGroupsDraft(d).form).toEqual(['ต้องมีอย่างน้อย 1 กลุ่ม']);
  });
});
