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
