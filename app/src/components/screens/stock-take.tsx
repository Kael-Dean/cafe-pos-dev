'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useStagger } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
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
  <div className="modal-backdrop" style={{ alignItems: 'center', padding: 'var(--space-5)' }} onClick={onClose}>
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
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{r.unit}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(r.systemQuantity)}</div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(r.actualQuantity)}</div>
            <div
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI row */}
      <div ref={kpiRef} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
          className="pressable"
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
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 110px 110px 130px',
                gap: 8,
                padding: '12px 16px',
                alignItems: 'center',
                borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{item.unit}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {fmt3(item.consumedInPeriod)}
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                {fmt3(item.systemQuantity)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={getActual(item)}
                  onChange={(e) =>
                    setActuals((prev) => ({ ...prev, [item.inventoryItemId]: e.target.value }))
                  }
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
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
              <div style={{ borderTop: '1px solid var(--color-border)', padding: 16 }}>
                {/* Detail header */}
                <div
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
                    <div>
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
                    <div style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(item.systemQuantity)}</div>
                    <div style={{ textAlign: 'right', fontSize: 13 }}>{fmt3(item.actualQuantity)}</div>
                    <div
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
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 0',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Stock Take</div>
        <div style={{ display: 'flex', gap: 4 }}>
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
      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {tab === 'check' ? <StockCheckTab /> : <HistoryTab />}
      </div>
    </div>
  );
}
