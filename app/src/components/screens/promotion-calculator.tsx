'use client';

import { useMemo, useState } from 'react';
import Icon from '../icons';
import { Tag, baht, Select, NumberInput } from '../app-common';
import { useCountUp } from '@/lib/motion';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { useAllProducts } from '@/hooks/use-products';
import { useProductDetail } from '@/hooks/use-bom';
import { usePromotionBaseline } from '@/hooks/use-promotions';

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  fontSize: 14, background: 'var(--color-surface-2)', color: 'var(--color-text)', boxSizing: 'border-box',
};

type RecCode = 'no_cost_data' | 'below_cost' | 'high_risk' | 'moderate_risk' | 'viable';

const REC: Record<RecCode, { tone: 'neutral' | 'danger' | 'warning' | 'success'; text: string }> = {
  no_cost_data:  { tone: 'neutral', text: 'ยังไม่มีสูตร (BOM) — เพิ่มต้นทุนวัตถุดิบเพื่อวิเคราะห์ได้แม่นยำ' },
  below_cost:    { tone: 'danger',  text: 'ขายต่ำกว่าทุน — ขาดทุนทุกชิ้นไม่ว่าจะขายได้มากแค่ไหน' },
  high_risk:     { tone: 'danger',  text: 'ต้องขายเพิ่มกว่า 50% เพื่อคุ้มทุน เหมาะเฉพาะเมื่อมีตัวดึงทราฟฟิกใหญ่' },
  moderate_risk: { tone: 'warning', text: 'ทำได้ถ้าจับคู่กับการอัปเซลหรือช่วงพีค (happy hour / โปรสุดสัปดาห์)' },
  viable:        { tone: 'success', text: 'คุ้มทุนง่าย ปลอดภัยพอที่จะรันเป็นโปรประจำได้' },
};

const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtNum = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

