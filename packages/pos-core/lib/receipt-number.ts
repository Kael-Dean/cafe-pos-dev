/** Client-side fallback for the receipt number ("เลขที่:"), used only when the
 *  backend didn't supply `receipt_no` (pre-backend orders). The backend now owns
 *  this string; prefer `order.receipt_no` and print it verbatim. Mirrors the
 *  backend format `IV{BuddhistYear}{MM}{DD}-{NNNN}` so old orders still match. */
export function makeInvoiceNo(orderNo: string, createdAt: Date = new Date()): string {
  const buddhistYear = createdAt.getFullYear() + 543;
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  const dd = String(createdAt.getDate()).padStart(2, '0');
  return `IV${buddhistYear}${mm}${dd}-${orderNo.padStart(4, '0')}`;
}
