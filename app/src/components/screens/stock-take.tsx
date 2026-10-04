'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../ui/toast';
import { useStagger } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { useIsPhone } from '@/hooks/use-media-query';
import {
  useStockTakePreview,
  useSubmitStockTake,
  useStockTakeHistory,
  type StockTakePreviewItem,
  type StockTakeAdjustResult,
  type StockTakeEvent,
} from '@/hooks/use-stock-take';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt3 = (n: number) => n.toFixed(3);

const fmtDateTh = (str: string) =>
  new Date(str).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const varianceColor = (v: number) =>
  v > 0 ? 'var(--color-success)' : v < 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)';

const varianceBg = (v: number) =>
  v > 0 ? 'var(--color-accent-50)' : v < 0 ? 'var(--color-danger-50)' : 'transparent';

const fmtVariance = (v: number) => (v > 0 ? `+${fmt3(v)}` : fmt3(v));

// ── Phone layout (< 768px) ────────────────────────────────────────────────────
// Every rule below is phone-only except the first, which carries the dialog gutter
// that used to be inline (an inline padding would beat the phone safe-area padding
// and the keyboard lift that globals.css / use-keyboard-inset apply to the backdrop).
const ST_CSS = `
@media (min-width: 768px) {
  .modal-backdrop.st-backdrop { padding: var(--space-5); }
}
@media (max-width: 767px) {
  .st-head { padding: 12px var(--screen-pad) 0 !important; }
  .st-head-title { font-size: 18px !important; margin-bottom: 8px !important; }
  .st-tabs > button { flex: 1 1 0; justify-content: center; }
  .st-scroll { scroll-padding-bottom: 88px; }
  .st-root textarea { font-size: 16px !important; }
  .st-check { gap: 14px !important; }

  /* Summary tiles shrink so the count sheet starts in the first screenful. */
  .st-kpis { gap: 8px !important; }
  .st-kpi { flex: 1 1 calc(50% - 4px) !important; min-width: 0 !important; padding: 10px 12px !important; }
  .st-kpi:first-child { flex-basis: 100% !important; }
  .st-kpi > :nth-child(1) { margin-bottom: 2px !important; }
  .st-kpi > :nth-child(2) { font-size: 17px !important; }
  .st-kpi > :nth-child(3) { margin-top: 0 !important; }

  /* Count sheet: name on top, system figures left, a thumb-sized count field right. */
  .st-count-head { display: none !important; }
  .st-count-row {
    grid-template-columns: minmax(0, 1fr) 136px !important;
    grid-template-areas: "name name" "sys input" "used input";
    gap: 2px 12px !important; padding: 12px 14px !important;
  }
  .st-count-row > .st-c-name { grid-area: name; display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 8px; margin-bottom: 6px; }
  .st-count-row > .st-c-name > :last-child { font-size: 12px !important; }
  .st-count-row > .st-c-sys { grid-area: sys; align-self: end; }
  .st-count-row > .st-c-used { grid-area: used; align-self: start; font-size: 12px !important; }
  .st-count-row > .st-c-input { grid-area: input; align-self: center; }
  .st-count-row > [data-label] { text-align: left !important; }
  .st-count-row > [data-label]::before { content: attr(data-label) ' '; color: var(--color-text-secondary); }
  .st-count-input {
    width: 100% !important; min-height: 48px; padding: 8px 12px !important;
    font-size: 18px !important; font-weight: 600; font-variant-numeric: tabular-nums;
  }

  /* Save stays in reach while counting; it drops back into the flow while the
     keyboard is up so the rows keep the room. */
  .st-submit {
    /* Sticky insets are measured from the scroller's content edge, so pull the bar
       through the bottom gutter to sit flush on the tab bar. */
    position: sticky; bottom: calc(-1 * var(--screen-pad)); z-index: 2;
    margin: 0 calc(-1 * var(--screen-pad));
    padding: 10px var(--screen-pad);
    background: var(--color-bg); border-top: 1px solid var(--color-border);
  }
  .st-submit > button { width: 100%; justify-content: center; min-height: 48px !important; }
  html[data-kb-open] .st-submit, html[data-kb-resized] .st-submit { position: static; }
  .st-refresh { width: 100%; justify-content: center; }

  /* Variance tables (result dialog, history): two-line rows instead of four columns. */
  .st-var-head { display: none !important; }
  .st-var-row { display: flex !important; flex-wrap: wrap; align-items: baseline; gap: 2px 12px !important; }
  .st-var-row::after { content: ''; order: 2; flex-basis: 100%; height: 0; }
  .st-var-row > .st-v-name { order: 0; flex: 1 1 0; min-width: 0; }
  .st-var-row > .st-v-diff { order: 1; flex: 0 0 auto; font-size: 15px !important; }
  .st-var-row > [data-label] { order: 3; text-align: left !important; font-size: 12px !important; color: var(--color-text-secondary); }
  .st-var-row > [data-label]::before { content: attr(data-label) ' '; }
  .st-history-body { padding: 8px !important; }
}
`;

