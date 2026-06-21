'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, baht, Select } from '../app-common';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useCategories } from '@/hooks/use-products';
import { useProductsAdmin } from '@/hooks/use-products';
import {
  useMembershipProgram,
  useSaveMembershipProgram,
  useRewardProducts,
  useSaveRewardProducts,
  type EarnMode,
  type RewardType,
  type RewardScope,
  type ProgramRead,
  type ProgramWrite,
} from '@/hooks/use-membership';

const IS: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
  color: 'var(--color-text)', fontSize: 14,
};

// Option values only — labels come from i18n (t.loyalty.*) inside the component.
const EARN_MODE_VALUES: EarnMode[] = ['PER_RECEIPT', 'PER_BAHT', 'PER_ITEM'];
const REWARD_TYPE_VALUES: RewardType[] = ['DISCOUNT_FIXED', 'DISCOUNT_PERCENT', 'FREE_ITEM'];
const REWARD_SCOPE_VALUES: RewardScope[] = ['ALL', 'CATEGORY', 'SPECIFIC_PRODUCTS'];

interface FormState {
  is_active: boolean;
  earn_mode: EarnMode;
  baht_per_point: string;
  earn_category_id: string; // PER_ITEM only; '' = count all items
  points_to_redeem: string;
  reward_type: RewardType;
  reward_value: string;
  reward_scope: RewardScope;
  reward_category_id: string;
  min_order_baht: string;
  points_expire_after_days: string;
  tier_bronze_threshold: string;
  tier_silver_threshold: string;
  tier_gold_threshold: string;
  bronze_earn_multiplier: string;
  silver_earn_multiplier: string;
  gold_earn_multiplier: string;
}

const DEFAULTS: FormState = {
  is_active: true, earn_mode: 'PER_BAHT', baht_per_point: '50', earn_category_id: '', points_to_redeem: '100',
  reward_type: 'DISCOUNT_FIXED', reward_value: '50', reward_scope: 'ALL', reward_category_id: '',
  min_order_baht: '', points_expire_after_days: '365',
  tier_bronze_threshold: '', tier_silver_threshold: '', tier_gold_threshold: '',
  bronze_earn_multiplier: '1', silver_earn_multiplier: '1.5', gold_earn_multiplier: '2',
};

