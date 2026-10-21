/**
 * Money from the API arrives as a decimal STRING ("240.00") on purpose: parsing it
 * into a float and formatting the result loses baht, and for the board-game time
 * charge any client-side arithmetic is forbidden outright — the backend is the only
 * thing allowed to compute a bill. These helpers reformat the digits the server
 * sent and never do math on them.
 */

/** "240.00" → "฿240" · "1234.50" → "฿1,234.50" · null → "฿0" */
export function bahtStr(value: string | null | undefined): string {
  if (value == null || value === '') return '฿0';
  const raw = String(value).trim();
  const neg = raw.startsWith('-');
  const [rawInt = '0', rawFrac = ''] = raw.replace(/^[-+]/, '').split('.');
  const int = (rawInt || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Keep decimals only when they carry value — "240.00" reads better as ฿240.
  // ...and when they do, show at least satang: "1234.50" -> ฿1,234.50, never ฿1,234.5.
  const frac = /[1-9]/.test(rawFrac) ? `.${rawFrac.replace(/0+$/, '').padEnd(2, '0')}` : '';
  return `${neg ? '-' : ''}฿${int}${frac}`;
}

// ── Exact decimal-string arithmetic (satang as BigInt) ───────────────────────
// For the few places the client must combine money it did not compute itself —
// e.g. the live "actual − system" variance on the cash-session close form, shown
// before the server stores its own. Never Number/parseFloat: "0.1 + 0.2" style
// drift would print a wrong satang on a reconciliation sheet.

const MONEY_RE = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * "4100.50" → 410050n satang. Accepts an optional sign, a missing integer part (".5")
 * and 0–2 decimals; thousands separators are ignored. Anything else (3+ decimals,
 * letters, empty) → null.
 */
export function moneyToSatang(value: string | null | undefined): bigint | null {
  if (value == null) return null;
  const raw = String(value).trim().replace(/,/g, '');
  const m = MONEY_RE.exec(raw);
  if (!m) return null;
  const [, sign, int = '', frac = ''] = m;
  if (!int && !frac) return null;
  if (frac.length > 2) return null;
  const satang = BigInt(int || '0') * BigInt(100) + BigInt((frac + '00').slice(0, 2));
  return sign === '-' ? -satang : satang;
}

/** 410050n → "4100.50" · -15000n → "-150.00" (always 2 decimals, no separators — the API shape). */
export function satangToMoney(satang: bigint): string {
  const zero = BigInt(0);
  const neg = satang < zero;
  const abs = neg ? -satang : satang;
  const hundred = BigInt(100);
  const int = (abs / hundred).toString();
  const frac = (abs % hundred).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** a − b as a 2-dp decimal string; null when either side is not a valid amount. */
export function subMoney(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = moneyToSatang(a);
  const y = moneyToSatang(b);
  return x == null || y == null ? null : satangToMoney(x - y);
}

/** Sum of decimal strings; invalid entries are skipped. */
export function sumMoney(values: readonly (string | null | undefined)[]): string {
  let total = BigInt(0);
  for (const v of values) {
    const s = moneyToSatang(v);
    if (s != null) total += s;
  }
  return satangToMoney(total);
}

/** -1 / 0 / 1 for a decimal string; null when invalid. */
export function moneySign(value: string | null | undefined): -1 | 0 | 1 | null {
  const s = moneyToSatang(value);
  if (s == null) return null;
  const zero = BigInt(0);
  return s < zero ? -1 : s > zero ? 1 : 0;
}

/** Signed display: "-150.00" → "-฿150" · "25.50" → "+฿25.50" · "0.00" → "฿0". */
export function signedBahtStr(value: string | null | undefined): string {
  const sign = moneySign(value);
  if (sign == null) return '—';
  if (sign > 0) return `+${bahtStr(value)}`;
  return bahtStr(value);
}

/** 125 → "2 ชม. 5 น." · 45 → "45 น." · 120 → "2 ชม." */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} น.`;
  if (!rest) return `${h} ชม.`;
  return `${h} ชม. ${rest} น.`;
}

/**
 * Minutes elapsed since an ISO timestamp, for the *clock* on a table card.
 * Display only — the billable figure always comes from the API, and the two are
 * expected to differ (grace, rounding, minimum charge).
 */
export function minutesSince(iso: string, now: number = Date.now()): number {
  const started = new Date(iso).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 60_000));
}

/** "18:02" in the browser's locale — for "เปิดโต๊ะ 18:02". */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}
