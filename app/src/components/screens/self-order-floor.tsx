'use client';

import { useMemo, useState } from 'react';
import Icon from '../icons';
import { ModalShell, Select, NumberInput, useToast } from '../app-common';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useRatePlans } from '@/hooks/use-rate-plans';
import { useOpenTableSession } from '@/hooks/use-table-sessions';
import {
  useBillPreview, useFloorLive, useReassignOrder, type LiveSession, type LiveTable,
} from '@/hooks/use-self-ordering';
import { describeError, hasDefaultPlan, isZeroAmount } from '@/lib/self-ordering';
import { bahtStr, clockTime } from '@/lib/money';
import TableCheckoutModal from './table-checkout-modal';

export interface SelfOrderFloorProps {
  /** Hands the table's tab to the POS screen (walk-up order: DINE_IN + session_id, no guest). */
  onOrderForSession?: (s: { sessionId: string; tableName: string }) => void;
  onNavigate?: (screen: string) => void;
}

const SUCCESS_INK = 'color-mix(in srgb, var(--color-success) 68%, var(--color-text))';

/**
 * Warns the owner that customers cannot join: with no default rate plan every scan is a 409.
 * Self-contained so the floor, the board and the setup screen can all show it.
 */
export function NoDefaultPlanBanner({ onFix }: { onFix?: () => void }) {
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);
  const plansQ = useRatePlans(admin);
  if (!admin || plansQ.isLoading || !plansQ.data || hasDefaultPlan(plansQ.data)) return null;
  return (
    <div role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', padding: 'var(--space-3) var(--space-4)',
      borderRadius: 'var(--radius-md)', background: 'var(--color-warning-50)', color: 'var(--color-warning-fg)', fontWeight: 600,
    }}>
      <Icon name="warning" size={20} />
      <span style={{ flex: 1, minWidth: 220 }}>
        ลูกค้าสแกน QR แล้วจะเข้าโต๊ะไม่ได้ — ร้านยังไม่มีแพ็กเกจค่าเริ่มต้น (Bar tab ราคา 0)
      </span>
      {onFix && <button onClick={onFix} className="btn btn-primary tap-std">ไปตั้งค่า</button>}
    </div>
  );
}

