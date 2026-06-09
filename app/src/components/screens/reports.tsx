'use client';

import { useState } from 'react';
import Icon from '../icons';
import { Tag, baht } from '../app-common';
import { useCurrentUser } from '@/hooks/use-current-user';
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
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14,
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const LB: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 };

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 20, ...style,
    }}>{children}</div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</div>
      <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
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
    <div className="scroll" style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2 }}>รายงาน</div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>เรียกรายงานยอดขาย</h1>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4 }}>เลือกวัน/ช่วงวันที่ แล้วดาวน์โหลดเป็น Excel (.xlsx)</div>
      </div>

      {/* Controls */}
      <Card style={{ marginBottom: 16 }}>
        {/* Mode toggle */}
        <div style={{ display: 'inline-flex', background: 'var(--color-surface-2)', borderRadius: 10, padding: 4, marginBottom: 16 }}>
          {([['daily', 'รายวัน'], ['range', 'รายเดือน / ช่วงวันที่']] as [ReportMode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                background: mode === m ? 'var(--color-surface)' : 'transparent',
                color: mode === m ? 'var(--color-text)' : 'var(--color-text-secondary)',
                boxShadow: mode === m ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.08))' : 'none',
                transition: 'all 150ms',
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
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: 'var(--color-danger-50)', color: 'var(--color-danger)',
            border: '1px solid var(--color-danger-50)',
          }}>{error}</div>
        )}
      </Card>

      {/* Results */}
      {data && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Tag tone="accent">{periodText}</Tag>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${data.mode === 'range' ? 4 : 3}, 1fr)`,
            gap: 16, marginBottom: 16,
          }}>
            <SummaryCard label="ยอดขายรวม" value={baht(data.totalRevenue)} />
            <SummaryCard label="จำนวนบิล" value={data.totalOrders.toLocaleString()} />
            <SummaryCard label="ยอดเฉลี่ยต่อบิล" value={baht(data.avgTicket)} />
            {data.mode === 'range' && <SummaryCard label="ยอดเฉลี่ยต่อวัน" value={baht(data.avgPerDay)} />}
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
