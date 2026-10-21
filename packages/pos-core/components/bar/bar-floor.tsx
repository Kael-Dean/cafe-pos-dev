'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Icon from '../icons';
import { Select, useToast } from '../app-common';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { ApiError } from '@pos/core/lib/api-client';
import { useCurrentUser, isAdmin } from '@pos/core/hooks/use-current-user';
import { useIsPhone } from '@pos/core/hooks/use-media-query';
import { useTableTab } from '@pos/core/hooks/use-table-tab';
import { useFloorLive, type LiveGuest, type LiveTable } from '@pos/core/hooks/use-floor-live';
import {
  useBillPromptPayQr, useCheckoutGuest, useCloseTab, usePayBill, useTableBill, type BillLine,
} from '@pos/core/hooks/use-table-bill';
import { useReassignOrder } from '@pos/core/hooks/use-guest-orders';
import {
  GUEST_PAY_IDLE, canPayGuest, guestPayReducer, hasAmountDue, settleTable, type BillPayMethod,
} from '@pos/core/lib/table-ordering/bill-flow';
import { bahtStr, clockTime } from '@pos/core/lib/money';
import { TableQrModal } from './table-qr';
import OpenSessionModal from '../screens/table-session-modal';
import type { FloorTable } from '@pos/core/hooks/use-floor';

/**
 * Bar floor for `self_ordering` stores (mr.bar): no time billing anywhere. Left,
 * every table from `/floor/live` (guests, unpaid, "request bill" highlighted);
 * right, the selected table — its tab per guest, the walk-up lines that can be
 * moved onto a guest, split pay per guest, then the rest of the table + close.
 * Payment happens in the side panel, not in stacked dialogs: the owner keeps the
 * table in view the whole time.
 */

type View =
  | { kind: 'table' }
  | { kind: 'guest-pay'; guest: LiveGuest }
  | { kind: 'table-pay' };

const ZONE_FALLBACK = 'ไม่ระบุโซน';