export default function SelfOrderFloor({ onOrderForSession, onNavigate }: SelfOrderFloorProps) {
  const liveQ = useFloorLive(true);
  const [detail, setDetail] = useState<string | null>(null); // table id
  const [openFor, setOpenFor] = useState<LiveTable['table'] | null>(null);
  const [checkout, setCheckout] = useState<{ sessionId: string; tableName: string; guestId: string | null } | null>(null);

  const tables = useMemo(() => {
    const list = liveQ.data ?? [];
    // Tables asking for the bill first, then occupied, then free; stable by name inside a group.
    const rank = (t: LiveTable) => (t.session ? (t.session.checkout_requested_count > 0 ? 0 : 1) : 2);
    return list.slice().sort((a, b) => rank(a) - rank(b) || a.table.name.localeCompare(b.table.name, 'th', { numeric: true }));
  }, [liveQ.data]);

  const asking = tables.filter((t) => (t.session?.checkout_requested_count ?? 0) > 0).length;
  const occupied = tables.filter((t) => t.session).length;
  const detailEntry = detail ? tables.find((t) => t.table.id === detail) ?? null : null;

  return (
    <div className="screen-pad-lg" style={{ padding: 'var(--space-6)', maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <style>{FLOOR_CSS}</style>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <h1 className="text-balance" style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>โต๊ะ</h1>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }} role="status">
          <Chip label="ว่าง" value={tables.length - occupied} />
          <Chip label="มีคนนั่ง" value={occupied} />
          {asking > 0 && <Chip label="ขอเช็คบิล" value={asking} alert />}
        </div>
        <button onClick={() => { void liveQ.refetch(); }} className="btn btn-ghost tap-lg" style={{ marginLeft: 'auto' }}>
          <Icon name="refresh" size={20} /> รีเฟรช
        </button>
      </header>

      <NoDefaultPlanBanner onFix={onNavigate ? () => onNavigate('table-setup') : undefined} />

      {liveQ.isError && !liveQ.data && (
        <div role="alert" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)', color: 'var(--color-danger-fg)', fontWeight: 600 }}>
          โหลดผังโต๊ะไม่สำเร็จ — {describeError(liveQ.error, 'checkout')}
          <button onClick={() => { void liveQ.refetch(); }} className="btn btn-ghost tap-std" style={{ marginLeft: 12 }}>ลองอีกครั้ง</button>
        </div>
      )}

      {liveQ.isLoading && (
        <div aria-busy="true" className="sf-grid">
          <span className="sr-only">กำลังโหลดผังโต๊ะ…</span>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={170} radius="var(--radius-lg)" />)}
        </div>
      )}

      {liveQ.data && tables.length === 0 && (
        <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          ยังไม่มีโต๊ะในร้าน — ไปที่ “ตั้งค่าโต๊ะ” เพื่อสร้างโต๊ะ
          {onNavigate && <div><button onClick={() => onNavigate('table-setup')} className="btn btn-primary btn-lg tap-lg" style={{ marginTop: 12 }}>ไปตั้งค่าโต๊ะ</button></div>}
        </div>
      )}

      <div className="sf-grid">
        {tables.map((t) => (
          <TableTile
            key={t.table.id}
            entry={t}
            onClick={() => { if (t.session) setDetail(t.table.id); else setOpenFor(t.table); }}
          />
        ))}
      </div>

      {detailEntry?.session && (
        <TableDetailModal
          table={detailEntry.table}
          session={detailEntry.session}
          onClose={() => setDetail(null)}
          onOrder={onOrderForSession
            ? () => {
                const sessionId = detailEntry.session!.id;
                const tableName = detailEntry.table.name;
                setDetail(null);
                onOrderForSession({ sessionId, tableName });
              }
            : undefined}
          onCheckout={(guestId) => {
            const sessionId = detailEntry.session!.id;
            setDetail(null);
            setCheckout({ sessionId, tableName: detailEntry.table.name, guestId });
          }}
        />
      )}

      {openFor && <OpenTableModal table={openFor} onClose={() => setOpenFor(null)} />}

      {checkout && (
        <TableCheckoutModal
          sessionId={checkout.sessionId}
          tableName={checkout.tableName}
          initialGuestId={checkout.guestId}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  );
}

function TableTile({ entry, onClick }: { entry: LiveTable; onClick: () => void }) {
  const { table, session } = entry;
  const asking = session?.checkout_requested_count ?? 0;
  const guests = session?.guests ?? [];

  return (
    <button
      onClick={onClick}
      className="sf-tile tap"
      data-asking={asking > 0 ? '' : undefined}
      data-busy={session ? '' : undefined}
      aria-label={session
        ? `โต๊ะ ${table.name} มีคนนั่ง ${guests.length} คน ค้างจ่าย ${bahtStr(session.unpaid_total)}${asking > 0 ? ` ขอเช็คบิล ${asking} คน` : ''}`
        : `โต๊ะ ${table.name} ว่าง`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{table.name}</span>
        <span className="sf-status" data-asking={asking > 0 ? '' : undefined}>
          {asking > 0 ? <><Icon name="bell" size={14} /> ขอเช็คบิล {asking}</> : session ? 'มีคนนั่ง' : 'ว่าง'}
        </span>
      </div>

      {!session && <div style={{ marginTop: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>แตะเพื่อเปิดโต๊ะให้ลูกค้าที่ไม่ได้สแกน</div>}

      {session && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 'var(--fs-sm)' }}>
            {guests.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>ยังไม่มีแขกสแกน · เปิด {clockTime(session.opened_at)}</span>}
            {guests.slice(0, 5).map((g) => (
              <span key={g.id} className="sf-guest" data-asking={g.status === 'CHECKOUT_REQUESTED' ? '' : undefined}>
                {g.label}{!isZeroAmount(g.unpaid_total) && <span className="num"> {bahtStr(g.unpaid_total)}</span>}
              </span>
            ))}
            {guests.length > 5 && <span className="sf-guest">+{guests.length - 5}</span>}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>ค้างจ่าย {session.unpaid_orders} บิล</span>
            <strong className="num" style={{ fontSize: 28 }}>{bahtStr(session.unpaid_total)}</strong>
          </div>
        </>
      )}
    </button>
  );
}

