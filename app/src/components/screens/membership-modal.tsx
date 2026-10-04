'use client';

import { useState, useEffect, useRef } from 'react';
import Icon from '../icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast, Tag } from '../app-common';
import {
  useLookupMember,
  useRegisterMember,
  useMembers,
  isMemberNameTaken,
  type AccountRead,
  type LookupResponse,
  type RewardProductRead,
  type MembershipTier,
} from '@/hooks/use-membership';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { NumpadField } from '@/components/ui/numpad-field';
import { useI18n } from '@/lib/i18n';

/** What the POS keeps once a member is attached to the bill. */
export interface MemberInfo {
  account: AccountRead;
  program: LookupResponse['program'];
  redeemReward: boolean;
  rewardProduct: RewardProductRead | null;
  // ── Redemption-eligibility context, carried from the lookup so the redeem
  //    choice happens in the POS "promotions" panel, not in this modal ──
  rewardRedeemable: boolean;
  pointsToNextReward: number | null;
  eligibleRewardProducts: RewardProductRead[];
}

/** Default redeem context for attach paths that don't carry a points lookup. */
const NO_REDEEM = {
  redeemReward: false,
  rewardProduct: null,
  rewardRedeemable: false,
  pointsToNextReward: null,
  eligibleRewardProducts: [] as RewardProductRead[],
};

const TIER_LABEL: Record<MembershipTier, string> = {
  NONE: 'สมาชิก', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
};
const TIER_TONE: Record<MembershipTier, 'neutral' | 'success' | 'info' | 'accent'> = {
  NONE: 'neutral', BRONZE: 'success', SILVER: 'info', GOLD: 'accent',
};

const IS: React.CSSProperties = {
  width: '100%', padding: '10px var(--space-3)', minHeight: 'var(--tap-std)', borderRadius: 'var(--radius-md)', boxSizing: 'border-box',
  border: 'var(--hairline)', background: 'var(--color-surface)',
  color: 'var(--color-text)', outline: 'none',
};
/** Font size for `IS` inputs — a class, not an inline style, so the touch rule in
 *  globals.css (inputs render at 16px: no iOS zoom on focus) can override it. */
const IS_CLASS = 'text-body';
const LABEL: React.CSSProperties = { fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 };
/** Primary "ค้นหา" beside the name field: 48px tall (TOUCH-SPEC §2 --tap-std). */
const SEARCH_BTN: React.CSSProperties = {
  padding: '0 var(--space-5)', minHeight: 'var(--tap-std)', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)',
  color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 'var(--fs-body)', whiteSpace: 'nowrap', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
};
/** Footer actions: 56px (TOUCH-SPEC §3.6 modal primary / ghost cancel). */
const FOOT_BTN: React.CSSProperties = {
  padding: '0 var(--space-5)', minHeight: 'var(--tap-lg)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-lg)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
};
const FOOT_GHOST: React.CSSProperties = { ...FOOT_BTN, border: 'var(--hairline)', background: 'var(--color-surface)', color: 'var(--color-text)' };

/**
 * Phone keypad fit. `.numpad` is a grid with an implicit `auto` column, so the display
 * row's min-content (label + "081-234-5678" at 28px) widened the pad past a 327px phone
 * body. Pin the column to minmax(0, 1fr), and on phones step the number down to 22px so
 * a full 10-digit number stays readable instead of clipped.
 * (Shared fix belongs in globals.css `.numpad`; scoped here until it lands.)
 */
const MEMBER_PAD_CSS = `
.member-pad { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 767px) {
  .member-pad .numpad-display { gap: var(--space-2); padding: 0 var(--space-3); }
  .member-pad .numpad-value { font-size: 22px; }
}
`;

/** "0812345678" → "081-234-5678" (display only; the value stays raw digits). */
const formatPhone = (v: string) =>
  v.replace(/^(\d{3})(\d{0,3})(\d{0,4}).*/, (_, a: string, b: string, c: string) => [a, b, c].filter(Boolean).join('-'));

