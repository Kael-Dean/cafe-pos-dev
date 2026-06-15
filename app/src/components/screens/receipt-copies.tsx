'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useFadeRise } from '@/lib/motion';
import { useToast, baht } from '../app-common';
import { usePrinter } from '@/hooks/use-printer';
import { displayOrderNo } from '@/hooks/use-orders';
import ReceiptModal from './receipt-modal';
import {
  useReceiptCopies,
  mapOrderToReceipt,
  mapOrderToPrintArgs,
  paymentLabel,
  type OrderFull,
} from '@/hooks/use-receipt-copies';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export default function ReceiptCopies() {
  const toast = useToast();
  const { printReceipt } = usePrinter();

  const [date, setDate] = useState(todayISO());
  const [selected, setSelected] = useState<OrderFull | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [printingAll, setPrintingAll] = useState(false);

  const { data: orders, isLoading, isError, error } = useReceiptCopies(date);
  const rootRef = useFadeRise({ y: 8, duration: 0.22 });

  const summary = useMemo(() => {
    const list = orders ?? [];
    const revenue = list.reduce((sum, o) => sum + Number(o.total), 0);
    return { count: list.length, revenue };
  }, [orders]);

  const printAll = async () => {
    setConfirmAll(false);
    if (!orders || orders.length === 0) return;
    setPrintingAll(true);
    let done = 0;
    try {
      for (const o of orders) {
        await printReceipt(mapOrderToPrintArgs(o));
        done += 1;
      }
      toast({ kind: 'success', title: 'พิมพ์สำเนาครบแล้ว', msg: `${done} ใบ` });
    } catch (e: unknown) {
      toast({
        kind: 'danger',
        title: `พิมพ์ไม่สำเร็จ (พิมพ์ไปแล้ว ${done}/${orders.length} ใบ)`,
        msg: String(e instanceof Error ? e.message : e),
      });
    } finally {
      setPrintingAll(false);
    }
  };

  const disabledPrint = !orders || orders.length === 0 || printingAll;

  return (
    <div ref={rootRef} style={{ padding: 'var(--space-8)', maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-text)' }}>
        สำเนาใบเสร็จ
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
        เรียกดูและพิมพ์สำเนาใบเสร็จย้อนหลังของทั้งวัน เพื่อนำไปตรวจสอบข้อมูล
      </p>

      {/* ── Controls ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)', flexWrap: 'wrap',
        marginBottom: 'var(--space-5)',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>วันที่</span>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={e => setDate(e.target.value)}
            className="input-std"
            style={{
              padding: '9px var(--space-3)', minHeight: 40, borderRadius: 'var(--radius-md)', fontSize: 14,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text)',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 'var(--space-6)', padding: 'var(--space-2) 0' }}>
          <Stat label="จำนวนใบเสร็จ" value={String(summary.count)} />
          <Stat label="ยอดรวม" value={baht(summary.revenue)} />
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setConfirmAll(true)}
          disabled={disabledPrint}
          className="pressable"
          style={{
            padding: '10px var(--space-5)', minHeight: 44, borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            background: disabledPrint ? 'var(--color-border)' : 'var(--color-primary)',
            color: disabledPrint ? 'var(--color-text-muted)' : 'var(--color-text-inverse)',
            opacity: disabledPrint ? 0.6 : 1,
            cursor: disabledPrint ? 'default' : 'pointer',
          }}
        >
          {printingAll
            ? <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} />
            : <Icon name="printer" size={16} />}
          {printingAll ? 'กำลังพิมพ์...' : 'พิมพ์ทั้งหมด'}
        </button>
      </div>

      {/* ── List ── */}
      {isLoading ? (
        <ReceiptListSkeleton />
      ) : isError ? (
        <div role="alert" style={{
          padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', color: 'var(--color-danger)',
          background: 'var(--color-danger-50)', border: '1px solid var(--color-danger)', fontSize: 13,
        }}>
          โหลดข้อมูลไม่สำเร็จ: {String(error instanceof Error ? error.message : error)}
        </div>
      ) : !orders || orders.length === 0 ? (
        <div style={{
          padding: 'var(--space-12)', textAlign: 'center', color: 'var(--color-text-secondary)',
          border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-2)', color: 'var(--color-text-muted)', display: 'grid', placeItems: 'center' }}>
            <Icon name="printer" size={22} />
          </div>
          ไม่มีใบเสร็จในวันที่เลือก
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden',
          background: 'var(--color-surface)',
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '90px 80px 1fr 130px 120px',
            gap: 12, padding: '12px 16px', fontSize: 12, fontWeight: 700,
            color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface-2)',
          }}>
            <div>ออเดอร์</div>
            <div>เวลา</div>
            <div>รายการ</div>
            <div style={{ textAlign: 'right' }}>ยอดรวม</div>
            <div>วิธีจ่าย</div>
          </div>
          {orders.map(o => {
            const itemCount = o.items.reduce((n, it) => n + it.quantity, 0);
            const preview = o.items.map(it => it.product_name).join(', ');
            return (
              <button
                key={o.id}
                onClick={() => setSelected(o)}
                style={{
                  display: 'grid', gridTemplateColumns: '90px 80px 1fr 130px 120px',
                  gap: 12, padding: '12px 16px', width: '100%', textAlign: 'left',
                  alignItems: 'center', fontSize: 13, color: 'var(--color-text)',
                  borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
                  background: 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>#{displayOrderNo(o)}</div>
                <div style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(o.created_at)}</div>
                <div style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {preview} <span style={{ opacity: 0.6 }}>({itemCount})</span>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{baht(Number(o.total))}</div>
                <div style={{ color: 'var(--color-text-secondary)' }}>{paymentLabel(o.payment_method)}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Receipt copy preview ── */}
      {selected && (
        <ReceiptModal
          key={selected.id}
          data={mapOrderToReceipt(selected)}
          issuedAt={new Date(selected.created_at)}
          copy
          onClose={() => setSelected(null)}
          onPrint={async () => {
            try {
              await printReceipt(mapOrderToPrintArgs(selected));
              toast({ kind: 'success', title: 'พิมพ์สำเนาแล้ว', msg: `ออเดอร์ #${selected.order_number}` });
            } catch (e: unknown) {
              toast({ kind: 'danger', title: 'พิมพ์ไม่สำเร็จ', msg: String(e instanceof Error ? e.message : e) });
            }
          }}
        />
      )}

      {/* ── Print-all confirm ── */}
      {confirmAll && (
        <ConfirmPrintAll
          count={summary.count}
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => void printAll()}
        />
      )}
    </div>
  );
}

/** Skeleton mirroring the order table (header row + several order rows). */
function ReceiptListSkeleton() {
  const cols = '90px 80px 1fr 130px 120px';
  return (
    <div
      aria-busy="true"
      style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-surface)' }}
    >
      <span className="sr-only">กำลังโหลดสำเนาใบเสร็จ</span>
      <div style={{
        display: 'grid', gridTemplateColumns: cols, gap: 'var(--space-3)', padding: '12px var(--space-4)',
        borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
      }}>
        {Array.from({ length: 5 }).map((_, c) => <Skeleton key={c} width="60%" height="var(--space-3)" />)}
      </div>
      {Array.from({ length: 7 }).map((_, r) => (
        <div key={r} style={{
          display: 'grid', gridTemplateColumns: cols, gap: 'var(--space-3)', padding: '14px var(--space-4)',
          alignItems: 'center', borderBottom: '1px solid var(--color-border)',
        }}>
          <Skeleton width="70%" height="var(--space-3)" />
          <Skeleton width="60%" height="var(--space-3)" />
          <Skeleton width="85%" height="var(--space-3)" />
          <Skeleton width="50%" height="var(--space-3)" style={{ justifySelf: 'end' }} />
          <Skeleton width="55%" height="var(--space-3)" />
        </div>
      ))}
    </div>
  );
}

/**
 * Confirm "print all" — a centered dialog reusing the app's .modal-backdrop /
 * .modal-card surface, with Esc-to-close, focus trap and focus restore so it
 * matches the keyboard behaviour of the other modals.
 */
function ConfirmPrintAll({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
        .filter(el => el.offsetParent !== null);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" style={{ zIndex: 320 }} onClick={onCancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="ยืนยันพิมพ์สำเนาทั้งหมด"
        className="modal-card"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 380, padding: 'var(--space-6)' }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-text)' }}>
          พิมพ์สำเนาทั้งหมด?
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-5)', lineHeight: 1.6 }}>
          จะพิมพ์สำเนาใบเสร็จ {count} ใบเรียงต่อกัน ใช้กระดาษพอสมควร แน่ใจหรือไม่?
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            className="pressable"
            style={{ padding: '9px var(--space-4)', minHeight: 44, borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--color-text-secondary)' }}
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            className="pressable"
            style={{
              padding: '9px var(--space-5)', minHeight: 44, borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 700,
              background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}
          >
            <Icon name="printer" size={14} /> พิมพ์ทั้งหมด
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
