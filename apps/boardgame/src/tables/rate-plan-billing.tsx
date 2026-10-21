'use client';

// Board-game edition: the rate-plan part of the core "open table" dialog. Moved out
// of core table-session-modal.tsx; plugged in through
// `EditionConfig.tables.useOpenSessionBilling`.

import { useMemo, useState } from 'react';
import Icon from '@pos/core/components/icons';
import { Select } from '@pos/core/components/app-common';
import { Field, alertStyle, planSummary, selectTrigger } from '@pos/core/components/screens/table-session-modal';
import type { OpenSessionBilling } from '@pos/core/edition/types';
import { useRatePlans, type RatePlan } from '@/hooks/use-rate-plans';

export function useRatePlanBilling({ onGoSetup }: { onGoSetup?: () => void }): OpenSessionBilling {
  const plansQ = useRatePlans();
  const [planId, setPlanId] = useState<string>('');

  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);
  const defaultPlan: RatePlan | undefined = plans.find((p) => p.isDefault) ?? plans[0];

  // Empty state = "not chosen yet", which resolves to the store's default plan
  // once the list loads. Deriving it (instead of syncing state in an effect) keeps
  // the pre-load render correct without a cascading re-render.
  const effectivePlanId = planId || defaultPlan?.id || '';
  const selectedPlan = plans.find((p) => p.id === effectivePlanId) ?? defaultPlan;
  const noPlans = !plansQ.isLoading && plans.length === 0;

  return {
    // 422 from the backend = store has no rate plan; `blocked` prevents that call.
    ratePlanId: effectivePlanId || null,
    blocked: noPlans,
    notice: noPlans ? (
      <div role="alert" style={{
        ...alertStyle('warning'),
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', marginBottom: 'var(--space-5)',
      }}>
        <Icon name="warning" size={18} />
        <div style={{ flex: 1 }}>
          ร้านนี้ยังไม่มีแพ็กเกจเวลา — ต้องสร้างก่อนถึงจะเปิดโต๊ะได้
          {onGoSetup && <div><button onClick={onGoSetup} className="btn btn-ghost tap-std" style={{ marginTop: 'var(--space-2)' }}>ไปตั้งค่าโต๊ะ</button></div>}
        </div>
      </div>
    ) : undefined,
    field: (
      <Field
        label="แพ็กเกจเวลา"
        hint={selectedPlan ? planSummary(selectedPlan) : undefined}
      >
        <Select
          value={effectivePlanId}
          onChange={setPlanId}
          ariaLabel="แพ็กเกจเวลา"
          placeholder={plansQ.isLoading ? 'กำลังโหลด…' : '— เลือก —'}
          disabled={noPlans}
          triggerStyle={selectTrigger}
          options={plans.map((p) => ({ value: p.id, label: p.isDefault ? `${p.name} (ค่าเริ่มต้น)` : p.name }))}
        />
      </Field>
    ),
  };
}
