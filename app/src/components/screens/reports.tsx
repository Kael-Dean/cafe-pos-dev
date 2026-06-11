'use client';

import { useState } from 'react';
import Icon from '../icons';
import { Tag, baht } from '../app-common';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useCountUp } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import {
  loadSalesReport,
  type ReportMode,
  type ReportRow,
  type SalesReportData,
} from '@/hooks/use-sales-report';

// ── Date helpers ──────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function thaiDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH-u-ca-buddhist', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}
const TODAY = ymd(new Date());
const MONTH_START = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

// ── Shared styles (match promotions.tsx / dashboard.tsx idioms) ─────────────────
const IS: React.CSSProperties = {
  minHeight: 44, padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14,
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const LB: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 'var(--space-1)' };

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', ...style,
    }}>{children}</div>
  );
}

function SummaryCard({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  // Prominent report figures count up on mount; useCountUp re-tweens when a new
  // report loads (parses the on-screen value, so it animates from the old total).
  const ref = useCountUp(value, { format });
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</div>
      <span ref={ref} className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{format(value)}</span>
    </div>
  );
}

/* Mirrors the results layout (summary row + table cards) so the swap from
   skeleton → data causes no jump. */
function ReportSkeleton({ rangeMode }: { rangeMode: boolean }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">กำลังเรียกรายงานยอดขาย…</span>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Skeleton height={24} width={220} radius="var(--radius-pill)" />
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${rangeMode ? 4 : 3}, 1fr)`,
        gap: 'var(--space-4)', marginBottom: 'var(--space-4)',
      }}>
        {Array.from({ length: rangeMode ? 4 : 3 }).map((_, i) => (
          <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <Skeleton height={13} width="55%" />
            <Skeleton height={26} width="70%" radius="var(--radius-md)" />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {Array.from({ length: rangeMode ? 3 : 2 }).map((_, i) => (
          <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
            <Skeleton height={15} width="30%" radius="var(--radius-sm)" style={{ marginBottom: 'var(--space-4)' }} />
            <SkeletonTable rows={5} cols={3} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportTable({ title, cols, rows, sub }: {
  title: string;
  cols: [string, string, string];
  rows: ReportRow[];
  sub?: string;
}) {
  const totalCount = rows.reduce((s, r) => s + r.orderCount, 0);
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-2)' }}>
              <th style={{ textAlign: 'left', padding: '8px 16px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{cols[0]}</th>
              <th style={{ textAlign: 'right', padding: '8px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{cols[1]}</th>
              <th style={{ textAlign: 'right', padding: '8px 16px', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{cols[2]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--color-text-muted)' }}>ไม่มีข้อมูลในช่วงที่เลือก</td></tr>
            ) : rows.map((r, i) => (
              <tr key={`${r.label}-${i}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '8px 16px' }}>{r.label}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right' }} className="num">{r.orderCount.toLocaleString()}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right' }} className="num">{baht(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--color-border-strong, var(--color-border))', fontWeight: 700 }}>
                <td style={{ padding: '8px 16px' }}>รวม</td>
                <td style={{ padding: '8px 16px', textAlign: 'right' }} className="num">{totalCount.toLocaleString()}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right' }} className="num">{baht(totalRev)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function Reports() {
  const { data: me } = useCurrentUser();
  const storeName = me?.store_name ?? 'Kafé OS';

  const [mode, setMode] = useState<ReportMode>('daily');
  const [day, setDay] = useState(TODAY);
  const [from, setFrom] = useState(MONTH_START);
  const [to, setTo] = useState(TODAY);

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SalesReportData | null>(null);

  async function runReport() {
    setError(null);
    if (mode === 'range' && from > to) {
      setError('วันเริ่มต้องไม่เกินวันสิ้นสุด');
      return;
    }
    setLoading(true);
    try {
      const result = await loadSalesReport({ mode, from: mode === 'daily' ? day : from, to });
      setData(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เรียกรายงานไม่สำเร็จ';
      setError(msg.includes('403') || /สิทธิ|permission|forbidden/i.test(msg)
        ? 'บัญชีนี้ไม่มีสิทธิ์ดูรายงาน (ต้องเป็นผู้จัดการหรือเจ้าของ)'
        : msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    if (!data) return;
    setDownloading(true);
    try {
      const { downloadSalesReportExcel } = await import('@/lib/sales-report-xlsx');
      await downloadSalesReportExcel(data, storeName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างไฟล์ Excel ไม่สำเร็จ');
    } finally {
      setDownloading(false);
    }
  }

  const periodText = data
    ? data.mode === 'daily'
      ? `รายวัน — ${thaiDate(data.from)}`
      : `ช่วงวันที่ ${thaiDate(data.from)} ถึง ${thaiDate(data.to)} (${data.dayCount} วัน)`
    : '';

  return (
    <div className="scroll" style={{ height: '100%', overflow: 'auto', padding: 'var(--space-6)', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2 }}>รายงาน</div>
        <h1 className="text-balance" style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>เรียกรายงานยอดขาย</h1>
        <div className="text-pretty" style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>เลือกวัน/ช่วงวันที่ แล้วดาวน์โหลดเป็น Excel (.xlsx)</div>
      </div>

      {/* Controls */}
      <Card style={{ marginBottom: 16 }}>
        {/* Mode toggle */}
        <div role="tablist" aria-label="ช่วงเวลารายงาน" style={{ display: 'inline-flex', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          {([['daily', 'รายวัน'], ['range', 'รายเดือน / ช่วงวันที่']] as [ReportMode, string][]).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              style={{
                minHeight: 44, padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                background: mode === m ? 'var(--color-surface)' : 'transparent',
                color: mode === m ? 'var(--color-text)' : 'var(--color-text-secondary)',
                boxShadow: mode === m ? 'var(--shadow-sm)' : 'none',
                transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Date inputs + actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          {mode === 'daily' ? (
            <>
              <div>
                <label style={LB}>วันที่</label>
                <input type="date" value={day} max={TODAY} onChange={(e) => setDay(e.target.value)} style={IS} />
              </div>
              <button className="btn btn-ghost" onClick={() => setDay(TODAY)}>วันนี้</button>
            </>
          ) : (
            <>
              <div>
                <label style={LB}>วันเริ่ม</label>
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={IS} />
              </div>
              <div>
                <label style={LB}>วันสิ้นสุด</label>
                <input type="date" value={to} max={TODAY} onChange={(e) => setTo(e.target.value)} style={IS} />
              </div>
            </>
          )}

          <button className="btn btn-primary" onClick={runReport} disabled={loading}>
            <Icon name="reports" size={14} /> {loading ? 'กำลังเรียก…' : 'เรียกรายงาน'}
          </button>
          <button className="btn btn-ghost" onClick={download} disabled={!data || downloading}>
            <Icon name="download" size={14} /> {downloading ? 'กำลังสร้าง…' : 'ดาวน์โหลด Excel'}
          </button>
        </div>

        {error && (
          <div role="alert" style={{
            marginTop: 'var(--space-4)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13,
            background: 'var(--color-danger-50)', color: 'var(--color-danger)',
            border: '1px solid var(--color-danger)',
          }}>{error}</div>
        )}
      </Card>

      {/* Loading — shaped skeleton mirroring the summary row + report tables */}
      {loading && <ReportSkeleton rangeMode={mode === 'range'} />}

      {/* Results */}
      {!loading && data && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Tag tone="accent">{periodText}</Tag>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${data.mode === 'range' ? 4 : 3}, 1fr)`,
            gap: 16, marginBottom: 16,
          }}>
            <SummaryCard label="ยอดขายรวม" value={data.totalRevenue} format={baht} />
            <SummaryCard label="จำนวนบิล" value={data.totalOrders} format={(n) => Math.round(n).toLocaleString()} />
            <SummaryCard label="ยอดเฉลี่ยต่อบิล" value={data.avgTicket} format={baht} />
            {data.mode === 'range' && <SummaryCard label="ยอดเฉลี่ยต่อวัน" value={data.avgPerDay} format={baht} />}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {data.mode === 'range' && (
              <ReportTable title="ยอดขายรายวัน" sub="แต่ละวันในช่วงที่เลือก" cols={['วันที่', 'จำนวนบิล', 'ยอดขาย']} rows={data.byDay} />
            )}
            <ReportTable title="แยกตามเมนู" sub="เรียงตามยอดขายมาก→น้อย" cols={['เมนู', 'จำนวน', 'ยอดขาย']} rows={data.byProduct} />
            <ReportTable title="แยกตามหมวดหมู่" cols={['หมวดหมู่', 'จำนวนบิล', 'ยอดขาย']} rows={data.byCategory} />
            <ReportTable title="แยกตามวิธีชำระเงิน" cols={['วิธีชำระเงิน', 'จำนวนบิล', 'ยอดขาย']} rows={data.byPayment} />
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <Card style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40 }}>
          เลือกวันหรือช่วงวันที่ แล้วกด “เรียกรายงาน” เพื่อดูสรุปยอดขาย
        </Card>
      )}
    </div>
  );
}
