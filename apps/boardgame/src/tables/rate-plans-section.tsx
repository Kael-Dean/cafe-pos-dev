'use client';

// Board-game edition: rate plans (time billing) on the core table setup screen.
// Moved verbatim out of core table-setup.tsx — plugged in through
// `EditionConfig.tables.SetupSection`.

import { useMemo, useState } from 'react';
import Icon from '@pos/core/components/icons';
import { Select, useToast, NumberInput } from '@pos/core/components/app-common';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { useBoardgameEnabled } from '@pos/core/hooks/use-features';
import { formatMinutes } from '@pos/core/lib/money';
import { Field, ModalShell, errMsg, inputStyle, planSummary } from '@pos/core/components/screens/table-session-modal';
import { Card, Chip, ErrorBox, SectionHead, Toggle, isMoney } from '@pos/core/components/screens/table-setup';
import {
  useCreateRatePlan, useRatePlans, useUpdateRatePlan, type BillingMode, type RatePlan,
} from '@/hooks/use-rate-plans';

export const MODE_LABEL: Record<BillingMode, string> = {
  PER_HEAD_HOUR: 'คิดต่อหัว ต่อชั่วโมง',
  PER_TABLE_HOUR: 'คิดต่อโต๊ะ ต่อชั่วโมง',
};

/**
 * Rendered by core TableSetup only after its own gates (table feature on, admin).
 * Rate plans additionally need the board-game entitlement: a store that only has
 * tables via `self_ordering` has no time billing, so the section stays hidden.
 */
