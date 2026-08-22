/**
 * Canonical formatters. One place, so the drift the POS accumulated (money in
 * en-US here, th-TH there, 0 decimals here, 2 there) never starts.
 */

/**
 * Format a money value the API sent as a STRING — e.g. "2500.00" → "2,500.00".
 *
 * Never parseFloat this. The backend serialises Decimal as a string precisely
 * so baht don't get lost to binary floating point, and turning it back into a
 * Number here would throw that away. Group the digits textually instead.
 */
export function formatMoney(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const negative = value.trim().startsWith('-');
  const raw = negative ? value.trim().slice(1) : value.trim();
  const [intPart = '0', decPart] = raw.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decPart !== undefined ? `${grouped}.${decPart}` : grouped;
  return negative ? `-${body}` : body;
}

/** "2500.00" → "฿2,500.00". Same no-parseFloat rule as formatMoney. */
export function formatBaht(value: string | null | undefined): string {
  const n = formatMoney(value);
  return n === '—' ? n : `฿${n}`;
}

const DATE_TIME = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

const DATE_ONLY = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric', month: 'short', year: 'numeric',
});

/** ISO 8601 → "22 ส.ค. 2569 14:10" (Buddhist era via the Intl calendar extension). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_TIME.format(d);
}

/** ISO 8601 → "22 ส.ค. 2569". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_ONLY.format(d);
}

/**
 * Suggest a globally-unique store slug. Store slugs are unique across ALL
 * clients (cafe staff log in with slug + PIN, so the backend resolves the store
 * by slug alone) — prefixing with the tenant keeps collisions rare.
 */
export function suggestStoreSlug(tenantSlug: string, storeName: string): string {
  const tail = storeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!tenantSlug) return tail;
  if (!tail) return tenantSlug;
  return `${tenantSlug}-${tail}`.slice(0, 60).replace(/-+$/g, '');
}
