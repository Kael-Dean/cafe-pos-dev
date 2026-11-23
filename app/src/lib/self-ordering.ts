/**
 * Pure logic for the table-QR self-ordering bar screens (order board, tables overview,
 * checkout). Nothing in here touches React, the network or the clock (unless handed one),
 * so every rule is unit-tested in self-ordering.test.ts.
 *
 * Money is a decimal STRING everywhere — this module never does arithmetic on it.
 */

/** Store entitlement for table-QR ordering (`/me/features` returns ["self_ordering"]). */
export const FEATURE_SELF_ORDERING = 'self_ordering';

export type ApiOrderStatus = 'PENDING' | 'PAID' | 'IN_PROGRESS' | 'READY' | 'COMPLETED' | 'VOID';
export type GuestStatus = 'ACTIVE' | 'CHECKOUT_REQUESTED' | 'CHECKED_OUT';

// ── Order board ───────────────────────────────────────────────────────────────

/** Statuses that live on the bar's board. COMPLETED / VOID leave it. */
export const BOARD_STATUSES = ['PENDING', 'IN_PROGRESS', 'READY'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export type BoardColumn = 'new' | 'making' | 'ready';

const COLUMN_OF: Record<BoardStatus, BoardColumn> = {
  PENDING: 'new',
  IN_PROGRESS: 'making',
  READY: 'ready',
};

export function isBoardStatus(s: string): s is BoardStatus {
  return (BOARD_STATUSES as readonly string[]).includes(s);
}

/** API status → board column. null = the order is not on the board (served / void / paid at the counter). */
export function boardColumnOf(status: string): BoardColumn | null {
  return isBoardStatus(status) ? COLUMN_OF[status] : null;
}

export interface BoardAction {
  /** Status to PATCH to. */
  to: 'IN_PROGRESS' | 'READY' | 'COMPLETED';
  label: string;
}

/** The one forward button for a card (PENDING → รับออเดอร์, IN_PROGRESS → เสร็จแล้ว, READY → เสิร์ฟแล้ว). */
export function nextActionFor(status: string): BoardAction | null {
  switch (status) {
    case 'PENDING': return { to: 'IN_PROGRESS', label: 'รับออเดอร์' };
    case 'IN_PROGRESS': return { to: 'READY', label: 'เสร็จแล้ว' };
    case 'READY': return { to: 'COMPLETED', label: 'เสิร์ฟแล้ว' };
    default: return null;
  }
}

/** Reject is only offered while the bar has not accepted yet. */
export function canReject(status: string): boolean {
  return status === 'PENDING';
}

/** Minimal order shape the board logic needs (the hook maps the API row into this). */
export interface BoardOrderLike {
  id: string;
  status: string;
  sessionId: string | null;
  guestId: string | null;
  createdById: string | null;
  createdAt: number; // epoch ms
  orderNo: number;
}

/**
 * An order a customer sent from their phone: it has a guest, or it sits on a table tab
 * with no cashier behind it. Walk-up orders the owner rings himself must NOT alarm.
 */
export function isGuestOrder(o: Pick<BoardOrderLike, 'guestId' | 'sessionId' | 'createdById'>): boolean {
  if (o.guestId) return true;
  return !!o.sessionId && o.createdById == null;
}

/**
 * The first order of every session, computed client-side (the API has no field for it).
 * Pass EVERY recent order — including served ones — otherwise a table whose first drink
 * was already served would wrongly flag its second order as "NEW TABLE".
 * Returns sessionId → id of its earliest order.
 */
export function firstOrderIdBySession(orders: readonly BoardOrderLike[]): Map<string, string> {
  const best = new Map<string, BoardOrderLike>();
  for (const o of orders) {
    if (!o.sessionId) continue;
    const cur = best.get(o.sessionId);
    if (!cur || o.createdAt < cur.createdAt || (o.createdAt === cur.createdAt && o.orderNo < cur.orderNo)) {
      best.set(o.sessionId, o);
    }
  }
  return new Map([...best].map(([sid, o]) => [sid, o.id]));
}

export type DecoratedOrder<T extends BoardOrderLike> = T & {
  column: BoardColumn;
  isNewTable: boolean;
  fromGuest: boolean;
};

/** Board rows: only board statuses, oldest first (longest waiting at the top-left), NEW TABLE flagged. */
export function decorateBoard<T extends BoardOrderLike>(all: readonly T[]): DecoratedOrder<T>[] {
  const first = firstOrderIdBySession(all);
  return all
    .filter((o) => isBoardStatus(o.status))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.orderNo - b.orderNo)
    .map((o) => ({
      ...o,
      column: COLUMN_OF[o.status as BoardStatus],
      isNewTable: !!o.sessionId && first.get(o.sessionId) === o.id,
      fromGuest: isGuestOrder(o),
    }));
}

