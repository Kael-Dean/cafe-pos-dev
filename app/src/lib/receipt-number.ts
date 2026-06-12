/** Receipt running number printed as "เลขที่:". Stable for a given order+date. */
export function makeInvoiceNo(orderNo: string, createdAt: Date = new Date()): string {
  const buddhistYear = createdAt.getFullYear() + 543;
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  const dd = String(createdAt.getDate()).padStart(2, '0');
  return `IV${buddhistYear}${mm}${dd}-${orderNo.padStart(4, '0')}`;
}
