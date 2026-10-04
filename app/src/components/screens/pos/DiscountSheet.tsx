'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from '../../icons';
import { baht } from '../../app-common';
import { Badge, Banner, Button, Keypad, NumberField, SegmentedControl, Select, Sheet, type KeypadKey } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { EligiblePromotion } from '@/hooks/use-promotions';
import type { ManualDiscount, ManualDiscountKind } from '@/stores/cart-store';
import type { MemberInfo } from '../membership-modal';
import {
  MANUAL_DISCOUNT_ENABLED, MANUAL_DISCOUNT_PIN_BAHT, MANUAL_DISCOUNT_PIN_PERCENT,
  manualDiscountAmount, needsManagerPin,
} from './model';
import { readStoreSlug, verifyManagerPin } from './manager-auth';

interface RewardInfo {
  available: boolean;
  member: MemberInfo | null;
  isFreeItem: boolean;
  descLabel: string;
  pointsToRedeem: number;
  pointsBalance: number;
  estimate: number;
  products: { id: string; name: string; price: number }[];
  onToggle: (on: boolean) => void;
  onPickProduct: (id: string) => void;
}

interface DiscountSheetProps {
  open: boolean;
  onClose: () => void;
  promos: EligiblePromotion[];
  /** True while POST /promotions/evaluate is in flight. */
  promosLoading: boolean;
  selectedPromoIds: string[];
  onTogglePromo: (p: EligiblePromotion) => void;
  reward: RewardInfo;
  /** Amount the manual discount applies to (after promos + member). */
  manualBase: number;
  manual: ManualDiscount | null;
  onManual: (d: ManualDiscount | null) => void;
  /** Signed-in user may approve their own discount (OWNER / MANAGER). */
  selfApprover: { id: string; name: string } | null;
  totalDiscount: number;
}

