import type { WastageReportData } from '@/hooks/use-wastage-report';
import type { Workbook } from 'exceljs';

const MONEY_FMT = '#,##0.00" บาท"';
const QTY_FMT = '#,##0.###';
const HEADER_ARGB = 'FFEFE7DD'; // soft latte tone for header rows
const ZEBRA_ARGB = 'FFF6F1EA';

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

// ── Register sheet (per-event waste log) ───────────────────────────────────────
const REGISTER_HEADERS = [
  'ลำดับ', 'วันที่', 'เวลา', 'วัตถุดิบ', 'จำนวน', 'หน่วย', 'เหตุผล', 'มูลค่า', 'ผู้บันทึก', 'หมายเหตุ',
] as const;
const REGISTER_WIDTHS = [6, 12, 8, 30, 12, 10, 18, 14, 18, 48];
const REGISTER_COLS = REGISTER_HEADERS.length;

function addRegisterSheet(wb: Workbook, data: WastageReportData): void {
  const ws = wb.addWorksheet('ของเสีย');
  ws.columns = REGISTER_WIDTHS.map((w) => ({ width: w }));

  const titleText =
    data.mode === 'daily'
      ? `รายการของเสีย — ${thaiDate(data.from)}`
      : `รายการของเสีย — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;
  ws.addRow([titleText]);
  ws.mergeCells(1, 1, 1, REGISTER_COLS);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

  const head = ws.addRow([...REGISTER_HEADERS]);
  head.font = { bold: true };
  for (let c = 1; c <= REGISTER_COLS; c++) {
    const cell = head.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  }

  let totalCost = 0;
  data.events.forEach((e, idx) => {
    const row = ws.addRow([
      e.no, e.date, e.time, e.itemName, e.quantity, e.unit, e.reasonLabel, e.cost, e.createdBy, e.note,
    ]);
    row.getCell(5).numFmt = QTY_FMT;
    row.getCell(8).numFmt = MONEY_FMT;
    if (idx % 2 === 1) {
      for (let c = 1; c <= REGISTER_COLS; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_ARGB } };
      }
    }
    totalCost += e.cost;
  });

  const totalRow = ws.addRow(['', '', '', 'รวม', '', '', '', totalCost, '', '']);
  totalRow.font = { bold: true };
  for (let c = 1; c <= REGISTER_COLS; c++) {
    totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } };
  }
  totalRow.getCell(8).numFmt = MONEY_FMT;

  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

/**
 * Build a multi-sheet .xlsx workbook from a loaded wastage report and trigger a
 * browser download. ExcelJS + file-saver are imported dynamically so they never
 * weigh on the app's initial bundle. Mirrors sales-report-xlsx.ts.
 */
export async function downloadWastageReportExcel(data: WastageReportData, storeName: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const { saveAs } = await import('file-saver');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kafé OS';
  wb.created = new Date();

  const periodLabel =
    data.mode === 'daily'
      ? `รายวัน — ${thaiDate(data.from)}`
      : `รายเดือน / ช่วงวันที่ — ${thaiDate(data.from)} ถึง ${thaiDate(data.to)}`;

  // ── Register sheet (primary) ─────────────────────────────────────────────────
  addRegisterSheet(wb, data);

  // ── Summary sheet ────────────────────────────────────────────────────────────
  const s = wb.addWorksheet('สรุป');
  s.columns = [{ width: 28 }, { width: 22 }];
  s.addRow([storeName]);
  s.getRow(1).font = { bold: true, size: 16 };
  s.addRow(['รายงานของเสีย']);
  s.getRow(2).font = { bold: true, size: 13 };
  s.addRow([periodLabel]);
  s.addRow([`ออกรายงานเมื่อ ${thaiDateTime(new Date())}`]);
  s.addRow([]);

  const summary: Array<[string, number, boolean]> = [
    ['มูลค่าของเสียรวม', data.totalCost, true],
    ['จำนวนของเสียรวม', data.totalQuantity, false],
    ['จำนวนครั้ง', data.eventCount, false],
  ];
  if (data.mode === 'range') {
    summary.push(['จำนวนวัน', data.dayCount, false]);
    summary.push(['มูลค่าเฉลี่ยต่อวัน', data.avgCostPerDay, true]);
  }
  for (const [label, value, money] of summary) {
    const r = s.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).numFmt = money ? MONEY_FMT : QTY_FMT;
  }

  // ── Breakdown sheets ─────────────────────────────────────────────────────────
  // by reason
  {
    const ws = wb.addWorksheet('แยกตามเหตุผล');
    ws.columns = [{ width: 24 }, { width: 12 }, { width: 14 }, { width: 18 }];
    const head = ws.addRow(['เหตุผล', 'จำนวนครั้ง', 'จำนวน', 'มูลค่า']);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } }; });
    let tc = 0; let tq = 0; let tco = 0;
    for (const r of data.byReason) {
      const row = ws.addRow([r.label, r.eventCount, r.quantity, r.cost]);
      row.getCell(3).numFmt = QTY_FMT; row.getCell(4).numFmt = MONEY_FMT;
      tc += r.eventCount; tq += r.quantity; tco += r.cost;
    }
    const tr = ws.addRow(['รวม', tc, tq, tco]);
    tr.font = { bold: true }; tr.getCell(3).numFmt = QTY_FMT; tr.getCell(4).numFmt = MONEY_FMT;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  // by item
  {
    const ws = wb.addWorksheet('แยกตามวัตถุดิบ');
    ws.columns = [{ width: 30 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 18 }];
    const head = ws.addRow(['วัตถุดิบ', 'จำนวนครั้ง', 'จำนวน', 'หน่วย', 'มูลค่า']);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } }; });
    let tc = 0; let tco = 0;
    for (const r of data.byItem) {
      const row = ws.addRow([r.itemName, r.eventCount, r.quantity, r.unit, r.cost]);
      row.getCell(3).numFmt = QTY_FMT; row.getCell(5).numFmt = MONEY_FMT;
      tc += r.eventCount; tco += r.cost;
    }
    const tr = ws.addRow(['รวม', tc, '', '', tco]);
    tr.font = { bold: true }; tr.getCell(5).numFmt = MONEY_FMT;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  // by day (range only)
  if (data.mode === 'range') {
    const ws = wb.addWorksheet('รายวัน');
    ws.columns = [{ width: 16 }, { width: 12 }, { width: 14 }, { width: 18 }];
    const head = ws.addRow(['วันที่', 'จำนวนครั้ง', 'จำนวน', 'มูลค่า']);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_ARGB } }; });
    let tc = 0; let tq = 0; let tco = 0;
    for (const r of data.byDay) {
      const row = ws.addRow([thaiDate(r.date), r.eventCount, r.quantity, r.cost]);
      row.getCell(3).numFmt = QTY_FMT; row.getCell(4).numFmt = MONEY_FMT;
      tc += r.eventCount; tq += r.quantity; tco += r.cost;
    }
    const tr = ws.addRow(['รวม', tc, tq, tco]);
    tr.font = { bold: true }; tr.getCell(3).numFmt = QTY_FMT; tr.getCell(4).numFmt = MONEY_FMT;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const filename =
    data.mode === 'daily'
      ? `รายงานของเสีย_${data.from}.xlsx`
      : `รายงานของเสีย_${data.from}_ถึง_${data.to}.xlsx`;
  saveAs(blob, filename);
}