// ── ModalShell ────────────────────────────────────────────────────────────────
const ModalShell = ({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = 620,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) => (
  <div className="modal-backdrop st-backdrop" style={{ alignItems: 'center' }} onClick={onClose}>
    <div
      className="modal-card"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        maxWidth,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: 'var(--space-5)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="ปิด"
          className="icon-btn hit-44"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            width: 36,
            height: 36,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="scroll" style={{ overflow: 'auto', padding: 'var(--space-5)', flex: 1 }}>
        {children}
      </div>
    </div>
  </div>
);

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KpiCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div
    className="st-kpi"
    style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '16px 20px',
      flex: 1,
      minWidth: 140,
    }}
  >
    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{sub}</div>}
  </div>
);

// ── Result Modal ──────────────────────────────────────────────────────────────
const ResultModal = ({
  results,
  onClose,
}: {
  results: StockTakeAdjustResult[];
  onClose: () => void;
}) => (
  <ModalShell title="ผลการตรวจนับสต็อก" subtitle="เปรียบเทียบยอดจริง vs ระบบ" onClose={onClose} maxWidth={640}>
    {results.length === 0 ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '40px 0',
          color: 'var(--color-text-secondary)',
        }}
      >
        <Icon name="check" size={40} color="var(--color-success)" />
        <div style={{ marginTop: 12, fontSize: 16, fontWeight: 600, color: 'var(--color-success)' }}>
          ไม่มีความแตกต่าง
        </div>
        <div style={{ fontSize: 13, marginTop: 4 }}>ยอดจริงตรงกับระบบทุกรายการ</div>
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          className="st-var-head"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 90px 90px',
            gap: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <span>วัตถุดิบ</span>
          <span style={{ textAlign: 'right' }}>ระบบ</span>
          <span style={{ textAlign: 'right' }}>จริง</span>
          <span style={{ textAlign: 'right' }}>ส่วนต่าง</span>
        </div>
        {results.map((r) => (
          <div
            key={r.inventoryItemId}
            className="st-var-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 90px 90px',
              gap: 8,
              padding: '10px 12px',
              background: varianceBg(r.variance),
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              alignItems: 'center',
            }}
          >
            <div className="st-v-name">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{r.unit}</div>
            </div>
            <div data-label="ระบบ" style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(r.systemQuantity)}</div>
            <div data-label="จริง" style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(r.actualQuantity)}</div>
            <div
              className="st-v-diff"
              style={{
                textAlign: 'right',
                fontSize: 13,
                fontWeight: 700,
                color: varianceColor(r.variance),
              }}
            >
              {fmtVariance(r.variance)}
            </div>
          </div>
        ))}
      </div>
    )}
  </ModalShell>
);