export function DiscountSheet(p: DiscountSheetProps) {
  const { t } = useI18n();
  const exclusive = p.promos.find((e) => p.selectedPromoIds.includes(e.promotion_id) && e.is_exclusive) ?? null;
  const { reward } = p;
  const nothing = p.promos.length === 0 && !reward.available && !MANUAL_DISCOUNT_ENABLED;

  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      title={t.pos.discountTitle}
      footer={
        <Button variant="primary" size="lg" fullWidth onClick={p.onClose}
          trailing={p.totalDiscount > 0 ? <span className="ui-btn__amount">-{baht(p.totalDiscount)}</span> : undefined}>
          {t.pos.discountDone}
        </Button>
      }
    >
      <div className="pos-disc">
        {/* Member reward */}
        {reward.available && reward.member && (
          <section className="pos-disc__section" aria-labelledby="pos-disc-reward">
            <h3 id="pos-disc-reward" className="pos-disc__h">{t.pos.redeemTitle}</h3>
            <label className="pos-check" data-on={reward.member.redeemReward ? '' : undefined}>
              <input type="checkbox" checked={reward.member.redeemReward} onChange={(e) => reward.onToggle(e.target.checked)} />
              <span className="pos-check__text">
                <span className="pos-check__title">{t.pos.redeemDesc(reward.pointsToRedeem.toLocaleString(), reward.descLabel)}</span>
                <span className="pos-check__sub">
                  {t.pos.redeemPointsBalance(reward.pointsBalance.toLocaleString(), Math.max(0, reward.pointsBalance - reward.pointsToRedeem).toLocaleString())}
                </span>
              </span>
              {reward.member.redeemReward && reward.estimate > 0 && <span className="pos-check__amt num">-{baht(reward.estimate)}</span>}
            </label>
            {reward.member.redeemReward && reward.isFreeItem && (
              <Select
                label={t.pos.redeemPickItem}
                value={reward.member.rewardProduct?.id ?? ''}
                onChange={reward.onPickProduct}
                options={reward.products.map((x) => ({ value: x.id, label: `${x.name} · ${baht(x.price)}` }))}
              />
            )}
          </section>
        )}

        {/* Promotions */}
        <section className="pos-disc__section" aria-labelledby="pos-disc-promos" aria-busy={p.promosLoading || undefined}>
          <h3 id="pos-disc-promos" className="pos-disc__h">{t.pos.promotions}</h3>
          {p.promos.length === 0 ? (
            <p className="pos-disc__empty">{p.promosLoading ? t.pos.promosChecking : t.pos.noPromos}</p>
          ) : (
            <div className="pos-disc__list">
              {p.promos.map((e) => {
                const checked = p.selectedPromoIds.includes(e.promotion_id);
                const locked = !!exclusive && exclusive.promotion_id !== e.promotion_id;
                return (
                  <label key={e.promotion_id} className="pos-check" data-on={checked ? '' : undefined} data-locked={locked ? '' : undefined}>
                    <input type="checkbox" checked={checked} disabled={locked} onChange={() => p.onTogglePromo(e)} />
                    <span className="pos-check__text">
                      <span className="pos-check__title">{e.name}</span>
                      {e.is_exclusive && <span className="pos-check__sub"><Badge tone="warning">{t.pos.exclusive}</Badge></span>}
                      {locked && <span className="pos-check__sub">{t.pos.lockedByExclusive}</span>}
                    </span>
                    <span className="pos-check__amt num">-{baht(Number(e.discount_amount))}</span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {MANUAL_DISCOUNT_ENABLED && (
          <ManualDiscountSection
            base={p.manualBase}
            value={p.manual}
            onChange={p.onManual}
            selfApprover={p.selfApprover}
          />
        )}

        {nothing && <p className="pos-disc__empty">{t.pos.noDiscounts}</p>}
      </div>
    </Sheet>
  );
}

// ── Manual bill discount (+ manager PIN above the threshold) ────────────────

const PRESETS: { kind: ManualDiscountKind; value: number }[] = [
  { kind: 'percent', value: 5 }, { kind: 'percent', value: 10 },
  { kind: 'amount', value: 20 }, { kind: 'amount', value: 50 },
];

function ManualDiscountSection({ base, value, onChange, selfApprover }: {
  base: number;
  value: ManualDiscount | null;
  onChange: (d: ManualDiscount | null) => void;
  selfApprover: { id: string; name: string } | null;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<ManualDiscountKind>(value?.kind ?? 'percent');
  const [num, setNum] = useState<number>(value?.value ?? 0);
  const [askPin, setAskPin] = useState(false);

  const amount = manualDiscountAmount({ kind, value: num }, base);
  const gated = needsManagerPin(amount, base);
  const applied = value ? manualDiscountAmount(value, base) : 0;
  const dirty = !value || value.kind !== kind || value.value !== num;

  const apply = (approver: { id: string; name: string } | null) => {
    onChange(amount > 0 ? { kind, value: num, approvedBy: approver } : null);
    setAskPin(false);
  };

  const onApply = () => {
    if (amount <= 0) { onChange(null); return; }
    if (!gated) { apply(null); return; }
    if (selfApprover) { apply(selfApprover); return; }
    setAskPin(true);
  };

  return (
    <section className="pos-disc__section" aria-labelledby="pos-disc-manual">
      <h3 id="pos-disc-manual" className="pos-disc__h">{t.pos.manualDiscount}</h3>
      <p className="pos-disc__hint">{t.pos.manualRule(MANUAL_DISCOUNT_PIN_PERCENT, baht(MANUAL_DISCOUNT_PIN_BAHT))}</p>

      <div className="pos-disc__manual">
        <SegmentedControl<ManualDiscountKind>
          ariaLabel={t.pos.manualKind}
          size="lg"
          value={kind}
          onChange={(k) => { setKind(k); setNum(0); }}
          options={[{ value: 'percent', label: '%' }, { value: 'amount', label: '฿' }]}
        />
        <NumberField
          variant="plain"
          size="lg"
          aria-label={t.pos.manualValue}
          value={num}
          onChange={setNum}
          min={0}
          max={kind === 'percent' ? 100 : Math.max(0, base)}
          integer
          unit={kind === 'percent' ? '%' : '฿'}
        />
      </div>
      <div className="pos-disc__presets">
        {PRESETS.map((pr) => (
          <Button key={`${pr.kind}${pr.value}`} variant="secondary" size="md"
            onClick={() => { setKind(pr.kind); setNum(pr.value); }}>
            {pr.kind === 'percent' ? `${pr.value}%` : baht(pr.value)}
          </Button>
        ))}
      </div>

      <div className="pos-disc__result">
        <span>{t.pos.manualResult(baht(amount))}</span>
        {gated && <Badge tone="warning">{t.pos.needsManager}</Badge>}
      </div>

      {value && !dirty ? (
        <div className="pos-disc__applied">
          <span>
            {t.pos.manualApplied(baht(applied))}
            {value.approvedBy ? ` · ${t.pos.approvedBy(value.approvedBy.name)}` : ''}
          </span>
          <Button variant="ghost" size="md" onClick={() => { onChange(null); setNum(0); }}>{t.pos.removeDiscount}</Button>
        </div>
      ) : askPin ? null : (
        <Button variant="secondary" size="lg" fullWidth onClick={onApply} disabled={amount <= 0 && !value}
          icon={gated && !selfApprover ? <Icon name="staff" size={18} /> : undefined}>
          {amount <= 0 ? t.pos.removeDiscount : gated && !selfApprover ? t.pos.askManager : t.pos.applyManual}
        </Button>
      )}

      {askPin && (
        <ManagerPin
          onCancel={() => setAskPin(false)}
          onApproved={(approver) => apply(approver)}
        />
      )}
    </section>
  );
}

function ManagerPin({ onCancel, onApproved }: {
  onCancel: () => void;
  onApproved: (approver: { id: string; name: string }) => void;
}) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = readStoreSlug();
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.scrollIntoView({ block: 'nearest' }); }, []);

  const submit = async (code: string) => {
    if (busy || code.length < 4) return;
    setBusy(true);
    setError(null);
    const res = await verifyManagerPin(code, slug);
    setBusy(false);
    if (res.ok) { onApproved(res.approver); return; }
    setPin('');
    setError(
      res.reason === 'wrong-pin' ? t.pos.pinWrong
      : res.reason === 'not-manager' ? t.pos.pinNotManager
      : res.reason === 'other-store' ? t.pos.pinOtherStore
      : res.reason === 'rate-limited' ? t.pos.pinRateLimited(res.retryAfter ?? 60)
      : res.reason === 'no-store' ? t.pos.pinNoStore
      : res.reason === 'signed-out' ? t.pos.pinSignedOut
      : t.pos.pinNetwork,
    );
  };

  const onKey = (k: KeypadKey) => {
    if (busy) return;
    if (k === 'enter') { void submit(pin); return; }
    if (k === 'back') { setPin((v) => v.slice(0, -1)); return; }
    if (k === 'clear') { setPin(''); return; }
    if (!/^\d$/.test(k)) return;
    setError(null);
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length === 6) void submit(next);
  };

  return (
    <div ref={boxRef} className="pos-pin" role="group" aria-labelledby="pos-pin-title">
      <h4 id="pos-pin-title" className="pos-pin__title">{t.pos.managerPinTitle}</h4>
      {!slug ? (
        <Banner tone="warning" title={t.pos.pinNoStore} />
      ) : (
        <>
          <div className="pos-pin__dots" aria-label={t.pos.pinDigits(pin.length)} role="img">
            {Array.from({ length: 6 }).map((_, i) => <span key={i} className="pos-pin__dot" data-on={i < pin.length ? '' : undefined} />)}
          </div>
          {error && <p className="pos-pin__error" role="alert">{error}</p>}
          <Keypad variant="pin" onKey={onKey} captureKeyboard showEnter={pin.length >= 4} disabled={busy}
            ariaLabel={t.pos.managerPinTitle} />
        </>
      )}
      <Button variant="ghost" size="md" onClick={onCancel} loading={busy}>{t.common.cancel}</Button>
    </div>
  );
}
