import type { SalespersonReportData, SalespersonKpi, KpiMember } from '@/hooks/use-salesperson-kpi';
import type { Workbook, Worksheet } from 'exceljs';

const MONEY_FMT = '#,##0.00';
const INT_FMT = '#,##0';
const PCT_FMT = '0.0%';
const HEADER_ARGB = 'FFEFE7DD'; // soft latte tone for header rows
const ZEBRA_ARGB = 'FFF6F1EA'; // very light latte — alternating data rows
const SALESBAND_ARGB = 'FFE7DBCB'; // deeper latte — per-salesperson header bands
const SUBTOTAL_ARGB = 'FFF1E9DE'; // light — per-salesperson subtotal rows
const ITEM_ARGB = 'FFFBF8F3'; // very light — indented product item lines

// 'YYYY-MM-DD' → "1 มิถุนายน 2569" (Buddhist era)
function thaiDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH-u-ca-buddhist', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
function thaiDateTime(d: Date): string {
  return d.toLocaleString('th-TH-u-ca-buddhist', { dateStyle: 'long', timeStyle: 'short' });
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

// ── Per-salesperson derived metrics ─────────────────────────────────────────────
// The KPI payload carries raw counts/sums only; everything else (bills, averages,
// share of revenue) is derived here so the workbook can show the fullest picture.
interface SpStats {
  sp: SalespersonKpi;
  orders: number;        // Σ member bills
  nonBuying: number;     // assigned members who didn't buy
  avgTicket: number;     // value / orders
  avgPerBuyer: number;   // value / buying members
  avgItemsPerBill: number;
  pctOfTotal: number;    // share of grand-total revenue
}
function statsFor(sp: SalespersonKpi, grandValue: number): SpStats {
  const orders = sp.members.reduce((s, m) => s + m.orderCount, 0);
  return {
    sp,
    orders,
    nonBuying: sp.memberCount - sp.buyingMemberCount,
    avgTicket: div(sp.totalValue, orders),
    avgPerBuyer: div(sp.totalValue, sp.buyingMemberCount),
    avgItemsPerBill: div(sp.totalItems, orders),
    pctOfTotal: div(sp.totalValue, grandValue),
  };
}

// Members sorted like the on-screen drill-down: buyers first (top spenders), then
// non-buyers by name — so the sheet reads top-to-bottom by importance.
function sortedMembers(sp: SalespersonKpi): KpiMember[] {
  return [...sp.members].sort(
    (a, z) => z.totalValue - a.totalValue || a.name.localeCompare(z.name, 'th'),
  );
}
function topProduct(m: KpiMember): string {
  if (m.items.length === 0) return '';
  return [...m.items].sort((a, z) => z.value - a.value)[0].productName;
}

// Shared decoration helpers ------------------------------------------------------
function titleRow(ws: Worksheet, text: string, cols: number): void {
  ws.addRow([text]);
  ws.mergeCells(1, 1, 1, cols);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
}
function headerRow(ws: Worksheet, headers: readonly string[]): void {
  const head = ws.addRow([...headers]);
  head.font = { bold: true };
  for (let c = 1; c <= headers.length; c++) {
    const cell = head.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}
function fillRow(ws: Worksheet, rowNumber: number, cols: number, argb: string): void {
  const row = ws.getRow(rowNumber);
  for (let c = 1; c <= cols; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  }
}

// ── Sheet: เซลส์ (per-salesperson KPI table) ────────────────────────────────────
const KPI_HEADERS = [
  'ลำดับ', 'เซลส์', 'สมาชิกที่ดูแล', 'สมาชิกที่ซื้อ', 'ยังไม่ซื้อ', 'จำนวนบิล',
  'จำนวนชิ้น', 'ยอดขาย', 'เฉลี่ย/บิล', 'เฉลี่ย/สมาชิกที่ซื้อ', '% ยอดขาย',
] as const;
const KPI_WIDTHS = [6, 28, 13, 12, 10, 11, 11, 16, 14, 18, 11];
const KPI_COLS = KPI_HEADERS.length;

function addKpiSheet(wb: Workbook, data: SalespersonReportData, stats: SpStats[]): void {
  const ws = wb.addWorksheet('เซลส์');
  ws.columns = KPI_WIDTHS.map((w) => ({ width: w }));

  const titleText =
    data.mode === 'daily'
      ? `สรุปรายเซลส์ — ${thaiDate(data.from)}`
      : `สรุปรายเซลส์ — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;
  titleRow(ws, titleText, KPI_COLS);
  headerRow(ws, KPI_HEADERS);

  let zebra = 0;
  stats.forEach((st, i) => {
    const sp = st.sp;
    const row = ws.addRow([
      i + 1, sp.salesName, sp.memberCount, sp.buyingMemberCount, st.nonBuying, st.orders,
      sp.totalItems, sp.totalValue, st.avgTicket, st.avgPerBuyer, st.pctOfTotal,
    ]);
    [3, 4, 5, 6, 7].forEach((c) => { row.getCell(c).numFmt = INT_FMT; });
    [8, 9, 10].forEach((c) => { row.getCell(c).numFmt = MONEY_FMT; });
    row.getCell(11).numFmt = PCT_FMT;
    if (zebra % 2 === 1) fillRow(ws, row.number, KPI_COLS, ZEBRA_ARGB);
    zebra += 1;
  });

  const totalOrders = stats.reduce((s, st) => s + st.orders, 0);
  const totalRow = ws.addRow([
    '', 'รวมทั้งหมด', data.totalMembers, data.buyingMembers,
    stats.reduce((s, st) => s + st.nonBuying, 0), totalOrders,
    data.totalItems, data.totalValue, div(data.totalValue, totalOrders),
    div(data.totalValue, data.buyingMembers), data.totalValue > 0 ? 1 : 0,
  ]);
  totalRow.font = { bold: true };
  fillRow(ws, totalRow.number, KPI_COLS, HEADER_ARGB);
  [3, 4, 5, 6, 7].forEach((c) => { totalRow.getCell(c).numFmt = INT_FMT; });
  [8, 9, 10].forEach((c) => { totalRow.getCell(c).numFmt = MONEY_FMT; });
  totalRow.getCell(11).numFmt = PCT_FMT;

  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ── Sheet: รายละเอียด (drill-down เซลส์ → สมาชิก → สินค้า) ──────────────────────
const DETAIL_HEADERS = [
  'เซลส์ / สมาชิก / สินค้า', 'เบอร์โทร', 'จำนวนบิล', 'จำนวนชิ้น', 'ยอดขาย', 'เฉลี่ย/บิล', 'ราคา/หน่วย', '% ของยอด',
] as const;
const DETAIL_WIDTHS = [42, 15, 11, 11, 16, 13, 13, 11];
const DETAIL_COLS = DETAIL_HEADERS.length;

function addDetailSheet(wb: Workbook, data: SalespersonReportData, stats: SpStats[]): void {
  const ws = wb.addWorksheet('รายละเอียด');
  ws.columns = DETAIL_WIDTHS.map((w) => ({ width: w }));

  const titleText =
    data.mode === 'daily'
      ? `รายละเอียดรายเซลส์ — ${thaiDate(data.from)}`
      : `รายละเอียดรายเซลส์ — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;
  titleRow(ws, titleText, DETAIL_COLS);
  headerRow(ws, DETAIL_HEADERS);

  for (const st of stats) {
    const sp = st.sp;
    // Salesperson band (merged) — a one-line digest of this person's numbers
    const band = ws.addRow([
      `เซลส์: ${sp.salesName}  •  ดูแล ${sp.memberCount} • ซื้อ ${sp.buyingMemberCount}`
      + ` • ยังไม่ซื้อ ${st.nonBuying} • บิล ${st.orders.toLocaleString()}`
      + ` • ยอด ${sp.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      + ` • ${(st.pctOfTotal * 100).toFixed(1)}% ของยอดรวม`,
    ]);
    ws.mergeCells(band.number, 1, band.number, DETAIL_COLS);
    band.font = { bold: true };
    band.alignment = { vertical: 'middle' };
    fillRow(ws, band.number, DETAIL_COLS, SALESBAND_ARGB);

    for (const m of sortedMembers(sp)) {
      const avgTicket = div(m.totalValue, m.orderCount);
      const pctOfSp = div(m.totalValue, sp.totalValue);
      const label = m.orderCount === 0 ? `${m.name}  (ยังไม่ซื้อ)` : m.name;
      const mRow = ws.addRow([
        label, m.phone ?? '', m.orderCount, m.totalItems, m.totalValue, avgTicket, '', pctOfSp,
      ]);
      mRow.getCell(1).font = { bold: true };
      [3, 4].forEach((c) => { mRow.getCell(c).numFmt = INT_FMT; });
      [5, 6].forEach((c) => { mRow.getCell(c).numFmt = MONEY_FMT; });
      mRow.getCell(8).numFmt = PCT_FMT;

      // Product lines for this member (indented), sorted by value desc
      for (const it of [...m.items].sort((a, z) => z.value - a.value)) {
        const unit = div(it.value, it.quantity);
        const pctOfMember = div(it.value, m.totalValue);
        const iRow = ws.addRow([`    ${it.productName}`, '', '', it.quantity, it.value, '', unit, pctOfMember]);
        iRow.getCell(1).alignment = { indent: 1 };
        iRow.getCell(4).numFmt = INT_FMT;
        [5, 7].forEach((c) => { iRow.getCell(c).numFmt = MONEY_FMT; });
        iRow.getCell(8).numFmt = PCT_FMT;
        fillRow(ws, iRow.number, DETAIL_COLS, ITEM_ARGB);
      }
    }

    // Per-salesperson subtotal
    const sub = ws.addRow([
      `รวมเซลส์ ${sp.salesName}`, '', st.orders, sp.totalItems, sp.totalValue, st.avgTicket, '', st.pctOfTotal,
    ]);
    sub.font = { bold: true };
    fillRow(ws, sub.number, DETAIL_COLS, SUBTOTAL_ARGB);
    [3, 4].forEach((c) => { sub.getCell(c).numFmt = INT_FMT; });
    [5, 6].forEach((c) => { sub.getCell(c).numFmt = MONEY_FMT; });
    sub.getCell(8).numFmt = PCT_FMT;
  }

  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ── Sheet: สมาชิกทั้งหมด (flat per-member table across all salespeople) ──────────
const MEMBER_HEADERS = [
  'ลำดับ', 'สมาชิก', 'เบอร์โทร', 'เซลส์', 'จำนวนบิล', 'จำนวนชิ้น', 'ยอดซื้อ', 'เฉลี่ย/บิล', 'จำนวนเมนู', 'เมนูที่ซื้อมากสุด',
] as const;
const MEMBER_WIDTHS = [6, 26, 15, 24, 11, 11, 16, 14, 11, 28];
const MEMBER_COLS = MEMBER_HEADERS.length;

function addMembersSheet(wb: Workbook, data: SalespersonReportData): void {
  const ws = wb.addWorksheet('สมาชิกทั้งหมด');
  ws.columns = MEMBER_WIDTHS.map((w) => ({ width: w }));
  titleRow(ws, 'สมาชิกทั้งหมด (เรียงตามยอดซื้อ)', MEMBER_COLS);
  headerRow(ws, MEMBER_HEADERS);

  // Flatten every member with their salesperson, then rank by spend.
  const rows = data.salespeople
    .flatMap((sp) => sp.members.map((m) => ({ sp, m })))
    .sort((a, z) => z.m.totalValue - a.m.totalValue || a.m.name.localeCompare(z.m.name, 'th'));

  let zebra = 0;
  rows.forEach(({ sp, m }, i) => {
    const row = ws.addRow([
      i + 1, m.name, m.phone ?? '', sp.salesName, m.orderCount, m.totalItems, m.totalValue,
      div(m.totalValue, m.orderCount), m.items.length, topProduct(m),
    ]);
    [5, 6, 9].forEach((c) => { row.getCell(c).numFmt = INT_FMT; });
    [7, 8].forEach((c) => { row.getCell(c).numFmt = MONEY_FMT; });
    if (zebra % 2 === 1) fillRow(ws, row.number, MEMBER_COLS, ZEBRA_ARGB);
    zebra += 1;
  });

  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ── Sheet: สินค้าตามเซลส์ (product totals aggregated per salesperson) ────────────
const PROD_HEADERS = ['เซลส์', 'เมนู', 'จำนวน', 'ยอดขาย', 'ราคา/หน่วย', '% ของเซลส์'] as const;
const PROD_WIDTHS = [26, 34, 11, 16, 13, 12];
const PROD_COLS = PROD_HEADERS.length;

function addProductsSheet(wb: Workbook, stats: SpStats[]): void {
  const ws = wb.addWorksheet('สินค้าตามเซลส์');
  ws.columns = PROD_WIDTHS.map((w) => ({ width: w }));
  titleRow(ws, 'ยอดขายสินค้าแยกตามเซลส์', PROD_COLS);
  headerRow(ws, PROD_HEADERS);

  let zebra = 0;
  for (const st of stats) {
    const sp = st.sp;
    // Aggregate the same product across all of this salesperson's members.
    const agg = new Map<string, { qty: number; value: number }>();
    for (const m of sp.members) {
      for (const it of m.items) {
        const cur = agg.get(it.productName) ?? { qty: 0, value: 0 };
        cur.qty += it.quantity;
        cur.value += it.value;
        agg.set(it.productName, cur);
      }
    }
    if (agg.size === 0) continue;

    const products = [...agg.entries()].sort((a, z) => z[1].value - a[1].value);
    products.forEach(([name, v], idx) => {
      const row = ws.addRow([
        idx === 0 ? sp.salesName : '', name, v.qty, v.value, div(v.value, v.qty), div(v.value, sp.totalValue),
      ]);
      row.getCell(3).numFmt = INT_FMT;
      [4, 5].forEach((c) => { row.getCell(c).numFmt = MONEY_FMT; });
      row.getCell(6).numFmt = PCT_FMT;
      if (zebra % 2 === 1) fillRow(ws, row.number, PROD_COLS, ZEBRA_ARGB);
      zebra += 1;
    });

    // Per-salesperson subtotal
    const sub = ws.addRow([
      '', `รวมเซลส์ ${sp.salesName}`, sp.totalItems, sp.totalValue, '', st.pctOfTotal,
    ]);
    sub.font = { bold: true };
    fillRow(ws, sub.number, PROD_COLS, SUBTOTAL_ARGB);
    sub.getCell(3).numFmt = INT_FMT;
    sub.getCell(4).numFmt = MONEY_FMT;
    sub.getCell(6).numFmt = PCT_FMT;
    zebra = 0; // restart striping under each salesperson block
  }

  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

/**
 * Build a multi-sheet .xlsx workbook from a loaded salesperson report and trigger
 * a browser download. Mirrors downloadSalesReportExcel(): ExcelJS + file-saver are
 * imported dynamically so they never weigh on the app's initial bundle.
 *
 * Sheets: สรุป · เซลส์ (KPI table) · รายละเอียด (เซลส์→สมาชิก→สินค้า) ·
 * สมาชิกทั้งหมด (flat) · สินค้าตามเซลส์.
 */
export async function downloadSalespersonReportExcel(
  data: SalespersonReportData,
  storeName: string,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const { saveAs } = await import('file-saver');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kafé OS';
  wb.created = new Date();

  const stats = data.salespeople.map((sp) => statsFor(sp, data.totalValue));
  const totalOrders = stats.reduce((s, st) => s + st.orders, 0);

  const periodLabel =
    data.mode === 'daily'
      ? `รายวัน — ${thaiDate(data.from)}`
      : `รายเดือน / ช่วงวันที่ — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const s = wb.addWorksheet('สรุป');
  s.columns = [{ width: 28 }, { width: 22 }];
  s.addRow([storeName]);
  s.getRow(1).font = { bold: true, size: 16 };
  s.addRow(['รายงานเซลส์']);
  s.getRow(2).font = { bold: true, size: 13 };
  s.addRow([periodLabel]);
  s.addRow([`ออกรายงานเมื่อ ${thaiDateTime(new Date())}`]);
  s.addRow([]);

  const summary: Array<[string, number, 'money' | 'int']> = [
    ['ยอดขายรวม', data.totalValue, 'money'],
    ['จำนวนเซลส์', data.totalSalespeople, 'int'],
    ['สมาชิกที่ดูแล', data.totalMembers, 'int'],
    ['สมาชิกที่ซื้อ', data.buyingMembers, 'int'],
    ['สมาชิกที่ยังไม่ซื้อ', data.totalMembers - data.buyingMembers, 'int'],
    ['จำนวนบิลรวม', totalOrders, 'int'],
    ['จำนวนชิ้นที่ขาย', data.totalItems, 'int'],
    ['ยอดเฉลี่ยต่อบิล', div(data.totalValue, totalOrders), 'money'],
    ['ยอดเฉลี่ยต่อเซลส์', div(data.totalValue, data.totalSalespeople), 'money'],
    ['ยอดเฉลี่ยต่อสมาชิกที่ซื้อ', div(data.totalValue, data.buyingMembers), 'money'],
  ];
  if (data.mode === 'range') {
    summary.push(['จำนวนวัน', data.dayCount, 'int']);
    summary.push(['ยอดเฉลี่ยต่อวัน', div(data.totalValue, data.dayCount), 'money']);
  }
  for (const [label, value, kind] of summary) {
    const r = s.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).numFmt = kind === 'money' ? MONEY_FMT : INT_FMT;
  }

  // ── Breakdown sheets ─────────────────────────────────────────────────────────
  addKpiSheet(wb, data, stats);
  addDetailSheet(wb, data, stats);
  addMembersSheet(wb, data);
  addProductsSheet(wb, stats);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const filename =
    data.mode === 'daily'
      ? `รายงานเซลส์_${data.from}.xlsx`
      : `รายงานเซลส์_${data.from}_ถึง_${data.to}.xlsx`;
  saveAs(blob, filename);
}
