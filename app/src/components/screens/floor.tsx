'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../icons';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useBoardgameEnabled } from '@/hooks/use-features';
import { useFloorTables, type FloorTable } from '@/hooks/use-floor';
import { useTableSessions, useBillingPreview, type TableSession } from '@/hooks/use-table-sessions';
import { useOnlineStatus } from '@/components/pwa/offline-indicator';
import { bahtStr, clockTime, formatMinutes, minutesSince } from '@/lib/money';
import { useI18n } from '@/lib/i18n';
import { Badge, Banner, Button, Card, EmptyState, IconButton, Skeleton, cn } from '@/components/ui';
import OpenSessionModal, { SessionDetailModal } from './table-session-modal';
import SettleModal from './settle-modal';
import s from './floor.module.css';

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

/** Floor and sessions are re-read on this cadence while the tab is visible (UI-SPEC §4.2: poll, no pull-to-refresh). */
const POLL_MS = 30_000;
/** Older than this (two missed polls + slack) and the board says so. */
const STALE_MS = 75_000;
const JUMP_RESET_MS = 900;

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function Floor({ onOrderForSession, onNavigate }: Props) {
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);
  const online = useOnlineStatus();
  const { enabled: boardgame, isLoading: featureLoading } = useBoardgameEnabled();

  const tablesQ = useFloorTables(false, boardgame);
  const sessionsQ = useTableSessions('OPEN', boardgame);
  const { refetch: refetchTables } = tablesQ;
  const { refetch: refetchSessions } = sessionsQ;
  const refresh = useCallback(() => { void refetchTables(); void refetchSessions(); }, [refetchTables, refetchSessions]);

  // ── Dialog state. Each dialog stays mounted while it fades out, so the data it
  // shows is kept separately from whether it is open.
  const [openTarget, setOpenTarget] = useState<FloorTable | null>(null);
  const [openShown, setOpenShown] = useState(false);
  const [openKey, setOpenKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailShown, setDetailShown] = useState(false);
  const [settleFor, setSettleFor] = useState<string | null>(null);

  // Display clock for elapsed time + staleness. Every baht figure comes from the server.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Poll while visible. Sessions change all shift long; tables rarely, but a
  // re-read is cheap and keeps "free" honest across devices.
  useEffect(() => {
    if (!boardgame) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [boardgame, refresh]);

  const tables = useMemo(() => tablesQ.data ?? [], [tablesQ.data]);
  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);

  const sessionByTable = useMemo(() => {
    const m = new Map<string, TableSession>();
    for (const x of sessions) m.set(x.tableId, x);
    return m;
  }, [sessions]);

  const zones = useMemo(() => {
    const groups = new Map<string, FloorTable[]>();
    for (const tb of tables) {
      const key = tb.zone?.trim() || t.floor.zoneFallback;
      const list = groups.get(key);
      if (list) list.push(tb); else groups.set(key, [tb]);
    }
    return [...groups.entries()];
  }, [tables, t.floor.zoneFallback]);

  const tableById = useMemo(() => new Map(tables.map((tb) => [tb.id, tb])), [tables]);

  // Keep the last seen session so the detail dialog has content while it fades out
  // (or after the session was closed from another device).
  const liveDetail = detailId ? sessions.find((x) => x.id === detailId) ?? null : null;
  const [lastDetail, setLastDetail] = useState<TableSession | null>(null);
  if (liveDetail && liveDetail !== lastDetail) setLastDetail(liveDetail);
  const detailSession = liveDetail ?? lastDetail;
  if (detailShown && detailId && !liveDetail && sessionsQ.isSuccess && !sessionsQ.isFetching) setDetailShown(false);
  const settleSession = settleFor ? sessions.find((x) => x.id === settleFor) ?? null : null;

  const occupied = sessionByTable.size;
  const free = Math.max(0, tables.length - occupied);
  const overCount = sessions.filter((x) => minutesSince(x.openedAt, now) > x.rateSnapshot.maxOpenMinutes).length;

  const openTable = (table: FloorTable) => {
    const x = sessionByTable.get(table.id);
    if (x) { setDetailId(x.id); setDetailShown(true); return; }
    setOpenTarget(table);
    setOpenKey((k) => k + 1);
    setOpenShown(true);
  };

  // ── Type a table name to jump to it (UI-SPEC §4.1, scope floor) ─────────────
  const [jump, setJump] = useState('');
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tablesRef = useRef(tables);
  useEffect(() => { tablesRef.current = tables; }, [tables]);
  useEffect(() => {
    let buffer = '';
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      buffer += e.key.toLowerCase();
      const hit = tablesRef.current.find((tb) => tb.name.toLowerCase().startsWith(buffer));
      if (hit) document.querySelector<HTMLElement>(`[data-table-id="${CSS.escape(hit.id)}"]`)?.focus();
      setJump(buffer);
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
      jumpTimer.current = setTimeout(() => { buffer = ''; setJump(''); }, JUMP_RESET_MS);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
    };
  }, []);

  // ── Feature gate: the add-on is invisible, not forbidden ────────────────────
  if (featureLoading) return <FloorSkeleton label={t.floor.loading} withHeader />;

  if (!boardgame) {
    return (
      <div className={s.root}>
        <EmptyState icon="info" title={t.floor.notEnabledTitle} body={t.floor.notEnabledBody} headingLevel={2} />
      </div>
    );
  }

  const loading = tablesQ.isLoading || sessionsQ.isLoading;
  const hasData = !!tablesQ.data && !!sessionsQ.data;
  const loadFailed = !hasData && (tablesQ.isError || sessionsQ.isError);
  const lastOk = Math.min(tablesQ.dataUpdatedAt || now, sessionsQ.dataUpdatedAt || now);
  const stale = hasData && (!online || tablesQ.isError || sessionsQ.isError || now - lastOk > STALE_MS);
  const fetching = tablesQ.isFetching || sessionsQ.isFetching;

  return (
    <div className={cn(s.root, 'screen-pad-lg')}>
      <header className={s.head}>
        <h1 className={s.title}>
          <Icon name="park" size={22} />
          {t.floor.title}
        </h1>
        {hasData && tables.length > 0 && (
          <div className={s.summary} role="group" aria-label={t.floor.summaryLabel}>
            <span className={s.count}><Icon name="check" size={16} />{t.floor.free} <strong>{free}</strong></span>
            <span className={s.count}><Icon name="user" size={16} />{t.floor.busy} <strong>{occupied}</strong></span>
            {overCount > 0 && (
              <span className={cn(s.count, s.countOver)}><Icon name="warning" size={16} />{t.floor.overtime} <strong>{overCount}</strong></span>
            )}
          </div>
        )}
        <div className={s.sync}>
          {jump && <span className={s.jump} aria-live="polite"><Icon name="search" size={14} />{jump}</span>}
          {hasData && !stale && <span>{t.floor.updatedAt(hhmm(lastOk))}</span>}
          <IconButton
            icon={<Icon name="refresh" size={18} />}
            label={t.floor.refresh}
            variant="outline"
            loading={fetching && !loading}
            onClick={refresh}
          />
        </div>
      </header>

      {stale && (
        <Banner
          className={s.banner}
          tone="warning"
          icon={online ? 'clock' : 'wifiOff'}
          title={online ? t.floor.staleTitle : t.floor.offlineTitle}
          detail={t.floor.updatedAt(hhmm(lastOk))}
          action={<Button size="sm" variant="secondary" loading={fetching} onClick={refresh}>{t.floor.retry}</Button>}
        />
      )}

      {loading && <FloorSkeleton label={t.floor.loading} />}

      {loadFailed && !loading && (
        <EmptyState
          tone="danger"
          title={t.floor.loadErrorTitle}
          body={t.floor.loadErrorBody}
          headingLevel={2}
          action={<Button variant="secondary" loading={fetching} onClick={refresh}>{t.floor.retry}</Button>}
        />
      )}

      {hasData && tables.length === 0 && (
        <EmptyState
          icon="park"
          title={t.floor.emptyTitle}
          body={admin ? t.floor.emptyBodyAdmin : t.floor.emptyBodyStaff}
          headingLevel={2}
          action={admin && onNavigate
            ? <Button onClick={() => onNavigate('table-setup')}>{t.floor.goSetup}</Button>
            : undefined}
        />
      )}

      {hasData && zones.map(([zone, list], zi) => {
        const busyInZone = list.filter((tb) => sessionByTable.has(tb.id)).length;
        return (
          <section key={zone} className={s.zone} aria-labelledby={`floor-zone-${zi}`}>
            <h2 id={`floor-zone-${zi}`} className={s.zoneHead}>
              {zone}
              <span className={s.zoneMeta}>{busyInZone}/{list.length}</span>
            </h2>
            <div className={cn(s.grid, 'cols-2-phone')}>
              {list.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  session={sessionByTable.get(table.id) ?? null}
                  now={now}
                  onOpen={() => openTable(table)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {openTarget && (
        <OpenSessionModal
          key={openKey}
          open={openShown}
          table={openTarget}
          onClose={() => setOpenShown(false)}
          onGoSetup={onNavigate ? () => { setOpenShown(false); onNavigate('table-setup'); } : undefined}
          onOpened={(session, andOrder) => {
            setOpenShown(false);
            if (andOrder && onOrderForSession) onOrderForSession({ sessionId: session.id, tableName: openTarget.name });
          }}
          canOrder={!!onOrderForSession}
        />
      )}

      {detailSession && (
        <SessionDetailModal
          open={detailShown}
          session={detailSession}
          table={tableById.get(detailSession.tableId) ?? null}
          tables={tables}
          canVoid={admin}
          onClose={() => setDetailShown(false)}
          onOrder={onOrderForSession
            ? () => {
                const name = tableById.get(detailSession.tableId)?.name ?? '';
                setDetailShown(false);
                onOrderForSession({ sessionId: detailSession.id, tableName: name });
              }
            : undefined}
          onSettle={() => { setDetailShown(false); setSettleFor(detailSession.id); }}
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
function TableCard({ table, session, now, onOpen }: {
  table: FloorTable;
  session: TableSession | null;
  now: number;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  // Running total for an occupied table. The server owns this number: grace,
  // rounding, minimum charge, per-head multiplication and the daily cap all live
  // there, so the card only ever prints what came back.
  const preview = useBillingPreview(session?.id ?? null, !!session);

  const elapsed = session ? minutesSince(session.openedAt, now) : 0;
  const overtime = !!session && elapsed > session.rateSnapshot.maxOpenMinutes;
  const busy = !!session;

  // Cross-fade the content only when the state actually flips (not on first paint).
  const [seenBusy, setSeenBusy] = useState(busy);
  const [flips, setFlips] = useState(0);
  if (seenBusy !== busy) { setSeenBusy(busy); setFlips((n) => n + 1); }

  return (
    <Card
      onClick={onOpen}
      data-table-id={table.id}
      className={cn(s.card, busy && s.busy, overtime && s.over)}
      aria-label={busy
        ? t.floor.cardAriaBusy(table.name, session.partySize, formatMinutes(elapsed), overtime)
        : t.floor.cardAriaFree(table.name)}
    >
      <div key={flips} className={cn(s.cardBody, flips > 0 && s.swap)}>
        <div className={s.cardHead}>
          <span className={s.name} title={table.name}>{table.name}</span>
          <span className={s.status}>
            {overtime
              ? <Badge tone="danger"><Icon name="warning" size={12} strokeWidth={2} />{t.floor.overtime}</Badge>
              : busy
                ? <Badge tone="accent"><Icon name="user" size={12} strokeWidth={2} />{t.floor.busy}</Badge>
                : <Badge tone="success"><Icon name="check" size={12} strokeWidth={2} />{t.floor.free}</Badge>}
          </span>
        </div>

        {!session && (
          <>
            <div className={s.meta}><span>{t.floor.seats(table.capacity)}</span></div>
            <div className={s.hint}>{t.floor.tapToOpen}</div>
          </>
        )}

        {session && (
          <>
            <div className={s.meta}>
              <span><Icon name="user" size={14} />{t.floor.people(session.partySize)}<span className={s.seats}>/ {t.floor.seats(table.capacity)}</span></span>
              <span><Icon name="clock" size={14} />{formatMinutes(elapsed)}</span>
              <span>{t.floor.openedAt(clockTime(session.openedAt))}</span>
            </div>
            <div className={s.foot}>
              <span className={s.amount}>
                {preview.isLoading || !preview.data ? '—' : bahtStr(preview.data.amount)}
              </span>
              {(preview.data?.withinGrace || preview.data?.capApplied) && (
                <span className={s.badges}>
                  {preview.data?.withinGrace && <Badge tone="info">{t.floor.withinGrace}</Badge>}
                  {preview.data?.capApplied && <Badge tone="neutral">{t.floor.capApplied}</Badge>}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function FloorSkeleton({ label, withHeader = false }: { label: string; withHeader?: boolean }) {
  const grid = (
    <div className={cn(s.grid, 'cols-2-phone')} aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={120} radius="var(--radius-lg)" />)}
    </div>
  );
  if (!withHeader) return <div aria-busy="true"><span className="sr-only">{label}</span>{grid}</div>;
  return (
    <div className={cn(s.root, 'screen-pad-lg')} aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className={s.head}><Skeleton height={28} width={220} radius="var(--radius-md)" /></div>
      {grid}
    </div>
  );
}