// ── Alert (chime) decision ────────────────────────────────────────────────────

export const CHIME_REPEAT_MS = 30_000;

export interface ChimeInput {
  /** Pending customer-order ids on the board right now. */
  pendingGuestIds: readonly string[];
  /** Ids already announced; null before the first poll lands. */
  announced: ReadonlySet<string> | null;
  now: number;
  lastChimeAt: number | null;
  repeatMs?: number;
}

export interface ChimeResult {
  chime: boolean;
  /** Why: a brand-new order, a reminder for one nobody has accepted, or nothing. */
  reason: 'new' | 'reminder' | null;
  announced: Set<string>;
}

/**
 * When to ring. A pending customer order we have not announced yet rings at once (also on
 * first load, so a tablet switched on with waiting orders is not silent). While any stay
 * unaccepted it rings again every `repeatMs` — one missed chime must not lose a customer.
 * Ids that left PENDING are dropped from `announced` so the set cannot grow forever.
 */
export function decideChime({ pendingGuestIds, announced, now, lastChimeAt, repeatMs = CHIME_REPEAT_MS }: ChimeInput): ChimeResult {
  const prev = announced ?? new Set<string>();
  const next = new Set(pendingGuestIds);
  const hasNew = pendingGuestIds.some((id) => !prev.has(id));
  if (hasNew) return { chime: true, reason: 'new', announced: next };
  if (pendingGuestIds.length > 0 && (lastChimeAt == null || now - lastChimeAt >= repeatMs)) {
    return { chime: true, reason: 'reminder', announced: next };
  }
  return { chime: false, reason: null, announced: next };
}

// ── Checkout sequence ─────────────────────────────────────────────────────────

export type PayMethod = 'CASH' | 'QR_PROMPTPAY';

/**
 * Per-guest payment, in the exact order the API demands:
 *   preview → checkout → [QR] → pay.
 * Paying a GUEST bill before their checkout is a 409, so `pay` is unreachable until
 * `checked_out` (or `qr_ready`).
 */
export type GuestPayStep = 'preview' | 'checked_out' | 'qr_ready' | 'paid';
export type GuestPayEvent = 'checkout' | 'qr' | 'pay';

export function guestPayTransition(step: GuestPayStep, event: GuestPayEvent, method: PayMethod): GuestPayStep {
  switch (event) {
    case 'checkout':
      if (step !== 'preview') throw new Error('คนนี้เช็คเอาท์แล้ว');
      return 'checked_out';
    case 'qr':
      if (method !== 'QR_PROMPTPAY') throw new Error('QR ใช้กับพร้อมเพย์เท่านั้น');
      if (step !== 'checked_out') throw new Error('ต้องเช็คเอาท์ก่อนขอ QR');
      return 'qr_ready';
    case 'pay':
      if (step === 'preview') throw new Error('ต้องเช็คเอาท์คนนี้ก่อนรับเงิน');
      if (step === 'paid') throw new Error('จ่ายแล้ว');
      if (method === 'QR_PROMPTPAY' && step !== 'qr_ready') throw new Error('ต้องแสดง QR ก่อนยืนยันรับเงิน');
      return 'paid';
  }
}

