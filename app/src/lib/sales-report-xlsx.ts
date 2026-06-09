import type { SalesReportData, ReportRow } from '@/hooks/use-sales-report';

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
