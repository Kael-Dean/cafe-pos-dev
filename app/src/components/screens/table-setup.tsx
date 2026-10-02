'use client';

import { useMemo, useState } from 'react';
import Icon from '../icons';
import { Select, useToast, NumberInput } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useFadeRise } from '@/lib/motion';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoardgameEnabled } from '@/hooks/use-features';
import {
  useCreateTable, useDeleteTable, useFloorTables, useUpdateTable, type FloorTable,
} from '@/hooks/use-floor';
import {
  useCreateRatePlan, useRatePlans, useUpdateRatePlan, type BillingMode, type RatePlan,
} from '@/hooks/use-rate-plans';
import { formatMinutes } from '@/lib/money';
import { Field, ModalShell, errMsg, inputStyle, planSummary } from './table-session-modal';

const MODE_LABEL: Record<BillingMode, string> = {
  PER_HEAD_HOUR: 'คิดต่อหัว ต่อชั่วโมง',
  PER_TABLE_HOUR: 'คิดต่อโต๊ะ ต่อชั่วโมง',
};

/** Decimal string with at most 2 places, greater than zero — mirrors the API rule. */
function isMoney(s: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) > 0;
}

export default function TableSetup() {
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);
  const { enabled: boardgame, isLoading: featureLoading } = useBoardgameEnabled();
  const contentRef = useFadeRise();

  const [showInactive, setShowInactive] = useState(false);
  const tablesQ = useFloorTables(showInactive, boardgame && admin);
  const plansQ = useRatePlans(boardgame && admin);

  const [editTable, setEditTable] = useState<FloorTable | null>(null);
  const [newTable, setNewTable] = useState(false);
  const [editPlan, setEditPlan] = useState<RatePlan | null>(null);
  const [newPlan, setNewPlan] = useState(false);

  const tables = useMemo(() => tablesQ.data ?? [], [tablesQ.data]);
  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);

  if (featureLoading) {
    return (
      <div className="screen-pad-lg" style={{ padding: 'var(--space-8)', maxWidth: 900, margin: '0 auto' }} aria-busy="true">
        <span className="sr-only">กำลังโหลด…</span>
        <Skeleton height={28} width={240} radius="var(--radius-md)" style={{ marginBottom: 'var(--space-6)' }} />
        <Skeleton height={200} radius="var(--radius-lg)" />
      </div>
    );
  }

  if (!boardgame) {
    return <Notice icon="info" title="ร้านนี้ยังไม่ได้เปิดใช้ระบบโต๊ะ" body="แพ็กเกจบอร์ดเกมยังไม่ได้เปิดให้ร้านนี้ — ติดต่อผู้ดูแลระบบ" />;
  }
  if (!admin) {
    return <Notice icon="warning" title="เฉพาะผู้จัดการและเจ้าของร้าน" body="การตั้งค่าโต๊ะและแพ็กเกจเวลาทำได้เฉพาะระดับผู้จัดการขึ้นไป" />;
  }

  return (
    <div ref={contentRef} className="screen-pad-lg" style={{ padding: 'var(--space-8)', maxWidth: 900, margin: '0 auto' }}>
      <h1 className="text-balance max-md:flex max-md:items-center" style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-6)', color: 'var(--color-text)' }}>
        <Icon name="settings" size={20} style={{ marginRight: 8 }} />
        ตั้งค่าโต๊ะ & ค่าเวลา
      </h1>

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

      {/* ── Tables ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHead
          title="โต๊ะ"
          hint="ปิดใช้งานโต๊ะได้ ประวัติยังอยู่ครบ · โต๊ะที่มีคนนั่งอยู่ปิดไม่ได้"
          action={{ label: 'เพิ่มโต๊ะ', onClick: () => setNewTable(true) }}
        />

        <label className="max-md:min-h-[44px]" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 'var(--space-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          แสดงโต๊ะที่ปิดใช้งานแล้ว
        </label>

        {tablesQ.isLoading && <Skeleton height={160} radius="var(--radius-lg)" />}

        {!tablesQ.isLoading && tables.length === 0 && (
          <Card>
            <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>ยังไม่มีโต๊ะ — กด “เพิ่มโต๊ะ” เพื่อสร้างโต๊ะแรก</div>
          </Card>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {tables.map((t) => (
            <Card key={t.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15, minWidth: 60 }}>{t.name}</strong>
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.zone?.trim() || 'ไม่ระบุโซน'}</span>
                <span className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.capacity} ที่</span>
                {!t.isActive && <Chip tone="muted">ปิดใช้งาน</Chip>}
                <span style={{ marginLeft: 'auto' }}>
                  <button onClick={() => setEditTable(t)} className="btn btn-ghost" aria-label={`แก้ไขโต๊ะ ${t.name}`}>
                    <Icon name="pencil" size={15} /> แก้ไข
                  </button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {(newTable || editTable) && (
        <TableModal
          table={editTable}
          onClose={() => { setNewTable(false); setEditTable(null); }}
        />
      )}

      {(newPlan || editPlan) && (
        <RatePlanModal
          plan={editPlan}
          onClose={() => { setNewPlan(false); setEditPlan(null); }}
        />
      )}
    </div>
  );
}

// ── Table create / edit ───────────────────────────────────────────────────────
function TableModal({ table, onClose }: { table: FloorTable | null; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateTable();
  const update = useUpdateTable();
  const remove = useDeleteTable();

  const [name, setName] = useState(table?.name ?? '');
  const [zone, setZone] = useState(table?.zone ?? '');
  const [capacity, setCapacity] = useState(table?.capacity ?? 4);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending;
  const valid = name.trim().length >= 1 && name.trim().length <= 60 && capacity >= 1 && capacity <= 100;

  const submit = async () => {
    if (busy || !valid) return;
    setError(null);
    try {
      if (table) {
        await update.mutateAsync({ id: table.id, data: { name: name.trim(), zone: zone.trim() || null, capacity } });
        toast({ kind: 'success', title: 'บันทึกโต๊ะแล้ว' });
      } else {
        await create.mutateAsync({ name: name.trim(), zone: zone.trim() || null, capacity });
        toast({ kind: 'success', title: `เพิ่มโต๊ะ ${name.trim()} แล้ว` });
      }
      onClose();
    } catch (e: unknown) {
      // 409 = another active table already uses that name.
      setError(errMsg(e));
    }
  };

  const doDelete = async () => {
    if (!table || busy) return;
    setError(null);
    try {
      await remove.mutateAsync(table.id);
      toast({ kind: 'success', title: 'ปิดใช้งานโต๊ะแล้ว' });
      onClose();
    } catch (e: unknown) {
      // 409 = the table still has an open session.
      setError(errMsg(e));
      setConfirmDelete(false);
    }
  };

  return (
    <ModalShell
      title={table ? `แก้ไขโต๊ะ ${table.name}` : 'เพิ่มโต๊ะ'}
      icon="park"
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
      <Field label="ชื่อโต๊ะ" hint="ห้ามซ้ำกับโต๊ะที่ยังใช้งานอยู่ (1–60 ตัวอักษร)">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="เช่น A1" aria-label="ชื่อโต๊ะ" style={inputStyle} />
      </Field>

      <Field label="โซน (ไม่บังคับ)" hint="ใช้จัดกลุ่มบนผังโต๊ะ เช่น ริมหน้าต่าง / ชั้น 2">
        <input value={zone} onChange={(e) => setZone(e.target.value)} maxLength={60} placeholder="เช่น ริมหน้าต่าง" aria-label="โซน" style={inputStyle} />
      </Field>

      <Field label="จำนวนที่นั่ง" hint="1–100">
        <NumberInput value={capacity} onChange={setCapacity} min={1} max={100} integer style={inputStyle} aria-label="จำนวนที่นั่ง" />
      </Field>

      {table && (
        <Field label="ปิดใช้งานโต๊ะ" hint="ประวัติยังอยู่ครบ — ทำไม่ได้ถ้าโต๊ะยังมีคนนั่งอยู่">
          {confirmDelete ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }}>ไม่ปิด</button>
              <button
                onClick={() => { void doDelete(); }}
                disabled={busy}
                className="btn"
                style={{ flex: 1, minHeight: 44, background: 'var(--color-danger-strong)', borderColor: 'var(--color-danger-strong)', color: 'white' }}
              >
                ยืนยันปิดใช้งาน
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost" style={{ width: '100%', minHeight: 44, color: 'var(--color-danger)' }}>
              <Icon name="trash" size={16} /> ปิดใช้งานโต๊ะนี้
            </button>
          )}
        </Field>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}
    </ModalShell>
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
  const valid = name.trim().length >= 1 && isMoney(rate) && rounding >= 1 && grace >= 0
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

      <Field label="ราคาต่อชั่วโมง (฿)" hint="ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 40.00">
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          placeholder="40.00"
          aria-label="ราคาต่อชั่วโมง"
          style={{ ...inputStyle, borderColor: rate && !isMoney(rate) ? 'var(--color-danger)' : 'var(--color-border)' }}
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

// ── Small shared bits ─────────────────────────────────────────────────────────
function SectionHead({ title, hint, action }: { title: string; hint: string; action: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h2>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
      </div>
      <button onClick={action.onClick} className="btn btn-primary">
        <Icon name="plus" size={16} /> {action.label}
      </button>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
    }}>
      {children}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: 'primary' | 'muted' }) {
  const primary = tone === 'primary';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      background: primary ? 'var(--color-primary)' : 'var(--color-surface-2)',
      color: primary ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
    }}>
      {children}
    </span>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className="pressable"
        style={{
          width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
          fontSize: 14, fontWeight: 600,
          background: checked ? 'var(--color-primary)' : 'var(--color-surface-2)',
          color: checked ? 'var(--color-text-inverse)' : 'var(--color-text)',
          border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
        }}
      >
        <span>{label}</span>
        {checked && <Icon name="check" size={16} />}
      </button>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)', lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" style={{
      padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
      background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600,
    }}>
      {children}
    </div>
  );
}

function Notice({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      padding: 'var(--space-8)', maxWidth: 520, margin: '0 auto', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 'var(--radius-lg)', display: 'grid', placeItems: 'center',
        background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)',
      }}>
        <Icon name={icon} size={26} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>{body}</p>
    </div>
  );
}