function fromProgram(p: ProgramRead): FormState {
  const s = (v: string | number | null | undefined) => (v == null ? '' : String(v));
  return {
    is_active: p.is_active,
    earn_mode: p.earn_mode,
    baht_per_point: s(p.baht_per_point),
    earn_category_id: p.earn_category_id ?? '',
    points_to_redeem: s(p.points_to_redeem),
    reward_type: p.reward_type,
    reward_value: s(p.reward_value),
    reward_scope: p.reward_scope,
    reward_category_id: p.reward_category_id ?? '',
    min_order_baht: s(p.min_order_baht),
    points_expire_after_days: s(p.points_expire_after_days),
    tier_bronze_threshold: s(p.tier_bronze_threshold),
    tier_silver_threshold: s(p.tier_silver_threshold),
    tier_gold_threshold: s(p.tier_gold_threshold),
    bronze_earn_multiplier: s(p.bronze_earn_multiplier),
    silver_earn_multiplier: s(p.silver_earn_multiplier),
    gold_earn_multiplier: s(p.gold_earn_multiplier),
  };
}

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export default function LoyaltyConfig() {
  const toast = useToast();
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const canEdit = me?.role === 'OWNER';

  const { data: program, isLoading } = useMembershipProgram();
  const saveProgram = useSaveMembershipProgram();
  const saveRewardProducts = useSaveRewardProducts();
  const { data: categories } = useCategories();
  const { data: products } = useProductsAdmin();

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const isSpecific = form.reward_scope === 'SPECIFIC_PRODUCTS';
  const { data: rewardProducts } = useRewardProducts(isSpecific && !!program);

  // Derive state from async query data during render (React-blessed alternative to
  // setState-in-effect): re-seed the form whenever a different programme arrives.
  const [seededProgramId, setSeededProgramId] = useState<string | null>(null);
  if (program && program.id !== seededProgramId) {
    setSeededProgramId(program.id);
    setForm(fromProgram(program));
  }

  // Seed the SPECIFIC_PRODUCTS picker from the saved reward-products list (once per programme).
  const [seededRewardFor, setSeededRewardFor] = useState<string | null>(null);
  if (program && rewardProducts && seededRewardFor !== program.id) {
    setSeededRewardFor(program.id);
    setSelectedProductIds(rewardProducts.map(p => p.id));
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  const validate = (): string | null => {
    if (numOrNull(form.points_to_redeem) == null || Number(form.points_to_redeem) <= 0) return t.loyalty.validatePoints;
    if (form.earn_mode === 'PER_BAHT' && (numOrNull(form.baht_per_point) == null || Number(form.baht_per_point) <= 0)) return t.loyalty.validateBaht;
    if (form.reward_type === 'DISCOUNT_FIXED' || form.reward_type === 'DISCOUNT_PERCENT') {
      if (numOrNull(form.reward_value) == null || Number(form.reward_value) <= 0) return t.loyalty.validateDiscount;
      if (form.reward_type === 'DISCOUNT_PERCENT' && Number(form.reward_value) > 100) return t.loyalty.validatePercentMax;
    }
    if (form.reward_scope === 'CATEGORY' && !form.reward_category_id) return t.loyalty.validateCategory;
    const b = numOrNull(form.tier_bronze_threshold), s = numOrNull(form.tier_silver_threshold), g = numOrNull(form.tier_gold_threshold);
    if (b != null && s != null && s <= b) return t.loyalty.validateSilver;
    if (s != null && g != null && g <= s) return t.loyalty.validateGold;
    return null;
  };

  const handleSave = async () => {
    if (!canEdit) return;
    const err = validate();
    if (err) { toast({ kind: 'warning', title: err }); return; }
    const payload: ProgramWrite = {
      is_active: form.is_active,
      earn_mode: form.earn_mode,
      baht_per_point: form.earn_mode === 'PER_BAHT' ? Number(form.baht_per_point) : null,
      // BE rejects (422) a non-null earn_category_id outside PER_ITEM → clear it on mode switch.
      earn_category_id: form.earn_mode === 'PER_ITEM' ? (form.earn_category_id || null) : null,
      points_to_redeem: Number(form.points_to_redeem),
      reward_type: form.reward_type,
      reward_value: form.reward_type === 'FREE_ITEM' ? null : Number(form.reward_value),
      reward_scope: form.reward_scope,
      reward_category_id: form.reward_scope === 'CATEGORY' ? form.reward_category_id : null,
      min_order_baht: numOrNull(form.min_order_baht),
      points_expire_after_days: numOrNull(form.points_expire_after_days),
      tier_bronze_threshold: numOrNull(form.tier_bronze_threshold),
      tier_silver_threshold: numOrNull(form.tier_silver_threshold),
      tier_gold_threshold: numOrNull(form.tier_gold_threshold),
      bronze_earn_multiplier: Number(form.bronze_earn_multiplier || '1'),
      silver_earn_multiplier: Number(form.silver_earn_multiplier || '1'),
      gold_earn_multiplier: Number(form.gold_earn_multiplier || '1'),
    };
    try {
      await saveProgram.mutateAsync(payload);
      if (form.reward_scope === 'SPECIFIC_PRODUCTS') {
        await saveRewardProducts.mutateAsync(selectedProductIds);
      }
      toast({ kind: 'success', title: t.loyalty.saved });
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    }
  };

  if (isLoading) return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 760 }} aria-busy="true">
      <span className="sr-only">{t.loyalty.loadingAria}</span>
      <SkeletonCard lines={1} style={{ borderRadius: 12, padding: 18 }} />
      <SkeletonCard lines={2} style={{ borderRadius: 12, padding: 18 }} />
      <SkeletonCard lines={3} style={{ borderRadius: 12, padding: 18 }} />
      <SkeletonCard lines={2} style={{ borderRadius: 12, padding: 18 }} />
    </div>
  );

  const dis = !canEdit;

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
      {!program && (
        <div style={{ background: 'var(--color-accent-50)', border: '1px solid var(--color-accent)', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <Icon name="gift" size={20} color="var(--color-accent-600)" />
          <div style={{ fontSize: 13, color: 'var(--color-primary-700)' }}>{t.loyalty.notConfigured}</div>
        </div>
      )}
      {!canEdit && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.loyalty.readOnly}</div>
      )}

      {/* Status */}
      <Section title={t.loyalty.statusSection}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: dis ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={form.is_active} disabled={dis} onChange={e => set('is_active', e.target.checked)} style={{ accentColor: 'var(--color-accent)', width: 18, height: 18 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t.loyalty.activeLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t.loyalty.activeHint}</div>
          </div>
        </label>
      </Section>

      {/* Earning */}
      <Section title={t.loyalty.earnSection}>
        <Grid>
          <Field label={t.loyalty.earnModeLabel}>
            <Select value={form.earn_mode} disabled={dis} onChange={v => set('earn_mode', v as EarnMode)} ariaLabel={t.loyalty.earnModeLabel} options={EARN_MODE_VALUES.map(v => ({ value: v, label: t.loyalty.earnModes[v] }))} />
          </Field>
          {form.earn_mode === 'PER_BAHT' && (
            <Field label={t.loyalty.bahtPerPointLabel}>
              <input type="number" value={form.baht_per_point} disabled={dis} onChange={e => set('baht_per_point', e.target.value)} style={IS} placeholder="50" />
            </Field>
          )}
          {form.earn_mode === 'PER_ITEM' && (
            <Field label={t.loyalty.earnCategoryLabel}>
              <Select value={form.earn_category_id} disabled={dis} onChange={v => set('earn_category_id', v)} ariaLabel={t.loyalty.earnCategoryLabel}
                options={[{ value: '', label: t.loyalty.earnCategoryAll }, ...(categories ?? []).map(c => ({ value: c.id, label: c.label }))]} />
            </Field>
          )}
        </Grid>
      </Section>

      {/* Reward */}
      <Section title={t.loyalty.rewardSection}>
        <Grid>
          <Field label={t.loyalty.pointsToRedeemLabel}>
            <input type="number" value={form.points_to_redeem} disabled={dis} onChange={e => set('points_to_redeem', e.target.value)} style={IS} placeholder="100" />
          </Field>
          <Field label={t.loyalty.rewardTypeLabel}>
            <Select value={form.reward_type} disabled={dis} onChange={v => set('reward_type', v as RewardType)} ariaLabel={t.loyalty.rewardTypeLabel} options={REWARD_TYPE_VALUES.map(v => ({ value: v, label: t.loyalty.rewardTypes[v] }))} />
          </Field>
          {form.reward_type !== 'FREE_ITEM' && (
            <Field label={form.reward_type === 'DISCOUNT_PERCENT' ? t.loyalty.discountPercentLabel : t.loyalty.discountFixedLabel}>
              <input type="number" value={form.reward_value} disabled={dis} onChange={e => set('reward_value', e.target.value)} style={IS} placeholder={form.reward_type === 'DISCOUNT_PERCENT' ? '10' : '50'} />
            </Field>
          )}
          <Field label={t.loyalty.rewardScopeLabel}>
            <Select value={form.reward_scope} disabled={dis} onChange={v => set('reward_scope', v as RewardScope)} ariaLabel={t.loyalty.rewardScopeLabel} options={REWARD_SCOPE_VALUES.map(v => ({ value: v, label: t.loyalty.rewardScopes[v] }))} />
          </Field>
          {form.reward_scope === 'CATEGORY' && (
            <Field label={t.loyalty.rewardCategoryLabel}>
              <Select value={form.reward_category_id} disabled={dis} onChange={v => set('reward_category_id', v)} ariaLabel={t.loyalty.rewardCategoryLabel} placeholder={t.loyalty.rewardCategoryPlaceholder} options={(categories ?? []).map(c => ({ value: c.id, label: c.label }))} />
            </Field>
          )}
        </Grid>

        {form.reward_scope === 'SPECIFIC_PRODUCTS' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{t.loyalty.selectedCount(selectedProductIds.length)}</div>
            <div className="scroll" style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, padding: 8, display: 'grid', gap: 4 }}>
              {(products ?? []).map(p => {
                const checked = selectedProductIds.includes(p.id);
                return (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: dis ? 'default' : 'pointer', background: checked ? 'var(--color-accent-50)' : 'transparent' }}>
                    <input type="checkbox" checked={checked} disabled={dis}
                      onChange={() => setSelectedProductIds(cur => checked ? cur.filter(id => id !== p.id) : [...cur, p.id])}
                      style={{ accentColor: 'var(--color-accent)' }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                    <span className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{baht(Number(p.price))}</span>
                  </label>
                );
              })}
              {(products ?? []).length === 0 && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 8 }}>{t.loyalty.noProducts}</div>}
            </div>
          </div>
        )}
      </Section>

      {/* Tiers */}
      <Section title={t.loyalty.tierSection}>
        <Grid cols={3}>
          <Field label={t.loyalty.tierBronzeLabel}><input type="number" value={form.tier_bronze_threshold} disabled={dis} onChange={e => set('tier_bronze_threshold', e.target.value)} style={IS} placeholder={t.loyalty.tierBronzePlaceholder} /></Field>
          <Field label={t.loyalty.tierSilverLabel}><input type="number" value={form.tier_silver_threshold} disabled={dis} onChange={e => set('tier_silver_threshold', e.target.value)} style={IS} placeholder={t.loyalty.tierSilverPlaceholder} /></Field>
          <Field label={t.loyalty.tierGoldLabel}><input type="number" value={form.tier_gold_threshold} disabled={dis} onChange={e => set('tier_gold_threshold', e.target.value)} style={IS} placeholder={t.loyalty.tierGoldPlaceholder} /></Field>
          <Field label={t.loyalty.multiplierBronzeLabel}><input type="number" value={form.bronze_earn_multiplier} disabled={dis} onChange={e => set('bronze_earn_multiplier', e.target.value)} style={IS} placeholder="1.0" /></Field>
          <Field label={t.loyalty.multiplierSilverLabel}><input type="number" value={form.silver_earn_multiplier} disabled={dis} onChange={e => set('silver_earn_multiplier', e.target.value)} style={IS} placeholder="1.5" /></Field>
          <Field label={t.loyalty.multiplierGoldLabel}><input type="number" value={form.gold_earn_multiplier} disabled={dis} onChange={e => set('gold_earn_multiplier', e.target.value)} style={IS} placeholder="2.0" /></Field>
        </Grid>
      </Section>

      {/* Extra conditions */}
      <Section title={t.loyalty.extraSection}>
        <Grid>
          <Field label={t.loyalty.minOrderLabel}><input type="number" value={form.min_order_baht} disabled={dis} onChange={e => set('min_order_baht', e.target.value)} style={IS} placeholder={t.loyalty.minOrderPlaceholder} /></Field>
          <Field label={t.loyalty.expireLabel}><input type="number" value={form.points_expire_after_days} disabled={dis} onChange={e => set('points_expire_after_days', e.target.value)} style={IS} placeholder="365" /></Field>
        </Grid>
      </Section>

      {canEdit && (
        <div>
          <button onClick={handleSave} disabled={saveProgram.isPending}
            style={{ padding: '11px 26px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {saveProgram.isPending ? t.loyalty.saving : t.loyalty.saveBtn}
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