/** Where a guest's flow starts: someone already CHECKED_OUT skips step 1 (it would be a repeat). */
export function initialGuestStep(status: GuestStatus): GuestPayStep {
  return status === 'CHECKED_OUT' ? 'checked_out' : 'preview';
}

/** The next API call the UI should fire for a guest, or null when only the owner's tap (confirm) is left. */
export function nextGuestCall(step: GuestPayStep, method: PayMethod): 'checkout' | 'qr' | null {
  if (step === 'preview') return 'checkout';
  if (step === 'checked_out' && method === 'QR_PROMPTPAY') return 'qr';
  return null;
}

export interface GuestPayBody {
  scope: 'GUEST';
  guest_id: string;
  payment_method: PayMethod;
}
export interface TablePayBody {
  scope: 'TABLE';
  payment_method: PayMethod;
  /** Checks out anyone still seated so the rest of the table can be settled in one go. */
  force: true;
}

export function guestPayBody(guestId: string, method: PayMethod): GuestPayBody {
  return { scope: 'GUEST', guest_id: guestId, payment_method: method };
}

export function tablePayBody(method: PayMethod): TablePayBody {
  return { scope: 'TABLE', payment_method: method, force: true };
}

/** Preview URL: whole table, or one person via ?guest_id. */
export function billPath(sessionId: string, guestId?: string | null): string {
  const base = `/api/v1/table-sessions/${sessionId}/bill`;
  return guestId ? `${base}?guest_id=${encodeURIComponent(guestId)}` : base;
}

// ── Error copy ────────────────────────────────────────────────────────────────

export type ErrorContext = 'order-status' | 'reject' | 'checkout' | 'qr' | 'pay' | 'close' | 'reassign' | 'open-table' | 'reissue';

interface ErrLike { status?: number; message?: string }

const STATUS_COPY: Record<ErrorContext, Partial<Record<number, string>>> = {
  'order-status': {
    409: 'ออเดอร์นี้ถูกเปลี่ยนสถานะไปแล้ว — รีเฟรชบอร์ดแล้วลองใหม่',
    404: 'ไม่พบออเดอร์นี้ (อาจถูกยกเลิกไปแล้ว)',
    410: 'โต๊ะนี้ปิดไปแล้ว',
  },
  reject: {
    409: 'ปฏิเสธไม่ได้ — ออเดอร์นี้ถูกรับหรือเปลี่ยนสถานะไปแล้ว',
    404: 'ไม่พบออเดอร์นี้ (อาจถูกยกเลิกไปแล้ว)',
  },
  checkout: {
    409: 'เช็คเอาท์คนนี้ไม่ได้ในตอนนี้ — สถานะโต๊ะเปลี่ยนไป รีเฟรชแล้วลองใหม่',
    410: 'โต๊ะนี้ปิดไปแล้ว',
    404: 'ไม่พบคนนี้ในโต๊ะ (อาจออกไปแล้ว)',
  },
  qr: {
    409: 'ยังสร้าง QR ไม่ได้ — ต้องเช็คเอาท์คนนี้ก่อน',
    422: 'สร้าง QR ไม่ได้ — ยังไม่ได้ตั้งเลขพร้อมเพย์ของร้าน (แจ้งผู้ดูแลระบบ) รับเป็นเงินสดแทนได้',
    404: 'ไม่พบบิลนี้',
    410: 'โต๊ะนี้ปิดไปแล้ว',
  },
  pay: {
    409: 'รับเงินไม่ได้ — ต้องเช็คเอาท์คนนี้ก่อน หรือบิลนี้ถูกจ่ายไปแล้ว รีเฟรชแล้วลองใหม่',
    410: 'โต๊ะนี้ปิดไปแล้ว',
    404: 'ไม่พบบิลนี้ (อาจจ่ายไปแล้ว)',
  },
  close: {
    409: 'ปิดโต๊ะไม่ได้ — ยังมีบิลค้างจ่าย จ่ายให้ครบก่อน',
    410: 'โต๊ะนี้ปิดไปแล้ว',
    404: 'ไม่พบโต๊ะนี้',
  },
  reassign: {
    409: 'ย้ายออเดอร์ไม่ได้ — ออเดอร์นี้จ่ายไปแล้ว',
    404: 'ไม่พบออเดอร์หรือคนนี้',
    410: 'โต๊ะนี้ปิดไปแล้ว',
  },
  'open-table': {
    409: 'เปิดโต๊ะไม่ได้ — โต๊ะนี้มีคนนั่งอยู่แล้ว หรือร้านยังไม่มีแพ็กเกจเริ่มต้น "Bar tab" (ไปที่ ตั้งค่าโต๊ะ)',
    404: 'ไม่พบโต๊ะนี้',
  },
  reissue: {
    404: 'ไม่พบโต๊ะนี้',
  },
};