// ── Tab 1: Stock Check ────────────────────────────────────────────────────────
function StockCheckTab() {
  const toast = useToast();
  const isPhone = useIsPhone();
  const { data: preview, isLoading, isError, refetch } = useStockTakePreview();
  const submitMutation = useSubmitStockTake();

  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [resultModal, setResultModal] = useState<StockTakeAdjustResult[] | null>(null);

  const items: StockTakePreviewItem[] = preview?.items ?? [];
  const totalConsumed = items.reduce((s, i) => s + i.consumedInPeriod, 0);

  // KPI cards stagger in once data resolves; one-shot, honors reduced-motion.
  const kpiRef = useStagger({ each: 0.05 });

  const getActual = (item: StockTakePreviewItem) =>
    actuals[item.inventoryItemId] ?? String(item.systemQuantity);

  // Enter / the keypad's "next" key walks down the count column.
  const focusCount = (idx: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-st-count="${idx}"]`);
    if (el) { el.focus(); el.select(); }
  };

  const handleRefresh = () => {
    setActuals({});
    setNotes('');
    refetch();
  };

  const handleSubmit = async () => {
    const payload = {
      items: items.map((i) => ({
        inventory_item_id: i.inventoryItemId,
        actual_quantity: getActual(i),
      })),
      notes: notes.trim() || undefined,
    };

    try {
      const raw = await submitMutation.mutateAsync(payload);
      // map raw results
      const mapped: StockTakeAdjustResult[] = (raw as Array<{
        inventory_item_id: string;
        name: string;
        unit: string;
        system_quantity: string;
        actual_quantity: string;
        variance: string;
      }>).map((r) => ({
        inventoryItemId: r.inventory_item_id,
        name: r.name,
        unit: r.unit,
        systemQuantity: Number(r.system_quantity),
        actualQuantity: Number(r.actual_quantity),
        variance: Number(r.variance),
      }));
      setResultModal(mapped);
      toast({ kind: 'success', title: 'บันทึกสำเร็จ', msg: 'ตรวจนับสต็อกเสร็จสมบูรณ์' });
      setActuals({});
      setNotes('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      toast({ kind: 'danger', title: 'บันทึกไม่สำเร็จ', msg });
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 140 }} aria-busy="true">
              <Skeleton width="60%" height="var(--space-3)" />
              <Skeleton width="45%" height="var(--space-6)" style={{ marginTop: 'var(--space-3)' }} />
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4)' }}>
          <SkeletonTable rows={6} cols={4} label="กำลังโหลดข้อมูล" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: 'var(--color-danger)', gap: 12 }}>
        <Icon name="warning" size={32} color="var(--color-danger)" />
        <div style={{ fontSize: 14 }}>โหลดข้อมูลไม่สำเร็จ</div>
        <button
          onClick={() => refetch()}
          className="pressable"
          style={{ marginTop: 4, padding: '9px 18px', minHeight: 44, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  return (
    <div className="st-check" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI row */}
      <div ref={kpiRef} className="st-kpis" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard
          label="ช่วงเวลา"
          value={preview ? fmtDateTh(preview.periodStart) : '—'}
          sub={preview ? `ถึง ${fmtDateTh(preview.periodEnd)}` : undefined}
        />
        <KpiCard label="รายการที่ต้องนับ" value={String(items.length)} sub="รายการ" />
        <KpiCard label="รวมที่ใช้ไปในช่วงนี้" value={fmt3(totalConsumed)} sub="หน่วยรวม" />
      </div>

      {/* Refresh button */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={handleRefresh}
          className="pressable st-refresh"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            minHeight: 44,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-text)',
          }}
        >
          <Icon name="search" size={16} />
          เริ่มตรวจนับสต็อก (รีเฟรชข้อมูล)
        </button>
      </div>

      {/* Items table or empty */}
      {items.length === 0 ? (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: '48px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Icon name="info" size={32} color="var(--color-text-muted)" />
          <div style={{ marginTop: 12, fontSize: 15 }}>ไม่มีรายการในช่วงนี้</div>
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-muted)' }}>
            ยังไม่มีออเดอร์ที่ใช้วัตถุดิบในช่วงเวลานี้
          </div>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {/* Table header */}
          <div
            className="st-count-head"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 110px 110px 130px',
              gap: 8,
              padding: '10px 16px',
              background: 'var(--color-surface-2)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <span>วัตถุดิบ</span>
            <span style={{ textAlign: 'right' }}>ใช้ในช่วงนี้</span>
            <span style={{ textAlign: 'right' }}>ระบบ (คงเหลือ)</span>
            <span style={{ textAlign: 'right' }}>นับจริง</span>
          </div>

          {/* Rows */}
          {items.map((item, idx) => (
            <div
              key={item.inventoryItemId}
              className="st-count-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 110px 110px 130px',
                gap: 8,
                padding: '12px 16px',
                alignItems: 'center',
                borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <div className="st-c-name">
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{item.unit}</div>
              </div>
              <div className="st-c-used" data-label="ใช้ในช่วงนี้" style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {fmt3(item.consumedInPeriod)}
              </div>
              <div className="st-c-sys" data-label="ระบบ" style={{ textAlign: 'right', fontSize: 13 }}>
                {fmt3(item.systemQuantity)}
              </div>
              <div className="st-c-input" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <input
                  type="number"
                  inputMode="decimal"
                  enterKeyHint={idx === items.length - 1 ? 'done' : 'next'}
                  step="any"
                  min={0}
                  value={getActual(item)}
                  onChange={(e) =>
                    setActuals((prev) => ({ ...prev, [item.inventoryItemId]: e.target.value }))
                  }
                  // Phones: the field is pre-filled with the system figure, so select it
                  // on focus — the first digit typed replaces it instead of appending.
                  onFocus={isPhone ? (e) => e.currentTarget.select() : undefined}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (idx < items.length - 1) focusCount(idx + 1);
                    else e.currentTarget.blur();
                  }}
                  data-st-count={idx}
                  aria-label={`นับจริง ${item.name} (${item.unit})`}
                  className="st-count-input"
                  style={{
                    width: 110,
                    padding: '7px 10px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 14,
                    textAlign: 'right',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            หมายเหตุ (ไม่จำเป็น)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            placeholder="บันทึกเพิ่มเติม..."
            rows={3}
            style={{
              padding: '10px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              fontSize: 14,
              resize: 'vertical',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'right' }}>
            {notes.length}/500
          </div>
        </div>
      )}

      {/* Submit */}
      {items.length > 0 && (
        <div className="st-submit" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="pressable"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              minHeight: 44,
              background: submitMutation.isPending ? 'var(--color-surface-2)' : 'var(--color-primary)',
              color: submitMutation.isPending ? 'var(--color-text-muted)' : 'var(--color-text-inverse)',
              border: 'none',
              borderRadius: 10,
              cursor: submitMutation.isPending ? 'not-allowed' : 'pointer',
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            <Icon name="check" size={18} />
            {submitMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตรวจนับ'}
          </button>
        </div>
      )}

      {/* Result modal */}
      {resultModal !== null && (
        <ResultModal results={resultModal} onClose={() => setResultModal(null)} />
      )}
    </div>
  );
}

// ── Tab 2: History ────────────────────────────────────────────────────────────
function HistoryTab() {
  const { data: history, isLoading, isError } = useStockTakeHistory();
  const [expanded, setExpanded] = useState<number | null>(null);

  // History cards stagger in once loaded; one-shot, honors reduced-motion.
  const listRef = useStagger({ selector: ':scope > *', each: 0.04 });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} aria-busy="true">
        <span className="sr-only">กำลังโหลดประวัติ</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <Skeleton width={36} height={36} radius="var(--radius-pill)" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <Skeleton width="40%" height="var(--space-3)" />
              <Skeleton width="55%" height="var(--space-3)" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: 'var(--color-danger)' }}>
        <Icon name="warning" size={32} color="var(--color-danger)" />
        <div style={{ marginTop: 12, fontSize: 14 }}>โหลดประวัติไม่สำเร็จ</div>
      </div>
    );
  }

  const events: StockTakeEvent[] = [...(history ?? [])].reverse();

  if (events.length === 0) {
    return (
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '48px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          color: 'var(--color-text-secondary)',
        }}
      >
        <Icon name="list" size={32} color="var(--color-text-muted)" />
        <div style={{ marginTop: 12, fontSize: 15 }}>ยังไม่มีประวัติการตรวจนับ</div>
      </div>
    );
  }

  return (
    <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {events.map((event, idx) => {
        const isOpen = expanded === idx;
        return (
          <div
            key={idx}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {/* Event header */}
            <button
              onClick={() => setExpanded(isOpen ? null : idx)}
              aria-expanded={isOpen}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                minHeight: 44,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: 1 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'var(--color-accent-50)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name="check" size={18} color="var(--color-accent)" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtDateTh(event.conductedAt)}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    โดย {event.conductedBy} · {event.itemCount} รายการ
                  </div>
                </div>
              </div>
              <Icon name={isOpen ? 'x' : 'plus'} size={16} color="var(--color-text-secondary)" />
            </button>

            {/* Expanded details */}
            {isOpen && (
              <div className="st-history-body" style={{ borderTop: '1px solid var(--color-border)', padding: 16 }}>
                {/* Detail header */}
                <div
                  className="st-var-head"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 90px 90px',
                    gap: 8,
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    background: 'var(--color-surface-2)',
                    borderRadius: 6,
                    marginBottom: 6,
                  }}
                >
                  <span>วัตถุดิบ</span>
                  <span style={{ textAlign: 'right' }}>ระบบ</span>
                  <span style={{ textAlign: 'right' }}>จริง</span>
                  <span style={{ textAlign: 'right' }}>ส่วนต่าง</span>
                </div>

                {event.items.map((item, iidx) => (
                  <div
                    key={iidx}
                    className="st-var-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 90px 90px 90px',
                      gap: 8,
                      padding: '8px',
                      borderRadius: 6,
                      background: item.variance !== 0 ? varianceBg(item.variance) : 'transparent',
                      alignItems: 'center',
                    }}
                  >
                    <div className="st-v-name">
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--color-text-secondary)',
                          marginLeft: 6,
                        }}
                      >
                        {item.unit}
                      </span>
                    </div>
                    <div data-label="ระบบ" style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(item.systemQuantity)}</div>
                    <div data-label="จริง" style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(item.actualQuantity)}</div>
                    <div
                      className="st-v-diff"
                      style={{
                        textAlign: 'right',
                        fontSize: 13,
                        fontWeight: 700,
                        color: varianceColor(item.variance),
                      }}
                    >
                      {fmtVariance(item.variance)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function StockTakeScreen() {
  const [tab, setTab] = useState<'check' | 'history'>('check');

  const tabs = [
    { id: 'check' as const, label: 'ตรวจนับสต็อก', icon: 'check' },
    { id: 'history' as const, label: 'ประวัติ', icon: 'list' },
  ];

  return (
    <div
      className="st-root"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
      }}
    >
      <style>{ST_CSS}</style>
      {/* Header */}
      <div
        className="st-head"
        style={{
          padding: '20px 24px 0',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          flexShrink: 0,
        }}
      >
        <div className="st-head-title" style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Stock Take</div>
        <div className="st-tabs" style={{ display: 'flex', gap: 4 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: tab === t.id ? 700 : 400,
                color: tab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                borderRadius: '6px 6px 0 0',
                marginBottom: -1,
              }}
            >
              <Icon
                name={t.icon}
                size={15}
                color={tab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)'}
              />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="scroll screen-pad st-scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {tab === 'check' ? <StockCheckTab /> : <HistoryTab />}
      </div>
    </div>
  );
}
