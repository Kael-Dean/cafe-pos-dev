import type { SalespersonReportData, SalespersonKpi } from '@/hooks/use-salesperson-kpi';

const MONEY_FMT = '#,##0.00';
const INT_FMT = '#,##0';
const HEADER_ARGB = 'FFEFE7DD'; // soft latte tone for header rows
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

// Members come from the API in arbitrary order — sort like the on-screen
// drill-down (top spenders first) so the sheet reads the same.
function sortedMembers(sp: SalespersonKpi) {
  return [...sp.members].sort(
    (a, z) => z.totalValue - a.totalValue || a.name.localeCompare(z.name, 'th'),
  );
}

// ── Per-salesperson summary sheet ───────────────────────────────────────────────
const SUMMARY_HEADERS = ['ลำดับ', 'เซลส์', 'สมาชิกที่ดูแล', 'สมาชิกที่ซื้อ', 'จำนวนชิ้น', 'ยอดขาย'] as const;
const SUMMARY_WIDTHS = [6, 30, 14, 14, 12, 16];
const SUMMARY_COLS = SUMMARY_HEADERS.length;

function addSummaryTableSheet(wb: import('exceljs').Workbook, data: SalespersonReportData): void {
  const ws = wb.addWorksheet('เซลส์');
  ws.columns = SUMMARY_WIDTHS.map((w) => ({ width: w }));

  const head = ws.addRow([...SUMMARY_HEADERS]);
  head.font = { bold: true };
  for (let c = 1; c <= SUMMARY_COLS; c++) {
    const cell = head.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }

  data.salespeople.forEach((sp, i) => {
    const row = ws.addRow([
      i + 1, sp.salesName, sp.memberCount, sp.buyingMemberCount, sp.totalItems, sp.totalValue,
    ]);
    [3, 4, 5].forEach((c) => { row.getCell(c).numFmt = INT_FMT; });
    row.getCell(6).numFmt = MONEY_FMT;
  });

  const totalRow = ws.addRow([
    '', 'รวมทั้งหมด', data.totalMembers, data.buyingMembers, data.totalItems, data.totalValue,
  ]);
  totalRow.font = { bold: true };
  for (let c = 1; c <= SUMMARY_COLS; c++) {
    totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
  }
  [3, 4, 5].forEach((c) => { totalRow.getCell(c).numFmt = INT_FMT; });
  totalRow.getCell(6).numFmt = MONEY_FMT;

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── Drill-down sheet (เซลส์ → สมาชิก → สินค้า) ──────────────────────────────────
const DETAIL_HEADERS = ['เซลส์ / สมาชิก / สินค้า', 'เบอร์โทร', 'จำนวนบิล', 'จำนวนชิ้น', 'ยอดขาย'] as const;
const DETAIL_WIDTHS = [40, 16, 12, 12, 16];
const DETAIL_COLS = DETAIL_HEADERS.length;

function addDetailSheet(wb: import('exceljs').Workbook, data: SalespersonReportData): void {
  const ws = wb.addWorksheet('รายละเอียด');
  ws.columns = DETAIL_WIDTHS.map((w) => ({ width: w }));

  const head = ws.addRow([...DETAIL_HEADERS]);
  head.font = { bold: true };
  for (let c = 1; c <= DETAIL_COLS; c++) {
    const cell = head.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }

  for (const sp of data.salespeople) {
    // Salesperson band (merged across all columns)
    const band = ws.addRow([
      `เซลส์: ${sp.salesName}  •  ดูแล ${sp.memberCount} • ซื้อ ${sp.buyingMemberCount}`,
    ]);
    ws.mergeCells(band.number, 1, band.number, DETAIL_COLS);
    band.font = { bold: true };
    band.alignment = { vertical: 'middle' };
    for (let c = 1; c <= DETAIL_COLS; c++) {
      band.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SALESBAND_ARGB } };
    }

    for (const m of sortedMembers(sp)) {
      const mRow = ws.addRow([m.name, m.phone ?? '', m.orderCount, m.totalItems, m.totalValue]);
      mRow.getCell(1).font = { bold: true };
      [3, 4].forEach((c) => { mRow.getCell(c).numFmt = INT_FMT; });
      mRow.getCell(5).numFmt = MONEY_FMT;

      for (const it of m.items) {
        const iRow = ws.addRow([`    ${it.productName}`, '', '', it.quantity, it.value]);
        iRow.getCell(1).alignment = { indent: 1 };
        iRow.getCell(4).numFmt = INT_FMT;
        iRow.getCell(5).numFmt = MONEY_FMT;
        for (let c = 1; c <= DETAIL_COLS; c++) {
          iRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ITEM_ARGB } };
        }
      }
    }

    // Per-salesperson subtotal
    const sub = ws.addRow(['', `รวมเซลส์ ${sp.salesName}`, '', sp.totalItems, sp.totalValue]);
    sub.font = { bold: true };
    for (let c = 1; c <= DETAIL_COLS; c++) {
      sub.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTOTAL_ARGB } };
    }
    sub.getCell(4).numFmt = INT_FMT;
    sub.getCell(5).numFmt = MONEY_FMT;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Build a multi-sheet .xlsx workbook from a loaded salesperson report and trigger
 * a browser download. Mirrors downloadSalesReportExcel(): ExcelJS + file-saver are
 * imported dynamically so they never weigh on the app's initial bundle.
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
    ['จำนวนชิ้นที่ขาย', data.totalItems, 'int'],
  ];
  if (data.mode === 'range') summary.push(['จำนวนวัน', data.dayCount, 'int']);
  for (const [label, value, kind] of summary) {
    const r = s.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).numFmt = kind === 'money' ? MONEY_FMT : INT_FMT;
  }

  // ── Breakdown sheets ─────────────────────────────────────────────────────────
  addSummaryTableSheet(wb, data);
  addDetailSheet(wb, data);

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