// ── Table detail: guests, walk-up orders to assign, actions ───────────────────
function TableDetailModal({ table, session, onClose, onOrder, onCheckout }: {
  table: LiveTable['table'];
  session: LiveSession;
  onClose: () => void;
  onOrder?: () => void;
  onCheckout: (guestId: string | null) => void;
}) {
  const toast = useToast();
  const bill = useBillPreview(session.id, null);
  const reassign = useReassignOrder();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Orders with nobody's name on them = rung by the owner (walk-up). They are billed to the
  // table unless he puts them on a person.
  const walkUps = (bill.data?.lines ?? []).filter((l) => !l.guest_label && !l.is_time_charge);
  const guestOptions = session.guests.map((g) => ({ value: g.id, label: g.label }));

  const move = async (orderId: string) => {
    const guestId = target[orderId];
    if (!guestId || reassign.isPending) return;
    setError(null);
    try {
      await reassign.mutateAsync({ sessionId: session.id, orderId, guestId });
      toast({ kind: 'success', title: 'ย้ายออเดอร์ให้คนนั้นแล้ว' });
    } catch (e) {
      setError(describeError(e, 'reassign'));
    }
  };

  return (
    <ModalShell
      title={`โต๊ะ ${table.name}`}
      subtitle={`เปิด ${clockTime(session.opened_at)} · ${session.guests.length} คน`}
      onClose={onClose}
      width={600}
      footer={
        <>
          {onOrder && (
            <button onClick={onOrder} className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }}>
              <Icon name="cart" size={20} /> สั่งให้โต๊ะนี้
            </button>
          )}
          <button onClick={() => onCheckout(null)} className="btn btn-primary btn-lg tap-lg" style={{ flex: 1.4 }}>
            <Icon name="cash" size={20} /> เช็คบิล / ปิดโต๊ะ
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-4)' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>ค้างจ่ายทั้งโต๊ะ</span>
        <strong className="num" style={{ fontSize: 30 }}>{bahtStr(session.unpaid_total)}</strong>
      </div>

      <h3 style={h3}>แขกในโต๊ะ</h3>
      {session.guests.length === 0 && <p style={muted}>ยังไม่มีลูกค้าสแกน QR ที่โต๊ะนี้</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tap-gap)', marginBottom: 'var(--space-5)' }}>
        {session.guests.map((g) => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontWeight: 700, fontSize: 17, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{g.label}</span>
            {g.status === 'CHECKOUT_REQUESTED' && <span className="sf-status" data-asking=""><Icon name="bell" size={14} /> ขอเช็คบิล</span>}
            {g.status === 'CHECKED_OUT' && <span style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>เช็คเอาท์แล้ว</span>}
            <span className="num" style={{ fontWeight: 700 }}>{bahtStr(g.unpaid_total)}</span>
            {!isZeroAmount(g.unpaid_total) && (
              <button onClick={() => onCheckout(g.id)} className="btn btn-ghost tap-std" aria-label={`เช็คบิล ${g.label}`}>เช็คบิล</button>
            )}
          </div>
        ))}
      </div>

      {walkUps.length > 0 && (
        <>
          <h3 style={h3}>ออเดอร์ที่ยังไม่มีเจ้าของ ({walkUps.length})</h3>
          <p style={{ ...muted, marginTop: -6 }}>พนักงานสั่งให้ — คิดรวมทั้งโต๊ะ ย้ายให้คนใดคนหนึ่งได้</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tap-gap)' }}>
            {walkUps.map((l) => (
              <div key={l.order_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tap-gap)', flexWrap: 'wrap' }}>
                <span className="num" style={{ minWidth: 90 }}>#{l.receipt_no}</span>
                <span className="num" style={{ fontWeight: 700, minWidth: 64 }}>{bahtStr(l.total)}</span>
                <Select
                  value={target[l.order_id] ?? ''}
                  onChange={(v) => setTarget((p) => ({ ...p, [l.order_id]: v }))}
                  ariaLabel={`ย้ายออเดอร์ ${l.receipt_no} ให้`}
                  placeholder={guestOptions.length ? '— เลือกคน —' : 'ไม่มีแขก'}
                  disabled={guestOptions.length === 0}
                  options={guestOptions}
                  style={{ flex: 1, minWidth: 140 }}
                  triggerStyle={{ minHeight: 'var(--tap-std)' }}
                />
                <button
                  onClick={() => { void move(l.order_id); }}
                  disabled={!target[l.order_id] || reassign.isPending}
                  className="btn btn-primary tap-std"
                >
                  ย้าย
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {error && <div role="alert" style={errBox}>{error}</div>}
    </ModalShell>
  );
}

// ── Open a table by hand (walk-up customer who did not scan) ──────────────────
function OpenTableModal({ table, onClose }: { table: LiveTable['table']; onClose: () => void }) {
  const toast = useToast();
  const open = useOpenTableSession();
  const [party, setParty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (open.isPending) return;
    setError(null);
    try {
      // rate_plan_id omitted → the store's default plan ("Bar tab", no time charge)
      await open.mutateAsync({ table_id: table.id, party_size: party });
      toast({ kind: 'success', title: `เปิดโต๊ะ ${table.name} แล้ว` });
      onClose();
    } catch (e) {
      setError(describeError(e, 'open-table'));
    }
  };

  return (
    <ModalShell
      title={`เปิดโต๊ะ ${table.name}`}
      subtitle="สำหรับลูกค้าที่ไม่ได้สแกน QR — ลูกค้าที่สแกนทีหลังจะเข้าบิลเดียวกัน"
      onClose={onClose}
      busy={open.isPending}
      width={460}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }}>ยกเลิก</button>
          <button onClick={() => { void submit(); }} disabled={open.isPending || party < 1} className="btn btn-primary btn-lg tap-lg" style={{ flex: 1.5 }}>
            {open.isPending ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : 'เปิดโต๊ะ'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 8 }}>จำนวนคน</div>
      <NumberInput value={party} onChange={setParty} min={1} max={100} integer aria-label="จำนวนคน" style={{ width: '100%', minHeight: 'var(--tap-std)', fontSize: 'var(--fs-lg)', boxSizing: 'border-box' }} />
      {error && <div role="alert" style={errBox}>{error}</div>}
    </ModalShell>
  );
}

