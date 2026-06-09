'use client';

import { useMemo, useState } from 'react';
import Icon from '../icons';
import { useToast, baht } from '../app-common';
import { usePrinter } from '@/hooks/use-printer';
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

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>
        สำเนาใบเสร็จ
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        เรียกดูและพิมพ์สำเนาใบเสร็จย้อนหลังของทั้งวัน เพื่อนำไปตรวจสอบข้อมูล
      </p>

      {/* ── Controls ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap',
        marginBottom: 20,
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>วันที่</span>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={e => setDate(e.target.value)}
            style={{
              padding: '9px 12px', borderRadius: 10, fontSize: 14,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text)',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 24, padding: '6px 0' }}>
          <Stat label="จำนวนใบเสร็จ" value={String(summary.count)} />
          <Stat label="ยอดรวม" value={baht(summary.revenue)} />
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setConfirmAll(true)}
          disabled={!orders || orders.length === 0 || printingAll}
          style={{
            padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 8,
            background: (!orders || orders.length === 0 || printingAll) ? 'var(--color-border)' : 'var(--color-primary)',
            color: 'white',
            opacity: (!orders || orders.length === 0 || printingAll) ? 0.6 : 1,
            cursor: (!orders || orders.length === 0 || printingAll) ? 'default' : 'pointer',
          }}
        >
          <Icon name="printer" size={16} />
          {printingAll ? 'กำลังพิมพ์...' : 'พิมพ์ทั้งหมด'}
        </button>
      </div>

      {/* ── List ── */}
      {isLoading ? (
        <div style={{ padding: 40, color: 'var(--color-text-secondary)' }}>กำลังโหลด...</div>
      ) : isError ? (
        <div style={{ padding: 40, color: 'var(--color-danger)' }}>
          โหลดข้อมูลไม่สำเร็จ: {String(error instanceof Error ? error.message : error)}
        </div>
      ) : !orders || orders.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center', color: 'var(--color-text-secondary)',
          border: '1px dashed var(--color-border)', borderRadius: 12,
        }}>
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
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>#{o.order_number}</div>
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
        <div
          onClick={() => setConfirmAll(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 320,
            background: 'rgba(20, 12, 6, 0.55)', backdropFilter: 'blur(4px)',
            display: 'grid', placeItems: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 380, background: 'var(--color-surface)',
              borderRadius: 16, padding: 24, boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>
              พิมพ์สำเนาทั้งหมด?
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              จะพิมพ์สำเนาใบเสร็จ {summary.count} ใบเรียงต่อกัน ใช้กระดาษพอสมควร —
              แน่ใจหรือไม่?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmAll(false)}
                style={{ padding: '9px 16px', borderRadius: 9, fontSize: 13, color: 'var(--color-text-secondary)' }}
              >
                ยกเลิก
              </button>
              <button
                onClick={() => void printAll()}
                style={{
                  padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700,
                  background: 'var(--color-primary)', color: 'white',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Icon name="printer" size={14} /> พิมพ์ทั้งหมด
              </button>
            </div>
          </div>
        </div>
      )}
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
