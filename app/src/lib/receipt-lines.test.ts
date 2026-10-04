import { describe, expect, it } from 'vitest';
import { buildReceiptLines, type ReceiptLine, type ReceiptLinesInput } from './receipt-lines';

const base: ReceiptLinesInput = {
  storeName: 'Kafé OS',
  orderNumber: '47',
  dateStr: '1 ม.ค. 2569 12:00',
  items: [{ name: 'ลาเต้', qty: 2, unitPrice: 60 }],
  total: 120,
  paymentLabel: 'เงินสด',
};

const text = (lines: ReceiptLine[]) =>
  lines.map((l) => (l.t === 'text' ? l.s : l.t === 'lr' ? `${l.l}|${l.r}` : `<${l.t}>`));
const has = (lines: ReceiptLine[], needle: string) => text(lines).some((x) => x.includes(needle));

describe('buildReceiptLines', () => {
  it('prints header, order number, items with line total and unit breakdown', () => {
    const t = text(buildReceiptLines(base));
    expect(t[0]).toBe('Kafé OS');
    expect(t).toContain('ใบเสร็จรับเงิน');
    expect(t).toContain('ออเดอร์: #47');
    expect(t).toContain('ลาเต้|120.00');
    expect(t).toContain('  2 x 60.00');
    expect(t).toContain('รวมทั้งสิ้น (บาท)|120.00');
    expect(t).toContain('ชำระ: เงินสด');
    expect(t[t.length - 1]).toBe('ขอบคุณที่ใช้บริการ');
  });

  it('total in Thai words matches the total', () => {
    expect(has(buildReceiptLines(base), '(หนึ่งร้อยยี่สิบบาทถ้วน)')).toBe(true);
  });

  it('marks only reprints as สำเนา', () => {
    expect(has(buildReceiptLines(base), 'สำเนา')).toBe(false);
    expect(has(buildReceiptLines({ ...base, copy: true }), 'สำเนา')).toBe(true);
  });

  it('omits optional store / invoice / member lines when absent, prints them when present', () => {
    const bare = buildReceiptLines(base);
    expect(has(bare, 'ผู้เสียภาษี')).toBe(false);
    expect(has(bare, 'เลขที่:')).toBe(false);
    expect(has(bare, 'ลูกค้า:')).toBe(false);
    const full = buildReceiptLines({
      ...base, storeAddress: '1 ถนนกาแฟ', storeTaxId: '0105500000000', storeBranch: 'สาขาหลัก',
      storePhone: '021234567', invoiceNo: 'IV2569-0047', memberName: 'สมชาย', salesName: 'ฝน',
    });
    expect(has(full, 'ผู้เสียภาษี: 0105500000000')).toBe(true);
    expect(has(full, 'โทร. 021234567')).toBe(true);
    expect(has(full, 'เลขที่: IV2569-0047')).toBe(true);
    expect(has(full, 'ลูกค้า: สมชาย')).toBe(true);
    expect(has(full, 'เซลล์: ฝน')).toBe(true);
  });

  it('item modifiers print as "+ mod" lines under the item', () => {
    const t = text(buildReceiptLines({
      ...base, items: [{ name: 'ลาเต้', qty: 1, unitPrice: 70, mods: ['ขนาด L', 'เพิ่มช็อต'] }], total: 70,
    }));
    const i = t.indexOf('  1 x 70.00');
    expect(t.slice(i + 1, i + 3)).toEqual(['  + ขนาด L', '  + เพิ่มช็อต']);
  });

  describe('discount block', () => {
    it('does not print รวม / ส่วนลด when there is no discount', () => {
      const t = text(buildReceiptLines(base));
      expect(t.some((x) => x.startsWith('รวม|'))).toBe(false);
      expect(t.some((x) => x.startsWith('ส่วนลด'))).toBe(false);
    });

    it('prints subtotal and a single ส่วนลด line when only a total discount is known', () => {
      const t = text(buildReceiptLines({ ...base, total: 100, discount: 20 }));
      expect(t).toContain('รวม|120.00'); // total + discount
      expect(t).toContain('ส่วนลด|-20.00');
    });

    it('uses the explicit subtotal and per-line breakdown when given', () => {
      const t = text(buildReceiptLines({
        ...base, subtotal: 130, total: 100, discount: 30,
        discountLines: [{ label: 'โปรเช้า', amount: 20 }, { label: 'แต้มสมาชิก', amount: 10 }],
      }));
      expect(t).toContain('รวม|130.00');
      expect(t).toContain('  โปรเช้า|-20.00');
      expect(t).toContain('  แต้มสมาชิก|-10.00');
      expect(t.some((x) => x === 'ส่วนลด|-30.00')).toBe(false);
    });

    it('a zero discount prints nothing', () => {
      expect(has(buildReceiptLines({ ...base, discount: 0 }), 'ส่วนลด')).toBe(false);
    });
  });

  describe('cash tender', () => {
    it('prints received and change = given - total', () => {
      const t = text(buildReceiptLines({ ...base, cashGiven: 200 }));
      expect(t).toContain('รับเงิน|200.00');
      expect(t).toContain('เงินทอน|80.00');
    });

    it('exact cash gives 0.00 change; omitted cashGiven prints no tender', () => {
      expect(text(buildReceiptLines({ ...base, cashGiven: 120 }))).toContain('เงินทอน|0.00');
      expect(has(buildReceiptLines(base), 'เงินทอน')).toBe(false);
    });
  });

  describe('membership points', () => {
    const member = { ...base, memberName: 'สมชาย' };
    it('earn: shows +points and balance', () => {
      const t = text(buildReceiptLines({ ...member, pointsEarned: 12, pointsBalanceAfter: 112 }));
      expect(t).toContain('ได้รับแต้ม|+12 แต้ม');
      expect(t).toContain('แต้มสะสมคงเหลือ|112 แต้ม');
    });
    it('redeem: shows -points with reward label', () => {
      const t = text(buildReceiptLines({ ...member, pointsRedeemed: 100, rewardLabel: 'ลาเต้ฟรี', pointsBalanceAfter: 5 }));
      expect(t).toContain('ใช้แต้มแลก: ลาเต้ฟรี|-100 แต้ม');
    });
    it('no member name -> no points block even if numbers are passed', () => {
      expect(has(buildReceiptLines({ ...base, pointsEarned: 5 }), 'แต้ม')).toBe(false);
    });
  });

  it('every line has a known op type and the footer carries signature + thanks', () => {
    const lines = buildReceiptLines(base);
    for (const l of lines) expect(['text', 'lr', 'hr', 'sp']).toContain(l.t);
    expect(has(lines, 'ลงชื่อผู้รับเงิน')).toBe(true);
  });
});