interface Props {
  onClose: () => void;
  onSelectMember: (info: MemberInfo) => void;
  /** Open straight into the register form (e.g. the POS "สมัครสมาชิก" button). Defaults to lookup. */
  initialPhase?: 'lookup' | 'register';
}

export default function MembershipModal({ onClose, onSelectMember, initialPhase = 'lookup' }: Props) {
  const toast = useToast();
  const { t } = useI18n();
  const lookup = useLookupMember();
  const register = useRegisterMember();
  const dialogRef = useModalA11y(onClose);

  const [phase, setPhase] = useState<'lookup' | 'register'>(initialPhase);
  // True only when the register phase was reached via a failed phone lookup — drives the
  // "ไม่พบสมาชิกสำหรับเบอร์นี้" hint, which would be misleading when opening register directly.
  const [fromMiss, setFromMiss] = useState(false);
  const [searchMode, setSearchMode] = useState<'phone' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const [result, setResult] = useState<LookupResponse | null>(null);
  // Last phone we auto-looked-up — keeps the effect from re-firing for the same number.
  const lastAutoPhone = useRef('');

  // Name search reuses the members endpoint (which already supports ?name=).
  const membersQuery = useMembers(
    { name: submittedName, limit: 20 },
    searchMode === 'name' && submittedName.trim().length > 0,
  );

  const switchMode = (m: 'phone' | 'name') => {
    if (m === searchMode) return;
    setSearchMode(m);
    setResult(null);
    setSubmittedName('');
    lastAutoPhone.current = '';
  };

  const doNameSearch = () => {
    const n = nameInput.trim();
    if (!n) { toast({ kind: 'warning', title: 'กรอกชื่อ' }); return; }
    setResult(null);
    setSubmittedName(n);
  };

  // Picking a name-search result: re-run the phone lookup to load the full
  // points / redeem context, then fall through to the standard "found" card.
  const selectFromNameResult = async (acc: AccountRead) => {
    if (!acc.phone) {
      // No phone on file → can't load redeem context; attach as-is.
      onSelectMember({ account: acc, program: null, ...NO_REDEEM });
      return;
    }
    try {
      const res = await lookup.mutateAsync(acc.phone);
      if (res.found && res.account) {
        setPhone(acc.phone);
        setResult(res);
      } else {
        onSelectMember({ account: acc, program: null, ...NO_REDEEM });
      }
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    }
  };

  // register form
  const [regName, setRegName] = useState('');
  const [regDob, setRegDob] = useState('');
  const [checkingName, setCheckingName] = useState(false);

  const doLookup = async () => {
    const p = phone.trim();
    if (!p) { toast({ kind: 'warning', title: 'กรอกเบอร์โทร' }); return; }
    try {
      const res = await lookup.mutateAsync(p);
      if (!res.found) {
        // Not an error — offer to register on the spot.
        setResult(null);
        setRegName('');
        setRegDob('');
        setFromMiss(true);
        setPhase('register');
        return;
      }
      setResult(res);
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    }
  };

  // ── Auto-search (debounced) — results appear without pressing "ค้นหา" ───────
  // Name mode: feed the trimmed input into the members query as the user types.
  useEffect(() => {
    if (phase !== 'lookup' || searchMode !== 'name') return;
    const t = setTimeout(() => setSubmittedName(nameInput.trim()), 300);
    return () => clearTimeout(t);
  }, [nameInput, searchMode, phase]);

  // Phone mode: run the lookup automatically once a full (10-digit) number is in.
  useEffect(() => {
    if (phase !== 'lookup' || searchMode !== 'phone') return;
    const p = phone.trim();
    if (p.length < 10 || p === lastAutoPhone.current) return;
    const t = setTimeout(() => { lastAutoPhone.current = p; doLookup(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, searchMode, phase]);

  const doRegister = async () => {
    if (!regName.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อสมาชิก' }); return; }
    if (!phone.trim()) { toast({ kind: 'warning', title: 'กรอกเบอร์โทร' }); return; }
    try {
      setCheckingName(true);
      if (await isMemberNameTaken(regName)) {
        toast({ kind: 'warning', title: 'ชื่อนี้มีสมาชิกอยู่แล้ว', msg: 'กรุณาใช้ชื่ออื่น หรือค้นหาสมาชิกเดิม' });
        return;
      }
      const account = await register.mutateAsync({
        name: regName.trim(),
        phone: phone.trim(),
        date_of_birth: regDob || undefined,
      });
      toast({ kind: 'success', title: 'สมัครสมาชิกแล้ว', msg: account.customer_name });
      // New member has no points yet → attach without redeem.
      onSelectMember({ account, program: null, ...NO_REDEEM });
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    } finally {
      setCheckingName(false);
    }
  };

  const confirmAttach = () => {
    if (!result?.account) return;
    // Attach the member with the redeem *context* but no redeem decision yet —
    // the cashier picks the reward (and which cart item) in the POS promo panel.
    onSelectMember({
      account: result.account,
      program: result.program,
      redeemReward: false,
      rewardProduct: null,
      rewardRedeemable: result.reward_redeemable,
      pointsToNextReward: result.points_to_next_reward,
      eligibleRewardProducts: result.eligible_reward_products,
    });
  };

  const busy = lookup.isPending || register.isPending || checkingName || (searchMode === 'name' && membersQuery.isFetching);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={phase === 'register' ? 'สมัครสมาชิกใหม่' : 'สมาชิก / สะสมแต้ม'}
        aria-busy={busy || undefined}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(480px, 92vw)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: 'var(--color-accent-50)', color: 'var(--color-accent-600)', display: 'grid', placeItems: 'center' }}>
            <Icon name="user" size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, lineHeight: 'var(--lh-tight)' }}>{phase === 'register' ? 'สมัครสมาชิกใหม่' : 'สมาชิก / สะสมแต้ม'}</div>
            <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>{phase === 'register' ? 'กรอกข้อมูลเพื่อสมัครสมาชิก' : searchMode === 'name' ? 'ค้นหาด้วยชื่อสมาชิก' : 'ค้นหาด้วยเบอร์โทรศัพท์'}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="icon-btn tap-std tap-sq" style={{ margin: '-8px -8px -8px 0', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)' }}>
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="scroll pad-phone" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 24px' }}>
          {/* Search-mode toggle (lookup only): a 48px segmented control that switches
              on pointerdown (TOUCH-SPEC §4); keyboard clicks (detail 0) still work. */}
          {phase === 'lookup' && (
            <div role="group" aria-label={t.touchModals.memberSearchBy} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--color-surface-2)', padding: 4, borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }}>
              {([['phone', 'เบอร์โทร'], ['name', 'ชื่อ']] as const).map(([m, label]) => (
                <button key={m} type="button"
                  aria-pressed={searchMode === m}
                  onPointerDown={(e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; switchMode(m); }}
                  onClick={(e) => { if (e.detail === 0) switchMode(m); }}
                  className="tap tap-std"
                  style={{
                    padding: '0 var(--space-5)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: searchMode === m ? 'var(--color-surface)' : 'transparent',
                    color: searchMode === m ? 'var(--color-text)' : 'var(--color-text-secondary)',
                    boxShadow: searchMode === m ? 'var(--shadow-xs)' : 'none',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Phone lookup: on-screen keypad (no soft keyboard on tablets). A full
              10-digit number looks itself up; "ค้นหา" covers shorter numbers. */}
          {searchMode === 'phone' && phase === 'lookup' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-3)' }}>
              <style>{MEMBER_PAD_CSS}</style>
              <NumpadField
                className="member-pad"
                label={t.touchModals.memberPhone}
                mode="digits"
                size="md"
                value={phone}
                onChange={(v) => { setPhone(v); if (result) setResult(null); }}
                format={formatPhone}
                placeholder="08X-XXX-XXXX"
                onEnter={doLookup}
              />
              <button onClick={doLookup} disabled={lookup.isPending || !phone} className="tap"
                style={{ ...SEARCH_BTN, minHeight: 'var(--tap-lg)', fontSize: 'var(--fs-lg)', opacity: !phone ? 0.5 : 1 }}>
                {lookup.isPending ? <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} /> : <Icon name="search" size={18} />}
                ค้นหา
              </button>
            </div>
          )}

          {/* Phone while registering: a plain field (the name input needs the OS keyboard anyway). */}
          {phase === 'register' && (
            <>
              <label htmlFor="reg-phone" style={LABEL}>เบอร์โทรศัพท์</label>
              <input
                id="reg-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                placeholder="08XXXXXXXX"
                className={`num ${IS_CLASS}`}
                style={IS}
              />
            </>
          )}

          {/* Name field + results — name mode (lookup) */}
          {searchMode === 'name' && phase === 'lookup' && (
            <>
              <label htmlFor="member-name-search" style={LABEL}>ชื่อสมาชิก</label>
              <div style={{ display: 'flex', gap: 'var(--tap-gap)' }}>
                <input
                  id="member-name-search"
                  value={nameInput}
                  onChange={(e) => { setNameInput(e.target.value); if (result) setResult(null); }}
                  placeholder="ชื่อ หรือบางส่วนของชื่อ"
                  aria-label="ชื่อสมาชิก"
                  className={IS_CLASS}
                  style={IS}
                  onKeyDown={(e) => { if (e.key === 'Enter') doNameSearch(); }}
                  autoFocus
                />
                <button onClick={doNameSearch} disabled={membersQuery.isFetching} className="tap" style={SEARCH_BTN}>
                  {membersQuery.isFetching ? <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} /> : <Icon name="search" size={18} />}
                  ค้นหา
                </button>
              </div>

              {submittedName && !result?.found && (
                <div
                  style={{
                    marginTop: 'var(--space-4)', display: 'grid', gap: 'var(--space-2)', alignContent: 'start',
                    // Reserve a stable height so the modal doesn't resize as the
                    // result region toggles between skeleton / "ไม่พบ" / results.
                    minHeight: 168,
                    // Dim (not blank) while re-fetching a new term — keepPreviousData
                    // keeps the old rows in place so nothing jumps.
                    opacity: membersQuery.isFetching && !membersQuery.isLoading ? 0.55 : 1,
                    transition: 'opacity 120ms var(--ease-out)',
                  }}
                  aria-busy={membersQuery.isFetching || undefined}
                >
                  {membersQuery.isLoading ? (
                    // Skeleton rows that mirror the real member-result layout (name +
                    // phone on the left, points + tier chip on the right). Shown only on
                    // the first search — later keystrokes keep the previous results.
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)',
                        padding: '10px var(--space-3)', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                      }}>
                        <div style={{ display: 'grid', gap: 'var(--space-2)', flex: 1 }}>
                          <Skeleton width="55%" height="var(--space-3)" />
                          <Skeleton width="38%" height={10} />
                        </div>
                        <Skeleton width={54} height={24} radius="var(--radius-pill)" />
                      </div>
                    ))
                  ) : (membersQuery.data?.items.length ?? 0) === 0 ? (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>ไม่พบสมาชิกชื่อนี้ ลองค้นหาด้วยเบอร์โทร</div>
                  ) : (
                    (membersQuery.data?.items ?? []).map((acc) => (
                      <button key={acc.id} onClick={() => selectFromNameResult(acc)} disabled={lookup.isPending}
                        className="tap tap-pay"
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)',
                          padding: '8px var(--space-3)', borderRadius: 'var(--radius-md)', textAlign: 'left', cursor: 'pointer',
                          border: 'var(--hairline)', background: 'var(--color-surface)',
                        }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.customer_name}</div>
                          <div className="num" style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>{acc.phone ? formatPhone(acc.phone) : '—'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <div style={{ textAlign: 'right' }}>
                            {/* 20px/800: large text, so caramel-600 clears the 3:1 large-text floor. */}
                            <div className="num" style={{ fontSize: 'var(--fs-h2)', lineHeight: 'var(--lh-tight)', fontWeight: 800, color: 'var(--color-accent-600)' }}>{acc.points_balance.toLocaleString()}</div>
                            <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>แต้ม</div>
                          </div>
                          <Tag tone={TIER_TONE[acc.tier]}>{TIER_LABEL[acc.tier]}</Tag>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}

          {/* ── REGISTER PHASE ── */}
          {phase === 'register' && (
            <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
              {fromMiss && (
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', background: 'var(--color-info-50)', padding: '10px 12px', borderRadius: 8 }}>
                  ไม่พบสมาชิกสำหรับเบอร์นี้ — สมัครใหม่ได้เลย
                </div>
              )}
              <div>
                <label htmlFor="reg-name" style={LABEL}>ชื่อ *</label>
                <input id="reg-name" value={regName} onChange={(e) => setRegName(e.target.value)} required aria-required="true" className={IS_CLASS} style={IS} placeholder="ชื่อ-นามสกุล" />
              </div>
              <div>
                <label htmlFor="reg-dob" style={LABEL}>วันเกิด (ไม่บังคับ)</label>
                <input id="reg-dob" value={regDob} onChange={(e) => setRegDob(e.target.value)} type="date" className={IS_CLASS} style={IS} />
                <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-muted)', marginTop: 4 }}>ใช้สำหรับโบนัสวันเกิด</div>
              </div>
            </div>
          )}

          {/* ── MEMBER FOUND ── */}
          {phase === 'lookup' && result?.found && result.account && (
            <div style={{ marginTop: 18 }}>
              <div style={{ background: 'var(--color-surface-2)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700 }}>{result.account.customer_name}</div>
                  <Tag tone={TIER_TONE[result.account.tier]}>{TIER_LABEL[result.account.tier]}</Tag>
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>แต้มสะสม</div>
                    <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-accent-600)' }}>{result.account.points_balance.toLocaleString()}</div>
                  </div>
                  {result.points_to_next_reward != null && result.points_to_next_reward > 0 && (
                    <div>
                      <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>อีก..แต้มถึงรางวัล</div>
                      <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-secondary)' }}>{result.points_to_next_reward.toLocaleString()}</div>
                    </div>
                  )}
                </div>
              </div>

              {!result.program && (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 8 }}>
                  ยังไม่ได้ตั้งค่าโปรแกรมสะสมแต้ม
                </div>
              )}

              {/* Redeem is now offered in the POS "โปรโมชั่นที่ใช้ได้" panel, not here. */}
              {result.program && result.reward_redeemable && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-accent-600)', background: 'var(--color-accent-50)', borderRadius: 12, padding: '12px 14px' }}>
                  <Icon name="discount" size={18} />
                  <span>แต้มถึงเกณฑ์แลกรางวัลแล้ว — เลือกแลกได้ที่ปุ่ม “โปรโมชั่น” ในบิล</span>
                </div>
              )}

              {result.program && !result.reward_redeemable && (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 8 }}>
                  แต้มยังไม่ถึงเกณฑ์แลกรางวัล
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 'var(--space-3)', background: 'var(--color-surface-2)' }}>
          {phase === 'register' ? (
            <>
              <button onClick={() => { setPhase('lookup'); setFromMiss(false); }} className="tap" style={FOOT_GHOST}>ย้อนกลับ</button>
              <button onClick={doRegister} disabled={register.isPending || checkingName} className="tap" style={{ ...FOOT_BTN, flex: 1, background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 700, opacity: (register.isPending || checkingName) ? 0.7 : 1 }}>
                {(checkingName || register.isPending) && <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} />}
                {checkingName ? 'กำลังตรวจสอบ...' : register.isPending ? 'กำลังสมัคร...' : 'สมัครและแนบกับบิล'}
              </button>
            </>
          ) : result?.found && result.account ? (
            <button onClick={confirmAttach} className="tap" style={{ ...FOOT_BTN, flex: 1, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 700 }}>
              แนบสมาชิกกับบิล
            </button>
          ) : (
            <button onClick={onClose} className="tap" style={{ ...FOOT_GHOST, flex: 1 }}>ปิด</button>
          )}
        </div>
      </div>
    </div>
  );
}
