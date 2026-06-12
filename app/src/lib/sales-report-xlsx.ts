import type { SalesReportData, ReportRow } from '@/hooks/use-sales-report';
import type { Workbook } from 'exceljs';

const MONEY_FMT = '#,##0.00';
const HEADER_ARGB = 'FFEFE7DD'; // soft latte tone for header rows

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

// ── Register sheet (ยอดขาย.xltx layout) ────────────────────────────────────────
// Flat per-line register: title row + header + one row per product line, with
// bill-level columns (discount/net/payment/note) on the first line of each bill
// only — matching the on-screen RegisterTable.
const REGISTER_HEADERS = [
  'ลำดับ', 'เลขที่บิล', 'วันที่', 'เวลา', 'ช่องทาง', 'รายการ',
  'จำนวน', 'ราคา/หน่วย', 'จำนวนเงิน', 'ส่วนลด', 'สุทธิ', 'ชำระเงิน', 'หมายเหตุ',
] as const;
const REGISTER_WIDTHS = [6, 12, 12, 8, 12, 34, 9, 12, 14, 12, 14, 16, 22];
const REGISTER_COLS = REGISTER_HEADERS.length;
const ZEBRA_ARGB = 'FFF6F1EA'; // very light latte — alternating bill bands

function addRegisterSheet(wb: Workbook, data: SalesReportData): void {
  const ws = wb.addWorksheet('การขาย');
  ws.columns = REGISTER_WIDTHS.map((w) => ({ width: w }));

  const titleText =
    data.mode === 'daily'
      ? `ข้อมูลการขาย — ${thaiDate(data.from)}`
      : `ข้อมูลการขาย — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;
  ws.addRow([titleText]);
  ws.mergeCells(1, 1, 1, REGISTER_COLS);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // Header — style every column explicitly (incl. ชำระเงิน / หมายเหตุ) so the
  // fill never stops short of the last column.
  const head = ws.addRow([...REGISTER_HEADERS]);
  head.font = { bold: true };
  for (let c = 1; c <= REGISTER_COLS; c++) {
    const cell = head.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }

  let totalLine = 0;
  let totalNet = 0;
  data.register.forEach((r, idx) => {
    const first = r.firstOfBill;
    const row = ws.addRow([
      r.no,
      first ? r.billNo : '',
      first ? r.date : '',
      first ? r.time : '',
      first ? r.channel : '',
      r.product,
      r.qty,
      r.unitPrice,
      r.lineTotal,
      first && r.billDiscount ? r.billDiscount : null,
      first ? r.billNet ?? 0 : null,
      first ? r.billPayment ?? '' : '',
      first ? r.billNote ?? '' : '',
    ]);
    [8, 9, 10, 11].forEach((c) => { row.getCell(c).numFmt = MONEY_FMT; });
    if (idx % 2 === 1) { // alternate every row, like the reference workbook
      for (let c = 1; c <= REGISTER_COLS; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_ARGB } };
      }
    }
    totalLine += r.lineTotal;
    if (first) totalNet += r.billNet ?? 0;
  });

  const totalRow = ws.addRow(['', '', '', '', '', 'รวม', '', '', totalLine, '', totalNet, '', '']);
  totalRow.font = { bold: true };
  for (let c = 1; c <= REGISTER_COLS; c++) {
    totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
  }
  totalRow.getCell(9).numFmt = MONEY_FMT;
  totalRow.getCell(11).numFmt = MONEY_FMT;

  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

/**
 * Build a multi-sheet .xlsx workbook from a loaded sales report and trigger a
 * browser download. ExcelJS + file-saver are imported dynamically here so they
 * never weigh on the app's initial bundle.
 */
export async function downloadSalesReportExcel(data: SalesReportData, storeName: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const { saveAs } = await import('file-saver');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kafé OS';
  wb.created = new Date();

  const periodLabel =
    data.mode === 'daily'
      ? `รายวัน — ${thaiDate(data.from)}`
      : `รายเดือน / ช่วงวันที่ — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;

  // ── Register sheet (primary — mirrors the on-screen register) ────────────────
  addRegisterSheet(wb, data);

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const s = wb.addWorksheet('สรุป');
  s.columns = [{ width: 28 }, { width: 22 }];
  s.addRow([storeName]);
  s.getRow(1).font = { bold: true, size: 16 };
  s.addRow(['รายงานยอดขาย']);
  s.getRow(2).font = { bold: true, size: 13 };
  s.addRow([periodLabel]);
  s.addRow([`ออกรายงานเมื่อ ${thaiDateTime(new Date())}`]);
  s.addRow([]);

  const summary: Array<[string, number, boolean]> = [
    ['ยอดขายรวม', data.totalRevenue, true],
    ['จำนวนบิล', data.totalOrders, false],
    ['ยอดเฉลี่ยต่อบิล', data.avgTicket, true],
  ];
  if (data.mode === 'range') {
    summary.push(['จำนวนวัน', data.dayCount, false]);
    summary.push(['ยอดเฉลี่ยต่อวัน', data.avgPerDay, true]);
  }
  for (const [label, value, money] of summary) {
    const r = s.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    if (money) r.getCell(2).numFmt = MONEY_FMT;
  }

  // ── Breakdown sheets ─────────────────────────────────────────────────────────
  function addTableSheet(name: string, headers: [string, string, string], rows: ReportRow[]) {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ width: 34 }, { width: 14 }, { width: 18 }];
    const head = ws.addRow(headers);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
      c.alignment = { vertical: 'middle' };
    });

    let totalCount = 0;
    let totalRev = 0;
    for (const row of rows) {
      const r = ws.addRow([row.label, row.orderCount, row.revenue]);
      r.getCell(3).numFmt = MONEY_FMT;
      totalCount += row.orderCount;
      totalRev += row.revenue;
    }

    const totalRow = ws.addRow(['รวม', totalCount, totalRev]);
    totalRow.font = { bold: true };
    totalRow.getCell(3).numFmt = MONEY_FMT;

    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  if (data.mode === 'range') {
    addTableSheet('รายวัน', ['วันที่', 'จำนวนบิล', 'ยอดขาย'], data.byDay);
  }
  addTableSheet('แยกตามเมนู', ['เมนู', 'จำนวน', 'ยอดขาย'], data.byProduct);
  addTableSheet('แยกตามหมวด', ['หมวดหมู่', 'จำนวนบิล', 'ยอดขาย'], data.byCategory);
  addTableSheet('แยกตามวิธีชำระเงิน', ['วิธีชำระเงิน', 'จำนวนบิล', 'ยอดขาย'], data.byPayment);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const filename =
    data.mode === 'daily'
      ? `รายงานยอดขาย_${data.from}.xlsx`
      : `รายงานยอดขาย_${data.from}_ถึง_${data.to}.xlsx`;
  saveAs(blob, filename);
}