function MetricCard({ label, value, sub, highlight, countTo, format }: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'accent' | 'danger' | 'success';
  /** When provided, the headline tweens to this number (reduced-motion safe). */
  countTo?: number;
  format?: (n: number) => string;
}) {
  const color = highlight === 'danger' ? 'var(--color-danger)' : highlight === 'success' ? 'var(--color-success)' : highlight === 'accent' ? 'var(--color-accent-600)' : 'var(--color-text)';
  // Count-up only when a numeric target is supplied; otherwise render the string as-is.
  const countRef = useCountUp(countTo ?? 0, format ? { format } : undefined);
  return (
    <div style={{ flex: 1, minWidth: 130, background: 'var(--color-surface-2)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
        {countTo != null ? <span ref={countRef}>{value}</span> : value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function PromotionCalculator() {
  const { data: products = [], isLoading: prodLoading } = useAllProducts();
  const [productId, setProductId] = useState<string>('');
  const [days, setDays] = useState(30);
  const [discountPct, setDiscountPct] = useState(10);

  const { data: detail, isLoading: detailLoading } = useProductDetail(productId || null);
  const { data: baseline, isLoading: baselineLoading } = usePromotionBaseline(productId || null, days);

  const calc = useMemo(() => {
    if (!detail) return null;
    const sellingPrice = detail.price;
    const servings = detail.servingsPerBatch || 1;
    const batchCost = detail.recipe.reduce((s, r) => s + r.qty * (r.costPerUnit ?? 0), 0);
    const cogsPerUnit = batchCost / servings;

    const pct = Math.min(Math.max(discountPct, 0), 99);
    const discountedPrice = sellingPrice * (1 - pct / 100);
    const originalContribution = sellingPrice - cogsPerUnit;
    const discountedContribution = discountedPrice - cogsPerUnit;
    const originalMarginPct = sellingPrice > 0 ? (originalContribution / sellingPrice) * 100 : 0;
    const discountedMarginPct = discountedPrice > 0 ? (discountedContribution / discountedPrice) * 100 : 0;

    const avgPerWeek = baseline ? Number(baseline.avg_units_per_week) : 0;
    const belowCost = discountedPrice <= cogsPerUnit;
    const requiredLiftPct = (!belowCost && discountedContribution > 0)
      ? (originalContribution / discountedContribution - 1) * 100
      : null;
    const breakEvenUnitsPerWeek = requiredLiftPct !== null ? avgPerWeek * (1 + requiredLiftPct / 100) : null;

    let rec: RecCode;
    if (cogsPerUnit === 0) rec = 'no_cost_data';
    else if (belowCost) rec = 'below_cost';
    else if ((requiredLiftPct ?? 0) > 50) rec = 'high_risk';
    else if ((requiredLiftPct ?? 0) > 20) rec = 'moderate_risk';
    else rec = 'viable';

    return {
      sellingPrice, cogsPerUnit, discountedPrice, originalMarginPct, discountedMarginPct,
      avgPerWeek, belowCost, requiredLiftPct, breakEvenUnitsPerWeek, rec,
      hasSales: avgPerWeek > 0,
    };
  }, [detail, baseline, discountPct]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
        วิเคราะห์ผลกระทบต่อกำไรและยอดขายที่ต้องเพิ่มเพื่อคุ้มทุน ก่อนเปิดใช้ส่วนลดจริง
      </div>

      {/* Inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 }}>
        <div>
          <label style={labelStyle}>สินค้า</label>
          <Select
            value={productId}
            onChange={setProductId}
            disabled={prodLoading}
            placeholder={prodLoading ? 'กำลังโหลด...' : '— เลือกสินค้า —'}
            ariaLabel="สินค้า"
            options={products.map(p => ({ value: p.id, label: p.name }))}
          />
        </div>
        <div>
          <label style={labelStyle}>ส่วนลด (%)</label>
          <NumberInput min={0} max={99} integer value={discountPct}
            onChange={setDiscountPct}
            style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>ช่วงข้อมูล (วัน)</label>
          <NumberInput min={1} max={365} integer value={days}
            onChange={setDays}
            style={inputStyle} />
        </div>
      </div>

      {!productId ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 50, color: 'var(--color-text-muted)' }}>
          <Icon name="discount" size={36} color="var(--color-border)" />
          <div style={{ marginTop: 12, fontSize: 14 }}>เลือกสินค้าเพื่อเริ่มวิเคราะห์</div>
        </div>
      ) : detailLoading || !calc ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }} aria-busy="true">
          <span className="sr-only">กำลังโหลดข้อมูลสินค้า</span>
          {/* Recommendation badge placeholder */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
            <Skeleton width={64} height={24} radius="var(--radius-pill)" />
            <Skeleton width="55%" height="var(--space-4)" />
          </div>
          {/* Metric cards placeholder */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} lines={1} style={{ flex: 1, minWidth: 130, background: 'var(--color-surface-2)', border: 'none', borderRadius: 10, padding: '14px 16px', gap: 'var(--space-3)' }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Recommendation badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
            <Tag tone={REC[calc.rec].tone}>{
              calc.rec === 'viable' ? 'แนะนำ' : calc.rec === 'moderate_risk' ? 'ระวัง' : calc.rec === 'no_cost_data' ? 'ข้อมูลไม่พอ' : 'เสี่ยง'
            }</Tag>
            <div style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500 }}>{REC[calc.rec].text}</div>
          </div>

          {/* Margin cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <MetricCard label="ราคาขาย" value={baht(calc.sellingPrice)} />
            <MetricCard label="ต้นทุน/หน่วย" value={calc.cogsPerUnit > 0 ? baht(calc.cogsPerUnit) : '—'}
              sub={calc.cogsPerUnit === 0 ? 'ไม่มีสูตร (BOM)' : undefined} />
            <MetricCard label="กำไรขั้นต้นเดิม" value={fmtPct(calc.originalMarginPct)}
              countTo={calc.originalMarginPct} format={fmtPct} highlight="accent" />
            <MetricCard label={`ราคาหลังลด ${discountPct}%`} value={baht(calc.discountedPrice)}
              countTo={calc.discountedPrice} format={baht} />
            <MetricCard label="กำไรหลังลด"
              value={calc.belowCost ? 'ขาดทุน' : fmtPct(calc.discountedMarginPct)}
              countTo={calc.belowCost ? undefined : calc.discountedMarginPct} format={fmtPct}
              highlight={calc.belowCost ? 'danger' : calc.discountedMarginPct < 0 ? 'danger' : 'success'} />
          </div>

          {/* Break-even section (hidden when below cost) */}
          {!calc.belowCost && calc.cogsPerUnit > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>จุดคุ้มทุน (Break-even)</div>
              {!calc.hasSales ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>ไม่มีข้อมูลยอดขายในช่วงเวลานี้</div>
              ) : (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <MetricCard label="ยอดขายเฉลี่ยปัจจุบัน" value={`${fmtNum(calc.avgPerWeek)} /สัปดาห์`} />
                  <MetricCard label="ต้องขายเพิ่ม"
                    value={calc.requiredLiftPct !== null ? `+${fmtPct(calc.requiredLiftPct)}` : '—'}
                    highlight={(calc.requiredLiftPct ?? 0) > 50 ? 'danger' : (calc.requiredLiftPct ?? 0) > 20 ? 'accent' : 'success'} />
                  <MetricCard label="ยอดที่ต้องขายให้คุ้มทุน"
                    value={calc.breakEvenUnitsPerWeek !== null ? `${fmtNum(calc.breakEvenUnitsPerWeek)} /สัปดาห์` : '—'} />
                </div>
              )}
            </div>
          )}

          {baselineLoading && (
            <div aria-busy="true">
              <span className="sr-only">กำลังโหลดข้อมูลยอดขาย</span>
              <Skeleton width={180} height="var(--space-3)" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