export default function BarFloor({ navigate }: { navigate: (s: string) => void }) {
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);
  const isPhone = useIsPhone();
  const liveQ = useFloorLive(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<FloorTable | null>(null);
  const [qrFor, setQrFor] = useState<LiveTable | null>(null);

  const tables = useMemo(() => liveQ.data ?? [], [liveQ.data]);
  const selected = tables.find((t) => t.id === selectedId) ?? null;

  const zones = useMemo(() => {
    const g = new Map<string, LiveTable[]>();
    for (const t of tables) {
      const k = t.zone?.trim() || ZONE_FALLBACK;
      const l = g.get(k);
      if (l) l.push(t); else g.set(k, [t]);
    }
    return [...g.entries()];
  }, [tables]);

  const occupied = tables.filter((t) => t.session).length;
  const requesting = tables.filter((t) => t.checkoutRequestedCount > 0).length;

  const showList = !isPhone || !selected;
  const showDetail = !isPhone || !!selected;

  return (
    <div className="bf-root">
      <style>{BF_CSS}</style>
      {showList && (
        <div className="bf-list scroll screen-pad">
          <div className="bf-head">
            <h1 className="page-title" style={{ margin: 0, fontSize: 'var(--fs-h2)', fontWeight: 700 }}>ผังโต๊ะ</h1>
            <div className="bf-chips">
              <span className="bf-chip">ว่าง <strong className="num">{Math.max(0, tables.length - occupied)}</strong></span>
              <span className="bf-chip">มีแขก <strong className="num">{occupied}</strong></span>
              {requesting > 0 && <span className="bf-chip" data-tone="warning">ขอเช็คบิล <strong className="num">{requesting}</strong></span>}
            </div>
            <button className="btn btn-ghost tap-std" style={{ marginLeft: 'auto' }} onClick={() => { void liveQ.refetch(); }}>
              <Icon name="refresh" size={18} /> รีเฟรช
            </button>
          </div>

          {liveQ.isError && (
            <div role="alert" className="bf-alert" data-tone="danger">
              โหลดผังโต๊ะไม่ได้ — {liveQ.error instanceof Error ? liveQ.error.message : 'ลองใหม่อีกครั้ง'} (ระบบจะลองใหม่ทุก 15 วินาที)
            </div>
          )}

          {liveQ.isLoading && (
            <div className="bf-grid" aria-busy="true">
              <span className="sr-only">กำลังโหลดผังโต๊ะ…</span>
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={132} radius="var(--radius-lg)" />)}
            </div>
          )}

          {!liveQ.isLoading && !liveQ.isError && tables.length === 0 && (
            <div className="bf-empty">
              <strong>ยังไม่มีโต๊ะในร้าน</strong>
              <span>{admin ? 'สร้างโต๊ะที่หน้า “ตั้งค่าโต๊ะ” แล้วพิมพ์ QR ไปแปะที่โต๊ะ' : 'ให้เจ้าของร้านสร้างโต๊ะที่หน้า “ตั้งค่าโต๊ะ” ก่อน'}</span>
              {admin && <button className="btn btn-primary tap-lg" onClick={() => navigate('table-setup')}>ไปตั้งค่าโต๊ะ</button>}
            </div>
          )}

          {zones.map(([zone, list]) => (
            <section key={zone} style={{ marginBottom: 'var(--space-6)' }}>
              {zones.length > 1 && <h2 className="bf-zone">{zone}</h2>}
              <div className="bf-grid">
                {list.map((t) => (
                  <TableTile key={t.id} table={t} selected={t.id === selectedId} onClick={() => setSelectedId(t.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {showDetail && (
        <aside className="bf-panel" aria-label={selected ? `โต๊ะ ${selected.name}` : 'รายละเอียดโต๊ะ'}>
          {isPhone && selected && (
            <button className="btn btn-ghost tap-std bf-back" onClick={() => setSelectedId(null)}>
              <Icon name="chevronLeft" size={18} /> ผังโต๊ะ
            </button>
          )}
          {!selected && (
            <div className="bf-empty" style={{ marginTop: 'var(--space-12)' }}>
              <Icon name="park" size={28} />
              <strong>แตะโต๊ะเพื่อดูบิล</strong>
              <span>เห็นแขกแต่ละคน ยอดค้าง เก็บเงินรายคน หรือเก็บที่เหลือทั้งโต๊ะแล้วปิดโต๊ะ</span>
            </div>
          )}
          {selected && !selected.session && (
            <FreeTable
              table={selected}
              admin={admin}
              onOpen={() => setOpenFor({ id: selected.id, name: selected.name, zone: selected.zone, capacity: selected.capacity, isActive: true })}
              onQr={() => setQrFor(selected)}
            />
          )}
          {selected?.session && (
            <TabPanel
              key={selected.session.id}
              table={selected}
              admin={admin}
              onQr={() => setQrFor(selected)}
              navigate={navigate}
            />
          )}
        </aside>
      )}

      {openFor && <OpenSessionModal table={openFor} onClose={() => { setOpenFor(null); void liveQ.refetch(); }} />}
      {qrFor && <TableQrModal table={qrFor} canReissue={admin} onClose={() => setQrFor(null)} />}
    </div>
  );
}

// ── Tile ─────────────────────────────────────────────────────────────────────
function TableTile({ table, selected, onClick }: { table: LiveTable; selected: boolean; onClick: () => void }) {
  const busy = !!table.session;
  const seated = table.guests.filter((g) => g.status !== 'CHECKED_OUT');
  const requesting = table.checkoutRequestedCount > 0;
  const state = requesting ? 'request' : busy ? 'busy' : 'free';
  const label = requesting
    ? `โต๊ะ ${table.name} ขอเช็คบิล ${table.checkoutRequestedCount} คน ยอดค้าง ${bahtStr(table.unpaidTotal)}`
    : busy ? `โต๊ะ ${table.name} มีแขก ${seated.length} คน ยอดค้าง ${bahtStr(table.unpaidTotal)}` : `โต๊ะ ${table.name} ว่าง`;

  return (
    <button className="bf-tile tap" data-state={state} aria-pressed={selected} aria-label={label} onClick={onClick}>
      <span className="bf-tile-head">
        <span className="bf-tile-name">{table.name}</span>
        <span className="bf-pill" data-state={state}>
          {requesting ? `ขอเช็คบิล ${table.checkoutRequestedCount}` : busy ? `${seated.length} แขก` : 'ว่าง'}
        </span>
      </span>
      {busy ? (
        <>
          <span className="bf-tile-amount num">{bahtStr(table.unpaidTotal)}</span>
          <span className="bf-tile-guests">
            {seated.slice(0, 3).map((g) => g.label).join(' · ')}
            {seated.length > 3 && ` +${seated.length - 3}`}
            {seated.length === 0 && 'ยังไม่มีแขกสแกน'}
          </span>
        </>
      ) : (
        <span className="bf-tile-hint">รอลูกค้าสแกน QR</span>
      )}
    </button>
  );
}

// ── Free table ───────────────────────────────────────────────────────────────
function FreeTable({ table, admin, onOpen, onQr }: { table: LiveTable; admin: boolean; onOpen: () => void; onQr: () => void }) {
  return (
    <div className="bf-panel-body">
      <h2 className="bf-panel-title">โต๊ะ {table.name}</h2>
      <p className="bf-muted">โต๊ะว่าง — ลูกค้าคนแรกที่สแกน QR จะเปิดบิลโต๊ะนี้เอง ไม่ต้องกดอะไร</p>
      <div className="bf-stack">
        <button className="btn btn-ghost btn-lg tap-lg" onClick={onOpen}>
          <Icon name="plus" size={18} /> เปิดโต๊ะให้ลูกค้าที่ไม่ได้สแกน
        </button>
        {admin && (
          <button className="btn btn-ghost btn-lg tap-lg" onClick={onQr}>
            <Icon name="qr" size={18} /> ดู QR โต๊ะนี้
          </button>
        )}
      </div>
    </div>
  );
}

// ── Open tab ─────────────────────────────────────────────────────────────────
function TabPanel({ table, admin, onQr, navigate }: {
  table: LiveTable;
  admin: boolean;
  onQr: () => void;
  navigate: (s: string) => void;
}) {
  const session = table.session!;
  const tableTab = useTableTab();
  const billQ = useTableBill(session.id);
  const [view, setView] = useState<View>({ kind: 'table' });

  const guests = table.guests;
  const linesByGuest = useMemo(() => {
    const m = new Map<string | null, BillLine[]>();
    for (const l of billQ.data?.lines ?? []) {
      const k = l.guestId;
      const list = m.get(k);
      if (list) list.push(l); else m.set(k, [l]);
    }
    return m;
  }, [billQ.data]);
  const walkUp = linesByGuest.get(null) ?? [];
  const remaining = billQ.data?.amount ?? table.unpaidTotal;
  const timeTotal = billQ.data?.timeTotal;

  if (view.kind === 'guest-pay') {
    return <GuestPay sessionId={session.id} table={table} guest={view.guest} onDone={() => setView({ kind: 'table' })} />;
  }
  if (view.kind === 'table-pay') {
    return <TablePay sessionId={session.id} table={table} remaining={remaining} onBack={() => setView({ kind: 'table' })} />;
  }

  return (
    <div className="bf-panel-body">
      <div className="bf-panel-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="bf-panel-title">โต๊ะ {table.name}</h2>
          <div className="bf-muted num">
            {session.openedAt ? `เปิด ${clockTime(session.openedAt)}` : 'เปิดอยู่'}
            {session.closedAt && ' · กำลังปิดโต๊ะ (สแกนใหม่ไม่ได้)'}
          </div>
        </div>
        <div className="bf-total">
          <span className="bf-muted">ยอดค้างทั้งโต๊ะ</span>
          <span className="bf-total-amount num">{billQ.isLoading ? '—' : bahtStr(remaining)}</span>
        </div>
      </div>

      <div className="bf-toolbar">
        <button
          className="btn btn-ghost tap-lg"
          onClick={() => { tableTab.start({ sessionId: session.id, tableName: table.name }); navigate('pos'); }}
        >
          <Icon name="cart" size={18} /> สั่งเพิ่มให้โต๊ะนี้
        </button>
        {admin && <button className="btn btn-ghost tap-lg" onClick={onQr}><Icon name="qr" size={18} /> QR</button>}
      </div>

      {billQ.isError && <div role="alert" className="bf-alert" data-tone="danger">โหลดบิลไม่ได้ — {billQ.error instanceof Error ? billQ.error.message : ''}</div>}

      <h3 className="bf-section">แขก ({guests.length})</h3>
      {guests.length === 0 && <p className="bf-muted">ยังไม่มีใครสแกน QR ที่โต๊ะนี้ — รายการทั้งหมดอยู่ในบิลโต๊ะ</p>}
      <ul className="bf-guests">
        {guests.map((g) => {
          const lines = linesByGuest.get(g.id) ?? [];
          const due = hasAmountDue(g.unpaidTotal);
          return (
            <li key={g.id} className="bf-guest" data-state={g.status}>
              <div className="bf-guest-row">
                <span className="bf-guest-name">{g.label}</span>
                {g.status === 'CHECKOUT_REQUESTED' && <span className="bf-pill" data-state="request">ขอเช็คบิล</span>}
                {g.status === 'CHECKED_OUT' && <span className="bf-pill" data-state="done">{due ? 'เช็คบิลแล้ว รอจ่าย' : 'จ่ายแล้ว'}</span>}
                <span className="bf-guest-amount num">{bahtStr(g.unpaidTotal)}</span>
              </div>
              {lines.length > 0 && <LineList lines={lines} />}
              {due && (
                <button className={`btn tap-lg bf-guest-pay ${g.status === 'CHECKOUT_REQUESTED' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView({ kind: 'guest-pay', guest: g })}>
                  <Icon name="cash" size={18} /> เก็บเงิน {g.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {walkUp.length > 0 && (
        <>
          <h3 className="bf-section">รายการจากร้าน (ยังไม่ระบุคน)</h3>
          <p className="bf-muted" style={{ marginTop: 0 }}>คิดรวมในบิลโต๊ะ — ย้ายไปบิลของแขกคนไหนก็ได้</p>
          <WalkUpLines sessionId={session.id} lines={walkUp} guests={guests.filter((g) => g.status !== 'CHECKED_OUT')} />
        </>
      )}

      {timeTotal && hasAmountDue(timeTotal) && (
        <div className="bf-line-total"><span>ค่าเวลา</span><span className="num">{bahtStr(timeTotal)}</span></div>
      )}

      <div className="bf-foot">
        <button className="btn btn-primary btn-xl" style={{ width: '100%' }} onClick={() => setView({ kind: 'table-pay' })} disabled={billQ.isLoading}>
          <Icon name="check" size={20} />
          {hasAmountDue(remaining) ? `เก็บเงินที่เหลือทั้งโต๊ะ ${bahtStr(remaining)}` : 'ปิดโต๊ะ'}
        </button>
      </div>
    </div>
  );
}

function LineList({ lines }: { lines: BillLine[] }) {
  return (
    <ul className="bf-lines">
      {lines.map((l) => (
        <li key={l.key}>
          <span className="num bf-line-qty">{l.quantity}×</span>
          <span className="bf-line-name">{l.name}{l.mods.length > 0 && <span className="bf-muted"> · {l.mods.join(', ')}</span>}</span>
          <span className="num">{bahtStr(l.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Walk-up lines grouped per order, each with a "move to guest" picker. */
function WalkUpLines({ sessionId, lines, guests }: { sessionId: string; lines: BillLine[]; guests: LiveGuest[] }) {
  const toast = useToast();
  const reassign = useReassignOrder();
  const [target, setTarget] = useState<Record<string, string>>({});
  const orders = useMemo(() => {
    const m = new Map<string, BillLine[]>();
    for (const l of lines) {
      const k = l.orderId ?? l.key;
      const list = m.get(k);
      if (list) list.push(l); else m.set(k, [l]);
    }
    return [...m.entries()];
  }, [lines]);

  const move = async (orderId: string) => {
    const guestId = target[orderId];
    if (!guestId) return;
    try {
      await reassign.mutateAsync({ sessionId, orderId, guestId });
      const g = guests.find((x) => x.id === guestId);
      toast({ kind: 'success', title: `ย้ายไปบิลของ ${g?.label ?? 'แขก'} แล้ว` });
    } catch (e) {
      toast({ kind: 'danger', title: 'ย้ายรายการไม่สำเร็จ', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <ul className="bf-guests">
      {orders.map(([orderId, ls]) => {
        const realOrder = !!ls[0].orderId;
        return (
          <li key={orderId} className="bf-guest">
            <LineList lines={ls} />
            {realOrder && guests.length > 0 && (
              <div className="bf-move">
                <Select
                  value={target[orderId] ?? ''}
                  onChange={(v) => setTarget((p) => ({ ...p, [orderId]: v }))}
                  ariaLabel="ย้ายไปบิลของ"
                  placeholder="ย้ายไปบิลของ…"
                  style={{ flex: 1, minWidth: 0 }}
                  triggerStyle={{ minHeight: 'var(--tap-std)', fontSize: 'var(--fs-body)' }}
                  options={guests.map((g) => ({ value: g.id, label: g.label }))}
                />
                <button className="btn btn-ghost tap-std" disabled={!target[orderId] || reassign.isPending} onClick={() => { void move(orderId); }}>ย้าย</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Pay one guest: checkout → (QR) → pay ─────────────────────────────────────
function GuestPay({ sessionId, table, guest, onDone }: { sessionId: string; table: LiveTable; guest: LiveGuest; onDone: () => void }) {
  const toast = useToast();
  const checkout = useCheckoutGuest();
  const pay = usePayBill();
  const [state, dispatch] = useReducer(guestPayReducer, GUEST_PAY_IDLE);
  const [lines, setLines] = useState<BillLine[]>([]);
  const started = useRef(false);

  const runCheckout = async () => {
    dispatch({ type: 'checkout' });
    try {
      const bill = await checkout.mutateAsync({ sessionId, guestId: guest.id });
      setLines(bill.lines);
      dispatch({ type: 'checkout-ok', amount: bill.amount });
    } catch (e) {
      dispatch({ type: 'checkout-failed', message: e instanceof Error ? e.message : 'เช็คบิลไม่สำเร็จ' });
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runCheckout();
    // runCheckout is recreated per render; this runs once on mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showQr = (state.kind === 'ready' || state.kind === 'paying') && state.showQr;
  const qrQ = useBillPromptPayQr(sessionId, guest.id, showQr);

  const doPay = async (method: BillPayMethod) => {
    if (!canPayGuest(state)) return;
    dispatch({ type: 'pay', method });
    try {
      const bill = await pay.mutateAsync({ sessionId, payload: { scope: 'GUEST', guest_id: guest.id, payment_method: method } });
      dispatch({ type: 'pay-ok', amount: bill.amount ?? undefined });
      toast({ kind: 'success', title: `รับเงิน ${guest.label} แล้ว` });
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 409 ? 'แขกคนนี้ยังไม่ได้เช็คบิล หรือจ่ายไปแล้ว — ลองเช็คบิลใหม่' : e instanceof Error ? e.message : 'รับเงินไม่สำเร็จ';
      dispatch({ type: 'pay-failed', message: msg });
    }
  };

  const amount = 'amount' in state ? state.amount : null;

  return (
    <div className="bf-panel-body">
      <button className="btn btn-ghost tap-std bf-back" onClick={onDone} disabled={state.kind === 'paying'}>
        <Icon name="chevronLeft" size={18} /> โต๊ะ {table.name}
      </button>
      <h2 className="bf-panel-title">เก็บเงิน {guest.label}</h2>

      {state.kind === 'checking-out' && (
        <div className="bf-muted" aria-busy="true" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> กำลังเช็คบิลของ {guest.label}…
        </div>
      )}

      {amount && state.kind !== 'paid' && (
        <>
          <div className="bf-due">
            <span className="bf-muted">ยอดที่ต้องจ่าย</span>
            <span className="bf-due-amount num">{bahtStr(amount)}</span>
          </div>
          {lines.length > 0 && <LineList lines={lines} />}
        </>
      )}

      {state.kind === 'failed' && (
        <div role="alert" className="bf-alert" data-tone="danger">
          {state.message}
          <button className="btn btn-ghost tap-std" style={{ marginTop: 8, display: 'flex' }} onClick={() => {
            const wasCheckedOut = state.amount !== null;
            dispatch({ type: 'retry' });
            if (!wasCheckedOut) void runCheckout();
          }}>ลองอีกครั้ง</button>
        </div>
      )}

      {(state.kind === 'ready' || state.kind === 'paying') && (
        <>
          {showQr ? (
            <div className="bf-qr">
              {qrQ.isLoading && <Skeleton height={240} width={240} radius="var(--radius-lg)" />}
              {qrQ.isError && (
                <div role="alert" className="bf-alert" data-tone="danger">
                  สร้าง QR พร้อมเพย์ไม่ได้ — {qrQ.error instanceof ApiError && qrQ.error.status === 409 ? 'ร้านยังไม่ได้ตั้งเลขพร้อมเพย์ (ให้ FRD ตั้งค่า)' : qrQ.error instanceof Error ? qrQ.error.message : ''}. รับเงินสดแทนได้
                </div>
              )}
              {qrQ.data?.pngBase64 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:image/png;base64,${qrQ.data.pngBase64}`} alt={`QR พร้อมเพย์ ${bahtStr(amount)}`} width={240} height={240} style={{ imageRendering: 'pixelated', background: '#fff', borderRadius: 12 }} />
              )}
              <p className="bf-muted" style={{ textAlign: 'center' }}>ให้ลูกค้าสแกนจ่าย แล้วกด “ได้รับเงินแล้ว” เมื่อเห็นยอดเข้า</p>
              <button className="btn btn-primary btn-xl" style={{ width: '100%' }} disabled={state.kind === 'paying' || !qrQ.data} onClick={() => { void doPay('QR_PROMPTPAY'); }}>
                {state.kind === 'paying' ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : <><Icon name="check" size={20} /> ได้รับเงินแล้ว (พร้อมเพย์)</>}
              </button>
              <button className="btn btn-ghost tap-lg" style={{ width: '100%' }} disabled={state.kind === 'paying'} onClick={() => dispatch({ type: 'hide-qr' })}>เปลี่ยนวิธีจ่าย</button>
            </div>
          ) : (
            <div className="bf-methods">
              <button className="btn btn-ghost btn-xl bf-method" disabled={state.kind === 'paying'} onClick={() => dispatch({ type: 'show-qr' })}>
                <Icon name="qr" size={22} /> QR พร้อมเพย์
              </button>
              <button className="btn btn-primary btn-xl bf-method" disabled={state.kind === 'paying'} onClick={() => { void doPay('CASH'); }}>
                {state.kind === 'paying' ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : <><Icon name="cash" size={22} /> รับเงินสด {bahtStr(amount)}</>}
              </button>
            </div>
          )}
        </>
      )}

      {state.kind === 'paid' && (
        <div role="status" className="bf-success">
          <Icon name="success" size={22} />
          <div>
            <strong>รับเงิน {guest.label} แล้ว {bahtStr(state.amount)}</strong>
            <div className="bf-muted">{state.method === 'CASH' ? 'เงินสด' : 'พร้อมเพย์'}</div>
          </div>
          <button className="btn btn-primary tap-lg" style={{ marginLeft: 'auto' }} onClick={onDone}>กลับไปที่โต๊ะ</button>
        </div>
      )}
    </div>
  );
}

// ── Rest of the table + close ────────────────────────────────────────────────
function TablePay({ sessionId, table, remaining, onBack }: { sessionId: string; table: LiveTable; remaining: string; onBack: () => void }) {
  const toast = useToast();
  const pay = usePayBill();
  const close = useCloseTab();
  const [method, setMethod] = useState<BillPayMethod | null>(null);
  const [phase, setPhase] = useState<'choose' | 'working' | 'unsettled' | 'closed' | 'error'>('choose');
  const [error, setError] = useState<string | null>(null);
  const due = hasAmountDue(remaining);
  const qrQ = useBillPromptPayQr(sessionId, null, method === 'QR_PROMPTPAY' && phase === 'choose');
  const seated = table.guests.filter((g) => g.status !== 'CHECKED_OUT').length;

  const run = async (m: BillPayMethod) => {
    setPhase('working');
    setError(null);
    const r = await settleTable({
      payTable: (pm) => pay.mutateAsync({ sessionId, payload: { scope: 'TABLE', payment_method: pm, force: true } }),
      close: () => close.mutateAsync(sessionId),
    }, remaining, m);
    if (!r.ok) {
      setPhase('error');
      setError(`${r.stage === 'pay' ? 'รับเงินไม่สำเร็จ' : 'รับเงินแล้วแต่ปิดโต๊ะไม่สำเร็จ'} — ${r.error instanceof Error ? r.error.message : ''}`);
      return;
    }
    if (r.settled) { setPhase('closed'); toast({ kind: 'success', title: `ปิดโต๊ะ ${table.name} แล้ว`, msg: 'สแกนครั้งถัดไปจะเปิดบิลใหม่' }); }
    else setPhase('unsettled');
  };

  const retryClose = async () => {
    setPhase('working');
    try {
      const r = await close.mutateAsync(sessionId);
      setPhase(r.settled ? 'closed' : 'unsettled');
    } catch (e) { setPhase('error'); setError(e instanceof Error ? e.message : 'ปิดโต๊ะไม่สำเร็จ'); }
  };

  return (
    <div className="bf-panel-body">
      <button className="btn btn-ghost tap-std bf-back" onClick={onBack} disabled={phase === 'working'}>
        <Icon name="chevronLeft" size={18} /> โต๊ะ {table.name}
      </button>
      <h2 className="bf-panel-title">{due ? 'เก็บเงินที่เหลือแล้วปิดโต๊ะ' : 'ปิดโต๊ะ'}</h2>

      {phase !== 'closed' && (
        <div className="bf-due">
          <span className="bf-muted">ยอดที่เหลือทั้งโต๊ะ</span>
          <span className="bf-due-amount num">{bahtStr(remaining)}</span>
        </div>
      )}
      {due && seated > 0 && phase === 'choose' && (
        <p className="bf-muted">แขกที่ยังนั่งอยู่ {seated} คนจะถูกเช็คบิลรวมในยอดนี้ (บิลโต๊ะ)</p>
      )}

      {phase === 'choose' && due && method !== 'QR_PROMPTPAY' && (
        <div className="bf-methods">
          <button className="btn btn-ghost btn-xl bf-method" onClick={() => setMethod('QR_PROMPTPAY')}><Icon name="qr" size={22} /> QR พร้อมเพย์</button>
          <button className="btn btn-primary btn-xl bf-method" onClick={() => { void run('CASH'); }}><Icon name="cash" size={22} /> รับเงินสดแล้วปิดโต๊ะ</button>
        </div>
      )}
      {phase === 'choose' && due && method === 'QR_PROMPTPAY' && (
        <div className="bf-qr">
          {qrQ.isLoading && <Skeleton height={240} width={240} radius="var(--radius-lg)" />}
          {qrQ.isError && <div role="alert" className="bf-alert" data-tone="danger">สร้าง QR ทั้งโต๊ะไม่ได้ — รับเงินสด หรือเก็บรายคนแทน</div>}
          {qrQ.data?.pngBase64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${qrQ.data.pngBase64}`} alt={`QR พร้อมเพย์ ${bahtStr(remaining)}`} width={240} height={240} style={{ imageRendering: 'pixelated', background: '#fff', borderRadius: 12 }} />
          )}
          <button className="btn btn-primary btn-xl" style={{ width: '100%' }} disabled={!qrQ.data} onClick={() => { void run('QR_PROMPTPAY'); }}>
            <Icon name="check" size={20} /> ได้รับเงินแล้ว ปิดโต๊ะ
          </button>
          <button className="btn btn-ghost tap-lg" style={{ width: '100%' }} onClick={() => setMethod(null)}>เปลี่ยนวิธีจ่าย</button>
        </div>
      )}
      {phase === 'choose' && !due && (
        <button className="btn btn-primary btn-xl" style={{ width: '100%' }} onClick={() => { void run('CASH'); }}>
          <Icon name="check" size={20} /> ปิดโต๊ะ {table.name}
        </button>
      )}

      {phase === 'working' && (
        <div className="bf-muted" aria-busy="true" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> กำลังบันทึก…
        </div>
      )}
      {phase === 'unsettled' && (
        <div role="alert" className="bf-alert" data-tone="warning">
          ยังปิดโต๊ะไม่ได้ — ระบบยังเห็นยอดค้างอยู่
          <button className="btn btn-ghost tap-std" style={{ marginTop: 8, display: 'flex' }} onClick={() => { void retryClose(); }}>เช็คอีกครั้ง</button>
        </div>
      )}
      {phase === 'error' && (
        <div role="alert" className="bf-alert" data-tone="danger">
          {error}
          <button className="btn btn-ghost tap-std" style={{ marginTop: 8, display: 'flex' }} onClick={() => setPhase('choose')}>ลองอีกครั้ง</button>
        </div>
      )}
      {phase === 'closed' && (
        <div role="status" className="bf-success">
          <Icon name="success" size={22} />
          <div><strong>ปิดโต๊ะ {table.name} เรียบร้อย</strong><div className="bf-muted">มือถือที่โต๊ะนี้จะขึ้นว่า “จบการใช้งานแล้ว”</div></div>
          <button className="btn btn-primary tap-lg" style={{ marginLeft: 'auto' }} onClick={onBack}>เสร็จ</button>
        </div>
      )}
    </div>
  );
}

const BF_CSS = `
.bf-root { height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 440px; background: var(--color-bg); }
.bf-list { overflow-y: auto; padding: 20px 24px; min-width: 0; }
.bf-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.bf-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.bf-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: var(--color-surface); border: var(--hairline); font-size: var(--fs-sm); color: var(--color-text-secondary); }
.bf-chip strong { color: var(--color-text); }
.bf-chip[data-tone='warning'] { background: var(--color-warning-50); color: var(--color-warning-fg); border-color: transparent; font-weight: 600; }
.bf-chip[data-tone='warning'] strong { color: inherit; }
.bf-zone { font-size: var(--fs-body); font-weight: 700; color: var(--color-text-secondary); margin: 0 0 12px; }
.bf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 12px; }
.bf-tile { text-align: left; width: 100%; min-height: 132px; display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: var(--radius-lg); background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text); cursor: pointer; font: inherit; }
.bf-tile[data-state='busy'] { background: var(--color-primary-50); border-color: var(--color-primary); }
.bf-tile[data-state='request'] { background: var(--color-warning-50); border: 2px solid var(--color-warning); padding: 13px; }
.bf-tile[aria-pressed='true'] { box-shadow: 0 0 0 3px var(--color-focus-ring); }
.bf-tile-head { display: flex; align-items: center; gap: 8px; }
.bf-tile-name { font-size: 22px; font-weight: 800; line-height: 1.15; min-width: 0; overflow-wrap: anywhere; }
.bf-pill { margin-left: auto; flex-shrink: 0; font-size: var(--fs-cap); font-weight: 700; padding: 2px 10px; min-height: 24px; display: inline-flex; align-items: center; border-radius: 999px; background: var(--color-success-50); color: color-mix(in srgb, var(--color-success) 68%, var(--color-text)); }
.bf-pill[data-state='busy'] { background: var(--color-primary); color: var(--color-text-inverse); }
.bf-pill[data-state='request'] { background: var(--color-warning); color: #2b1a03; }
.bf-pill[data-state='done'] { background: var(--color-surface-2); color: var(--color-text-secondary); }
.bf-tile-amount { margin-top: auto; font-size: var(--fs-h1); font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.bf-tile-guests, .bf-tile-hint { font-size: var(--fs-sm); color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bf-tile-hint { margin-top: auto; }

.bf-panel { border-left: 1px solid var(--color-border); background: var(--color-surface); overflow-y: auto; min-height: 0; }
.bf-panel-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.bf-panel-head { display: flex; align-items: flex-start; gap: 12px; }
.bf-panel-title { margin: 0; font-size: var(--fs-h2); font-weight: 800; line-height: 1.2; }
.bf-total { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
.bf-total-amount { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.15; }
.bf-muted { font-size: var(--fs-sm); color: var(--color-text-secondary); line-height: 1.5; margin: 0; }
.bf-toolbar { display: flex; gap: var(--tap-gap); flex-wrap: wrap; }
.bf-toolbar .btn:first-child { flex: 1; }
.bf-stack { display: flex; flex-direction: column; gap: var(--tap-gap); }
.bf-section { margin: 8px 0 0; font-size: var(--fs-body); font-weight: 700; }
.bf-guests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.bf-guest { padding: 12px; border-radius: var(--radius-md); background: var(--color-surface-2); display: flex; flex-direction: column; gap: 8px; }
.bf-guest[data-state='CHECKOUT_REQUESTED'] { background: var(--color-warning-50); box-shadow: inset 0 0 0 2px var(--color-warning); }
.bf-guest-row { display: flex; align-items: center; gap: 8px; }
.bf-guest-name { font-size: var(--fs-lg); font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
.bf-guest-row .bf-pill { margin-left: 0; }
.bf-guest-amount { margin-left: auto; font-size: var(--fs-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.bf-guest-pay { width: 100%; }
.bf-lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-sm); }
.bf-lines li { display: flex; gap: 8px; align-items: baseline; }
.bf-line-qty { min-width: 26px; font-weight: 700; }
.bf-line-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.bf-line-total { display: flex; justify-content: space-between; font-size: var(--fs-sm); }
.bf-move { display: flex; gap: var(--tap-gap); }
.bf-foot { position: sticky; bottom: 0; margin: 4px -20px -20px; padding: 12px 20px 20px; background: var(--color-surface); border-top: 1px solid var(--color-border); }
.bf-back { align-self: flex-start; }
.bf-due { display: flex; flex-direction: column; padding: 16px; border-radius: var(--radius-lg); background: var(--color-surface-2); }
.bf-due-amount { font-size: 40px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
.bf-methods { display: grid; grid-template-columns: 1fr; gap: var(--tap-gap); }
.bf-method { width: 100%; font-size: var(--fs-lg); font-weight: 700; }
.bf-qr { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.bf-alert { padding: 12px 14px; border-radius: var(--radius-md); font-size: var(--fs-sm); line-height: 1.5; font-weight: 600; }
.bf-alert[data-tone='danger'] { background: var(--color-danger-50); color: var(--color-danger-fg); }
.bf-alert[data-tone='warning'] { background: var(--color-warning-50); color: var(--color-warning-fg); }
.bf-success { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: var(--radius-md); background: var(--color-success-50); color: color-mix(in srgb, var(--color-success) 68%, var(--color-text)); }
.bf-success .bf-muted { color: inherit; opacity: 0.85; }
.bf-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 24px; color: var(--color-text-secondary); font-size: var(--fs-sm); line-height: 1.6; max-width: 360px; margin: 0 auto; }
.bf-empty strong { color: var(--color-text); font-size: var(--fs-lg); }
@media (max-width: 1100px) { .bf-root { grid-template-columns: minmax(0, 1fr) 380px; } }
@media (max-width: 767px) {
  .bf-root { display: block; height: auto; }
  .bf-list { padding: var(--screen-pad); }
  .bf-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .bf-panel { border-left: 0; }
  .bf-panel > .bf-back { margin: var(--screen-pad) var(--screen-pad) 0; }
  .bf-panel-body { padding: var(--screen-pad); }
  .bf-foot { margin: 4px calc(-1 * var(--screen-pad)) 0; bottom: var(--tabbar-h); }
}
`;
