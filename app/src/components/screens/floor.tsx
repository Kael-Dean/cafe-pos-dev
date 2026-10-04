'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from '../icons';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useFadeRise } from '@/lib/motion';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardgameEnabled } from '@/hooks/use-features';
import { useFloorTables, type FloorTable } from '@/hooks/use-floor';
import { useTableSessions, useBillingPreview, type TableSession } from '@/hooks/use-table-sessions';
import { bahtStr, clockTime, formatMinutes, minutesSince } from '@/lib/money';
import OpenSessionModal, { SessionDetailModal } from './table-session-modal';
import SettleModal from './settle-modal';

export interface ActiveTableSession {
  sessionId: string;
  tableName: string;
}

interface Props {
  /** Sends the party's tab to the POS screen (orders get `session_id`). */
  onOrderForSession?: (s: ActiveTableSession) => void;
  /** Jump to another screen (used by the empty states that point at table setup). */
  onNavigate?: (screen: string) => void;
}

const ZONE_FALLBACK = 'ไม่ระบุโซน';

export default function Floor({ onOrderForSession, onNavigate }: Props) {
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);
  const { enabled: boardgame, isLoading: featureLoading } = useBoardgameEnabled();

  const tablesQ = useFloorTables(false, boardgame);
  const sessionsQ = useTableSessions('OPEN', boardgame);

  const [openFor, setOpenFor] = useState<FloorTable | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [settleFor, setSettleFor] = useState<string | null>(null);

  // Clock tick for the "time elapsed" readout on each card. This is a display
  // clock only — every baht figure comes from the billing-preview endpoint.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const tables = useMemo(() => tablesQ.data ?? [], [tablesQ.data]);
  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);

  const sessionByTable = useMemo(() => {
    const m = new Map<string, TableSession>();
    for (const s of sessions) m.set(s.tableId, s);
    return m;
  }, [sessions]);

  const zones = useMemo(() => {
    const groups = new Map<string, FloorTable[]>();
    for (const t of tables) {
      const key = t.zone?.trim() || ZONE_FALLBACK;
      const list = groups.get(key);
      if (list) list.push(t); else groups.set(key, [t]);
    }
    return [...groups.entries()];
  }, [tables]);

  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const detailSession = detailFor ? sessions.find((s) => s.id === detailFor) ?? null : null;
  const settleSession = settleFor ? sessions.find((s) => s.id === settleFor) ?? null : null;

  const occupied = sessionByTable.size;
  const free = Math.max(0, tables.length - occupied);

  const contentRef = useFadeRise();

  // ── Feature gate: the add-on is invisible, not forbidden ────────────────────
  if (featureLoading) {
    return (
      <div className="screen-pad-lg" style={{ padding: 'var(--space-8)' }} aria-busy="true">
        <span className="sr-only">กำลังโหลดผังโต๊ะ…</span>
        <Skeleton height={28} width={220} radius="var(--radius-md)" style={{ marginBottom: 'var(--space-6)' }} />
        <div className="cols-2-phone floor-grid" style={GRID}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={TILE_MIN_H} radius="var(--radius-lg)" />)}
        </div>
      </div>
    );
  }

  if (!boardgame) {
    return (
      <EmptyState
        icon="info"
        title="ร้านนี้ยังไม่ได้เปิดใช้ระบบโต๊ะ"
        body="แพ็กเกจบอร์ดเกม (vertical.boardgame) ยังไม่ได้เปิดให้ร้านนี้ — ติดต่อผู้ดูแลระบบเพื่อเปิดใช้งาน"
      />
    );
  }

  const loading = tablesQ.isLoading || sessionsQ.isLoading;

  return (
    // maxWidth 1600 (was 1200) so a 1920 counter fits 5–6 tiles a row (TOUCH-SPEC §3.8).
    <div ref={contentRef} className="screen-pad-lg" style={{ padding: 'var(--space-8)', maxWidth: 1600, margin: '0 auto' }}>
      <style>{FLOOR_PHONE_CSS}</style>
      <div className="floor-head" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        <h1 className="text-balance floor-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          <Icon name="park" size={20} style={{ marginRight: 8 }} />
          ผังโต๊ะ
        </h1>
        <div className="floor-chips" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <SummaryChip label="ว่าง" value={free} tone="success" />
          <SummaryChip label="กำลังใช้" value={occupied} tone="primary" />
        </div>
        <button
          onClick={() => { void tablesQ.refetch(); void sessionsQ.refetch(); }}
          className="btn btn-ghost tap-std"
          style={{ marginLeft: 'auto', fontSize: 'var(--fs-body)' }}
        >
          <Icon name="refresh" size={18} /> รีเฟรช
        </button>
      </div>

      {loading && (
        <div aria-busy="true" className="cols-2-phone floor-grid" style={GRID}>
          <span className="sr-only">กำลังโหลดผังโต๊ะ…</span>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={TILE_MIN_H} radius="var(--radius-lg)" />)}
        </div>
      )}

      {!loading && tables.length === 0 && (
        <EmptyState
          icon="park"
          title="ยังไม่มีโต๊ะในร้าน"
          body={admin ? 'สร้างโต๊ะและแพ็กเกจเวลาก่อน แล้วค่อยกลับมาเปิดโต๊ะที่หน้านี้' : 'ให้ผู้จัดการสร้างโต๊ะที่หน้า “ตั้งค่าโต๊ะ” ก่อน'}
          action={admin && onNavigate ? { label: 'ไปตั้งค่าโต๊ะ', onClick: () => onNavigate('table-setup') } : undefined}
        />
      )}

      {!loading && zones.map(([zone, list]) => (
        <section key={zone} className="floor-zone" style={{ marginBottom: 'var(--space-8)' }}>
          {/* Sentence case, no tracked uppercase: Thai has no case (TOUCH-SPEC §3.8). */}
          <h2 style={{
            fontSize: 'var(--fs-body)', fontWeight: 700,
            color: 'var(--color-text-secondary)', margin: '0 0 var(--space-3)',
          }}>
            {zone}
          </h2>
          <div className="cols-2-phone floor-grid" style={GRID}>
            {list.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                session={sessionByTable.get(table.id) ?? null}
                now={now}
                onClick={() => {
                  const s = sessionByTable.get(table.id);
                  if (s) setDetailFor(s.id); else setOpenFor(table);
                }}
              />
            ))}
          </div>
        </section>
      ))}

      {openFor && (
        <OpenSessionModal
          table={openFor}
          onClose={() => setOpenFor(null)}
          onGoSetup={onNavigate ? () => { setOpenFor(null); onNavigate('table-setup'); } : undefined}
        />
      )}

      {detailSession && (
        <SessionDetailModal
          session={detailSession}
          table={tableById.get(detailSession.tableId) ?? null}
          tables={tables}
          canVoid={admin}
          onClose={() => setDetailFor(null)}
          onOrder={onOrderForSession
            ? () => {
                const name = tableById.get(detailSession.tableId)?.name ?? '';
                setDetailFor(null);
                onOrderForSession({ sessionId: detailSession.id, tableName: name });
              }
            : undefined}
          onSettle={() => { setDetailFor(null); setSettleFor(detailSession.id); }}
        />
      )}

      {settleSession && (
        <SettleModal
          session={settleSession}
          tableName={tableById.get(settleSession.tableId)?.name ?? ''}
          onClose={() => setSettleFor(null)}
        />
      )}
    </div>
  );
}