export default function RatePlansSection() {
  const { enabled: boardgame } = useBoardgameEnabled();
  const plansQ = useRatePlans(boardgame);
  const [editPlan, setEditPlan] = useState<RatePlan | null>(null);
  const [newPlan, setNewPlan] = useState(false);
  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);

  if (!boardgame) return null;

  return (
    <>
      {/* ── Rate plans ─────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <SectionHead
          title="แพ็กเกจเวลา"
          hint="ต้องมีอย่างน้อย 1 แพ็กเกจถึงจะเปิดโต๊ะได้ · แก้ทีหลังไม่กระทบโต๊ะที่เปิดค้างอยู่"
          action={{ label: 'เพิ่มแพ็กเกจ', onClick: () => setNewPlan(true) }}
        />

        {plansQ.isLoading && <Skeleton height={120} radius="var(--radius-lg)" />}

        {!plansQ.isLoading && plans.length === 0 && (
          <Card>
            <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              ยังไม่มีแพ็กเกจเวลา — กด “เพิ่มแพ็กเกจ” เพื่อกำหนดราคาต่อชั่วโมง ช่วงผ่อนผัน และการปัดเวลา
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {plans.map((p) => (
            <Card key={p.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15, minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</strong>
                {p.isDefault && <Chip tone="primary">ค่าเริ่มต้น</Chip>}
                {!p.isActive && <Chip tone="muted">ปิดใช้งาน</Chip>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
                  <button onClick={() => setEditPlan(p)} className="btn btn-ghost" aria-label={`แก้ไข ${p.name}`}>
                    <Icon name="pencil" size={15} /> แก้ไข
                  </button>
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)', lineHeight: 1.6 }}>
                {MODE_LABEL[p.billingMode]} · {planSummary(p)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                เตือนเมื่อเปิดเกิน {formatMinutes(p.maxOpenMinutes)}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {(newPlan || editPlan) && (
        <RatePlanModal
          plan={editPlan}
          onClose={() => { setNewPlan(false); setEditPlan(null); }}
        />
      )}
    </>
  );
}

// ── Rate plan create / edit ───────────────────────────────────────────────────
function RatePlanModal({ plan, onClose }: { plan: RatePlan | null; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateRatePlan();
  const update = useUpdateRatePlan();

  const [name, setName] = useState(plan?.name ?? '');
  const [mode, setMode] = useState<BillingMode>(plan?.billingMode ?? 'PER_HEAD_HOUR');
  const [rate, setRate] = useState(plan?.hourlyRate ?? '');
  const [grace, setGrace] = useState(plan?.graceMinutes ?? 10);
  const [rounding, setRounding] = useState(plan?.roundingIncrementMinutes ?? 30);
  const [minCharge, setMinCharge] = useState(plan?.minChargeMinutes ?? 60);
  const [cap, setCap] = useState(plan?.dailyCapAmount ?? '');
  const [maxOpen, setMaxOpen] = useState(plan?.maxOpenMinutes ?? 720);
  const [isDefault, setIsDefault] = useState(plan?.isDefault ?? false);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const busy = create.isPending || update.isPending;
  const capValid = cap.trim() === '' || isMoney(cap);
  const valid = name.trim().length >= 1 && isMoney(rate, { allowZero: true }) && rounding >= 1 && grace >= 0
    && minCharge >= 0 && maxOpen >= 60 && capValid;

  const submit = async () => {
    if (busy || !valid) return;
    setError(null);
    const common = {
      name: name.trim(),
      hourly_rate: rate.trim(),
      grace_minutes: grace,
      rounding_increment_minutes: rounding,
      min_charge_minutes: minCharge,
      daily_cap_amount: cap.trim() ? cap.trim() : null,
      max_open_minutes: maxOpen,
      is_default: isDefault,
    };
    try {
      if (plan) {
        await update.mutateAsync({ id: plan.id, data: { ...common, is_active: isActive } });
        toast({ kind: 'success', title: 'บันทึกแพ็กเกจแล้ว', msg: 'โต๊ะที่เปิดค้างอยู่ยังใช้เงื่อนไขเดิม' });
      } else {
        await create.mutateAsync({ ...common, billing_mode: mode });
        toast({ kind: 'success', title: `เพิ่มแพ็กเกจ ${name.trim()} แล้ว` });
      }
      onClose();
    } catch (e: unknown) { setError(errMsg(e)); }
  };

  return (
    <ModalShell
      title={plan ? `แก้ไข ${plan.name}` : 'เพิ่มแพ็กเกจเวลา'}
      subtitle={plan ? 'การแก้ไขไม่กระทบโต๊ะที่เปิดค้างอยู่' : undefined}
      icon="clock"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost btn-lg" style={{ flex: 1, minHeight: 44 }}>ยกเลิก</button>
          <button onClick={() => { void submit(); }} disabled={busy || !valid} className="btn btn-primary btn-lg" style={{ flex: 2, minHeight: 44, opacity: busy || !valid ? 0.5 : 1 }}>
            {busy ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden /> : <><Icon name="check" size={16} /> บันทึก</>}
          </button>
        </>
      }
    >
      <Field label="ชื่อแพ็กเกจ">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="เช่น มาตรฐาน" aria-label="ชื่อแพ็กเกจ" style={inputStyle} />
      </Field>

      <Field label="วิธีคิดเงิน" hint={plan ? 'เปลี่ยนวิธีคิดเงินหลังสร้างแล้วไม่ได้ — ถ้าต้องเปลี่ยน ให้สร้างแพ็กเกจใหม่' : undefined}>
        <Select
          value={mode}
          onChange={(v) => setMode(v as BillingMode)}
          ariaLabel="วิธีคิดเงิน"
          disabled={!!plan}
          options={[
            { value: 'PER_HEAD_HOUR', label: MODE_LABEL.PER_HEAD_HOUR },
            { value: 'PER_TABLE_HOUR', label: MODE_LABEL.PER_TABLE_HOUR },
          ]}
        />
      </Field>

      <Field label="ราคาต่อชั่วโมง (฿)" hint="ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 40.00 · ใส่ 0 = ไม่คิดค่าเวลา (บิลโต๊ะแบบบาร์)">
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          placeholder="40.00"
          aria-label="ราคาต่อชั่วโมง"
          style={{ ...inputStyle, borderColor: rate && !isMoney(rate, { allowZero: true }) ? 'var(--color-danger)' : 'var(--color-border)' }}
        />
      </Field>

      <Field label="ช่วงผ่อนผัน (นาที)" hint="นั่งไม่เกินเวลานี้ ไม่คิดค่าเวลา">
        <NumberInput value={grace} onChange={setGrace} min={0} max={720} integer style={inputStyle} aria-label="ช่วงผ่อนผัน" />
      </Field>

      <Field label="ปัดเวลาขึ้นทีละ (นาที)" hint="อย่างน้อย 1 เช่น 30 = ปัดขึ้นเป็นครึ่งชั่วโมง">
        <NumberInput value={rounding} onChange={setRounding} min={1} max={240} integer style={inputStyle} aria-label="ปัดเวลาขึ้นทีละ" />
      </Field>

      <Field label="ขั้นต่ำ (นาที)" hint="คิดอย่างน้อยเท่านี้เสมอเมื่อพ้นช่วงผ่อนผัน">
        <NumberInput value={minCharge} onChange={setMinCharge} min={0} max={1440} integer style={inputStyle} aria-label="ขั้นต่ำ" />
      </Field>

      <Field label="เพดานต่อวัน (฿) — ไม่บังคับ" hint="เว้นว่าง = ไม่มีเพดาน">
        <input
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          inputMode="decimal"
          placeholder="เช่น 199.00"
          aria-label="เพดานต่อวัน"
          style={{ ...inputStyle, borderColor: !capValid ? 'var(--color-danger)' : 'var(--color-border)' }}
        />
      </Field>

      <Field label="เตือนเมื่อเปิดเกิน (นาที)" hint="อย่างน้อย 60 · ค่าเริ่มต้น 720 (12 ชม.)">
        <NumberInput value={maxOpen} onChange={setMaxOpen} min={60} max={4320} integer style={inputStyle} aria-label="เตือนเมื่อเปิดเกิน" />
      </Field>

      <Toggle checked={isDefault} onChange={setIsDefault} label="ตั้งเป็นแพ็กเกจค่าเริ่มต้น" hint="แพ็กเกจเดิมที่เป็นค่าเริ่มต้นจะถูกยกเลิกให้อัตโนมัติ" />

      {plan && (
        <Toggle checked={isActive} onChange={setIsActive} label="เปิดใช้งาน" hint="ปิดไว้ = เลือกไม่ได้ตอนเปิดโต๊ะใหม่ แต่โต๊ะที่ใช้อยู่ยังคิดเงินตามเดิม" />
      )}

      {error && <ErrorBox>{error}</ErrorBox>}
    </ModalShell>
  );
}