const GENERIC: Partial<Record<number, string>> = {
  401: 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่',
  403: 'ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะเจ้าของ/ผู้จัดการ)',
  404: 'ไม่พบข้อมูล',
  410: 'รายการนี้ปิดไปแล้ว',
  429: 'ทำเร็วเกินไป — รอสักครู่แล้วลองใหม่',
};

/** Plain-Thai message for an API failure. Falls back to the server text, then a network hint. */
export function describeError(err: unknown, ctx: ErrorContext): string {
  const e = (err ?? {}) as ErrLike;
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status !== undefined) {
    const specific = STATUS_COPY[ctx][status] ?? GENERIC[status];
    if (specific) return specific;
    if (status >= 500) return 'ระบบขัดข้องชั่วคราว — ลองอีกครั้ง';
    if (e.message) return e.message;
    return `ทำรายการไม่สำเร็จ (${status})`;
  }
  return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
}

// ── Product tags (Part C) ─────────────────────────────────────────────────────

export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 30;

export interface TagsResult {
  tags: string[];
  error: string | null;
}

/**
 * Same rules as the API: trimmed, blanks and case-insensitive duplicates dropped, at most
 * 10, each at most 30 characters. Input is the raw comma/newline separated text field.
 */
export function normalizeTags(raw: string | readonly string[]): TagsResult {
  const parts = typeof raw === 'string' ? raw.split(/[,\n]/) : [...raw];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  const tooLong = tags.find((t) => [...t].length > MAX_TAG_LEN);
  if (tooLong) return { tags, error: `แท็ก "${tooLong}" ยาวเกิน ${MAX_TAG_LEN} ตัวอักษร` };
  if (tags.length > MAX_TAGS) return { tags, error: `ใส่แท็กได้ไม่เกิน ${MAX_TAGS} อัน (ตอนนี้ ${tags.length})` };
  return { tags, error: null };
}

/** Two tag lists equal in order and spelling (to decide whether to send `tags` in a PATCH). */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

// ── Rate plan "Bar tab" ───────────────────────────────────────────────────────

/** The no-time-charge plan mr.bar needs: without a default plan a customer's join is a 409. */
export const BAR_TAB_PLAN = {
  name: 'Bar tab',
  billing_mode: 'PER_TABLE_HOUR',
  hourly_rate: '0',
  grace_minutes: 0,
  min_charge_minutes: 0,
  is_default: true,
} as const;

/** True when at least one ACTIVE plan is the default. */
export function hasDefaultPlan(plans: readonly { isDefault: boolean; isActive: boolean }[]): boolean {
  return plans.some((p) => p.isDefault && p.isActive);
}

/** Rate may be "0" (no time charge) or a positive decimal with ≤ 2 places. */
export function isRateValid(s: string, allowZero: boolean): boolean {
  const v = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return false;
  return allowZero || Number(v) > 0;
}

/** "0", "0.00", "", null → true. String check only; money is never parsed into a float. */
export function isZeroAmount(s: string | null | undefined): boolean {
  if (s == null) return true;
  return /^[-+]?0*(\.0*)?$/.test(s.trim());
}
