'use client';

import Icon from '../icons';
import { useToast } from '../app-common';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { BAR_TAB_PLAN, isZeroMoney, useCreateBarTabPlan, useDefaultRatePlan } from '@pos/core/hooks/use-bar-tab-plan';
import { bahtStr } from '@pos/core/lib/money';

/**
 * Table setup section for `self_ordering` stores on an edition without time
 * billing (café edition). Guests cannot open a tab until the store has a default
 * rate plan (join answers 409), so this offers the one-tap ฿0 "Bar tab" plan
 * from the handoff and shows which default is in effect.
 */
export default function BarTabPlanSection() {
  const toast = useToast();
  const planQ = useDefaultRatePlan();
  const create = useCreateBarTabPlan();
  const plan = planQ.data?.defaultPlan ?? null;

  const make = async () => {
    try {
      await create.mutateAsync();
      toast({ kind: 'success', title: 'สร้างแพ็กเกจ “Bar tab” ฿0 แล้ว', msg: 'ลูกค้าสแกน QR เปิดโต๊ะได้แล้ว' });
    } catch (e) {
      toast({ kind: 'danger', title: 'สร้างแพ็กเกจไม่สำเร็จ', msg: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <section style={{ marginBottom: 'var(--space-8)' }} aria-labelledby="bar-tab-plan-title">
      <h2 id="bar-tab-plan-title" style={{ fontSize: 16, fontWeight: 700, margin: '0 0 var(--space-2)' }}>บิลโต๊ะ (ไม่คิดค่าเวลา)</h2>
      {planQ.isLoading && <Skeleton height={72} radius="var(--radius-lg)" />}
      {planQ.isError && (
        <div role="alert" style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)', color: 'var(--color-danger-fg)', fontSize: 13, fontWeight: 600 }}>
          โหลดแพ็กเกจไม่ได้ — {planQ.error instanceof Error ? planQ.error.message : ''}
        </div>
      )}
      {planQ.data && plan && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)' }}>
          <Icon name="check" size={18} style={{ color: 'var(--color-success)' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>แพ็กเกจเริ่มต้น: {plan.name}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {isZeroMoney(plan.hourly_rate) ? 'ไม่คิดค่าเวลา — ลูกค้าจ่ายเฉพาะที่สั่ง' : `คิดค่าเวลา ${bahtStr(plan.hourly_rate)} ต่อชั่วโมง`}
            </div>
          </div>
        </div>
      )}
      {planQ.data && !plan && (
        <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-warning-50)', color: 'var(--color-warning-fg)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240, fontSize: 14, lineHeight: 1.55 }}>
            <strong style={{ display: 'block' }}>ยังไม่มีแพ็กเกจเริ่มต้น — ลูกค้าสแกน QR แล้วจะเปิดโต๊ะไม่ได้</strong>
            สร้างแพ็กเกจ “{BAR_TAB_PLAN.name}” ราคา ฿0 ไว้เป็นค่าเริ่มต้น (ไม่คิดค่าเวลา)
          </div>
          <button className="btn btn-primary tap-std" onClick={() => { void make(); }} disabled={create.isPending}>
            {create.isPending ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden /> : <><Icon name="plus" size={16} /> สร้าง Bar tab ฿0</>}
          </button>
        </div>
      )}
    </section>
  );
}