// ── Table card ────────────────────────────────────────────────────────────────
function TableCard({ table, session, now, onClick }: {
  table: FloorTable;
  session: TableSession | null;
  now: number;
  onClick: () => void;
}) {
  // Running total for an occupied table. The server owns this number: grace,
  // rounding, minimum charge, per-head multiplication and the daily cap all live
  // there, so the card only ever prints what came back.
  const preview = useBillingPreview(session?.id ?? null, !!session);

  const elapsed = session ? minutesSince(session.openedAt, now) : 0;
  const overtime = !!session && elapsed > session.rateSnapshot.maxOpenMinutes;
  const busy = !!session;

  return (
    <button
      onClick={onClick}
      className="tap floor-card"
      aria-label={busy
        ? `โต๊ะ ${table.name} กำลังใช้ ${session.partySize} คน ${formatMinutes(elapsed)}`
        : `โต๊ะ ${table.name} ว่าง`}
      style={{
        textAlign: 'left', width: '100%', minHeight: TILE_MIN_H,
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
        padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
        // Busy vs free reads from the surface tone; both keep a 1px hairline.
        background: busy ? 'var(--color-primary-50, var(--color-surface-2))' : 'var(--color-surface)',
        border: `1px solid ${busy ? 'var(--color-primary)' : 'var(--color-border)'}`,
        color: 'var(--color-text)',
      }}
    >
      <div className="floor-card-head" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className="floor-card-name" style={{ fontSize: 22, fontWeight: 700, lineHeight: 'var(--lh-tight)' }}>{table.name}</span>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>{table.capacity} ที่</span>
        <span style={{
          marginLeft: 'auto', fontSize: 'var(--fs-cap)', fontWeight: 700, padding: '2px 10px', minHeight: 24,
          display: 'inline-flex', alignItems: 'center', borderRadius: 999, flexShrink: 0,
          background: busy ? 'var(--color-primary)' : 'var(--color-success-50, var(--color-surface-2))',
          color: busy ? 'var(--color-text-inverse)' : SUCCESS_INK,
        }}>
          {busy ? 'กำลังใช้' : 'ว่าง'}
        </span>
      </div>

      {!session && (
        <div style={{ marginTop: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>
          แตะเพื่อเปิดโต๊ะ
        </div>
      )}

      {session && (
        <>
          <div className="floor-card-meta" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>
            <span style={META_ITEM}><Icon name="user" size={16} />{session.partySize} คน</span>
            <span className="num" style={META_ITEM}><Icon name="clock" size={16} />{formatMinutes(elapsed)}</span>
          </div>
          <div className="num" style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>เปิด {clockTime(session.openedAt)}</div>

          <div className="floor-card-foot" style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span className="num" style={{ fontSize: 'var(--fs-h1)', fontWeight: 700, lineHeight: 'var(--lh-tight)', fontVariantNumeric: 'tabular-nums' }}>
              {preview.isLoading || !preview.data ? '—' : bahtStr(preview.data.amount)}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
              {preview.data?.withinGrace && <MiniBadge tone="info">ยังไม่คิดเงิน</MiniBadge>}
              {preview.data?.capApplied && <MiniBadge tone="success">ถึงเพดานวัน</MiniBadge>}
              {overtime && <MiniBadge tone="warning">เกินเวลาที่ตั้งไว้</MiniBadge>}
            </div>
          </div>
        </>
      )}
    </button>
  );
}

/**
 * Phones (< 768px): two table cards per row (one 200px column wasted half the
 * screen), so each card is ~160px wide — the name row and the amount row wrap
 * instead of pushing the status pill / badges out of the card.
 */
const FLOOR_PHONE_CSS = `
@media (max-width: 767px) {
  /* title + refresh on the first row, the two counters underneath */
  .floor-head { gap: 10px 12px !important; margin-bottom: 16px !important; }
  .floor-title { flex: 1; min-width: 0; display: flex; align-items: center; font-size: 20px !important; }
  .floor-chips { order: 3; flex: 1 0 100%; }
  .floor-card-meta { flex-wrap: wrap; row-gap: 2px; }
  .floor-card-meta > span { display: inline-flex; align-items: center; white-space: nowrap; }
  .floor-zone { margin-bottom: 20px !important; }
  .floor-grid { gap: 10px !important; }
  .floor-card { padding: 12px !important; min-height: 132px !important; min-width: 0; }
  .floor-card-name { font-size: 20px !important; }
  .floor-card-head { flex-wrap: wrap; row-gap: 2px; }
  .floor-card-name { min-width: 0; overflow-wrap: anywhere; line-height: 1.25; }
  .floor-card-foot { flex-wrap: wrap; }
}
`;

// ── Small shared bits ─────────────────────────────────────────────────────────
/** Tile grid: 220px min tiles (3 at 1024 with the rail, 5–6 at 1920); phones 2 cols via .cols-2-phone. */
const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-4)' };
const TILE_MIN_H = 148;
/** Icon + label on one line (the icon svg is display:block). */
const META_ITEM: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' };
/** Plain --color-success is ~3.6:1 on its tint; nudged toward the text colour for AA. */
const SUCCESS_INK = 'color-mix(in srgb, var(--color-success) 68%, var(--color-text))';

function MiniBadge({ children, tone }: { children: React.ReactNode; tone: 'info' | 'success' | 'warning' }) {
  const color = tone === 'warning' ? 'var(--color-warning-fg)' : tone === 'success' ? SUCCESS_INK : 'var(--color-info)';
  return (
    <span style={{
      fontSize: 'var(--fs-cap)', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      border: `1px solid ${color}`, color,
    }}>
      {children}
    </span>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: 'success' | 'primary' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
      background: 'var(--color-surface-2)', border: 'var(--hairline)', fontSize: 'var(--fs-sm)',
    }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <strong className="num" style={{ color: tone === 'success' ? SUCCESS_INK : 'var(--color-primary)' }}>{value}</strong>
    </span>
  );
}

export function EmptyState({ icon, title, body, action }: {
  icon: string;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div style={{
      padding: 'var(--space-8)', maxWidth: 520, margin: '0 auto', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 'var(--radius-lg)', display: 'grid', placeItems: 'center',
        background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)',
      }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>{body}</p>
      {action && (
        <button onClick={action.onClick} className="btn btn-primary btn-lg tap-lg" style={{ marginTop: 'var(--space-2)' }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