function Chip({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, fontSize: 'var(--fs-body)',
      background: alert ? 'var(--color-danger-strong)' : 'var(--color-surface-2)', color: alert ? '#fff' : 'var(--color-text)',
      border: alert ? 'none' : 'var(--hairline)', fontWeight: alert ? 800 : 500,
    }}>
      {label} <strong className="num" style={{ color: alert ? '#fff' : SUCCESS_INK }}>{value}</strong>
    </span>
  );
}

const h3: React.CSSProperties = { fontSize: 'var(--fs-body)', fontWeight: 700, margin: '0 0 var(--space-3)' };
const muted: React.CSSProperties = { fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-4)' };
const errBox: React.CSSProperties = {
  marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-danger-50)', color: 'var(--color-danger-fg)', fontWeight: 600, fontSize: 'var(--fs-body)',
};

const FLOOR_CSS = `
.sf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-4); }
.sf-tile { text-align: left; width: 100%; min-height: 170px; display: flex; flex-direction: column; gap: var(--space-3); cursor: pointer;
  padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text); }
.sf-tile[data-busy] { background: var(--color-primary-50, var(--color-surface-2)); border-color: var(--color-primary); }
.sf-tile[data-asking] { border: 3px solid var(--color-danger-strong); background: var(--color-danger-50); }
.sf-status { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-cap); font-weight: 700;
  padding: 3px 10px; border-radius: 999px; background: var(--color-surface-2); color: var(--color-text-secondary); }
.sf-status[data-asking] { background: var(--color-danger-strong); color: #fff; }
.sf-guest { padding: 2px 10px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); }
.sf-guest[data-asking] { border-color: var(--color-danger-strong); font-weight: 700; }
@media (prefers-reduced-motion: no-preference) {
  .sf-tile[data-asking] { animation: sf-pulse 1.6s ease-in-out infinite; }
}
@keyframes sf-pulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-danger-strong) 30%, transparent); } }
@media (max-width: 767px) { .sf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .sf-tile { min-height: 140px; padding: 12px; } }
`;
