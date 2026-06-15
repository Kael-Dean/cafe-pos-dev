import { bahtText } from './baht-text';

// ── Neutral receipt layout (single source of truth) ─────────────────────────
// The receipt layout lives HERE, in the app — not in the bridge. The bridge is a
// "dumb" relay: it renders whatever line-list it receives (→ ESC/POS for a LAN
// printer, or → a 1-bit raster for a USB printer) but owns no layout itself.
// That means changing what the printed slip looks like is an app-only deploy
// (Vercel) — you never have to reinstall/redeploy the print bridge again.
//
// The op shape mirrors the bridge's raster renderer exactly (keys t/s/a/size/
// bold/l/r, size in px), so the USB path can feed this straight into its GDI
// renderer with no PowerShell changes. The LAN path interprets `size` by a
// threshold (≥32 px → double-height).
export type ReceiptLine =
  | { t: 'text'; s: string; a: 'left' | 'center'; size: number; bold?: boolean }
  | { t: 'lr'; l: string; r: string; size: number; bold?: boolean }
  | { t: 'hr' }
  | { t: 'sp' };

export interface ReceiptLinesInput {
  storeName: string;
  storeAddress?: string;
  storeTaxId?: string;
  storeBranch?: string;
  storePhone?: string;
  invoiceNo?: string;
  orderNumber: string;
  /** Pre-formatted th-TH date/time string (caller controls now vs. reprint time). */
  dateStr: string;
  /** Marks the slip as a duplicate ("สำเนา") instead of the original ("ต้นฉบับ"). */
  copy?: boolean;
  memberName?: string;
  salesName?: string;
  items: Array<{ name: string; qty: number; unitPrice: number; mods?: string[] }>;
  total: number;
  paymentLabel: string;
  cashGiven?: number;
}

const N = 26;    // body text, px (sized for a 58 mm / 384-dot head)
const BIG = 36;  // store-name heading
const fmt2 = (n: number) => n.toFixed(2);

export function buildReceiptLines(d: ReceiptLinesInput): ReceiptLine[] {
  const L: ReceiptLine[] = [];

  // Header
  L.push({ t: 'text', s: d.storeName, a: 'center', size: BIG, bold: true });
  L.push({ t: 'text', s: 'ใบเสร็จรับเงิน', a: 'center', size: N });
  L.push({ t: 'text', s: d.copy ? 'สำเนา' : 'ต้นฉบับ', a: 'center', size: N });
  L.push({ t: 'hr' });

  // Store info
  if (d.storeAddress) L.push({ t: 'text', s: d.storeAddress, a: 'left', size: N });
  if (d.storeTaxId)   L.push({ t: 'text', s: `ผู้เสียภาษี: ${d.storeTaxId}`, a: 'left', size: N });
  if (d.storeBranch)  L.push({ t: 'text', s: d.storeBranch, a: 'left', size: N });
  if (d.storePhone)   L.push({ t: 'text', s: `โทร. ${d.storePhone}`, a: 'left', size: N });
  L.push({ t: 'hr' });

  // Order meta
  if (d.invoiceNo) L.push({ t: 'text', s: `เลขที่: ${d.invoiceNo}`, a: 'left', size: N });
  L.push({ t: 'text', s: `ออเดอร์: #${d.orderNumber}`, a: 'left', size: N });
  L.push({ t: 'text', s: d.dateStr, a: 'left', size: N });
  if (d.memberName) L.push({ t: 'text', s: `ลูกค้า: ${d.memberName}`, a: 'left', size: N });
  if (d.salesName)  L.push({ t: 'text', s: `เซลล์: ${d.salesName}`, a: 'left', size: N });
  L.push({ t: 'hr' });

  // Items
  L.push({ t: 'lr', l: 'รายการ', r: 'จำนวนเงิน', size: N });
  L.push({ t: 'hr' });
  for (const it of d.items) {
    L.push({ t: 'lr', l: it.name, r: fmt2(it.qty * it.unitPrice), size: N });
    L.push({ t: 'text', s: `  ${it.qty} x ${fmt2(it.unitPrice)}`, a: 'left', size: N });
    for (const m of it.mods ?? []) L.push({ t: 'text', s: `  + ${m}`, a: 'left', size: N });
  }

  // Summary
  L.push({ t: 'hr' });
  L.push({ t: 'lr', l: 'รวมทั้งสิ้น (บาท)', r: fmt2(d.total), size: N, bold: true });
  L.push({ t: 'text', s: `(${bahtText(d.total)})`, a: 'left', size: N });
  L.push({ t: 'text', s: 'ราคารวมภาษีมูลค่าเพิ่ม 7% แล้ว (VAT included)', a: 'left', size: N });
  L.push({ t: 'text', s: `ชำระ: ${d.paymentLabel}`, a: 'left', size: N });
  if (d.cashGiven != null) {
    L.push({ t: 'lr', l: 'รับเงิน', r: fmt2(d.cashGiven), size: N });
    L.push({ t: 'lr', l: 'เงินทอน', r: fmt2(d.cashGiven - d.total), size: N });
  }

  // Footer
  L.push({ t: 'hr' });
  L.push({ t: 'sp' });
  L.push({ t: 'sp' });
  L.push({ t: 'text', s: 'ลงชื่อผู้รับเงิน ......................', a: 'center', size: N });
  L.push({ t: 'sp' });
  L.push({ t: 'text', s: 'ขอบคุณที่ใช้บริการ', a: 'center', size: N });
  return L;
}
