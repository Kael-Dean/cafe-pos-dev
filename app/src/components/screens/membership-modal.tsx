'use client';

import { useState, useEffect, useRef } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import {
  useLookupMember,
  useRegisterMember,
  useMembers,
  type AccountRead,
  type LookupResponse,
  type RewardProductRead,
  type MembershipTier,
} from '@/hooks/use-membership';

/** What the POS keeps once a member is attached to the bill. */
export interface MemberInfo {
  account: AccountRead;
  program: LookupResponse['program'];
  redeemReward: boolean;
  rewardProduct: RewardProductRead | null;
}

const TIER_LABEL: Record<MembershipTier, string> = {
  NONE: 'สมาชิก', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
};
const TIER_TONE: Record<MembershipTier, 'neutral' | 'success' | 'info' | 'accent'> = {
  NONE: 'neutral', BRONZE: 'success', SILVER: 'info', GOLD: 'accent',
};

const REWARD_DESC: Record<string, string> = {
  DISCOUNT_FIXED: 'ส่วนลดเป็นจำนวนเงิน',
  DISCOUNT_PERCENT: 'ส่วนลดเป็นเปอร์เซ็นต์',
  FREE_ITEM: 'รับฟรี 1 รายการ',
};

const IS: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  color: 'var(--color-text)', fontSize: 14, outline: 'none',
};

interface Props {
  onClose: () => void;
  onSelectMember: (info: MemberInfo) => void;
  /** Open straight into the register form (e.g. the POS "สมัครสมาชิก" button). Defaults to lookup. */
  initialPhase?: 'lookup' | 'register';
}

export default function MembershipModal({ onClose, onSelectMember, initialPhase = 'lookup' }: Props) {
  const toast = useToast();
  const lookup = useLookupMember();
  const register = useRegisterMember();

  const [phase, setPhase] = useState<'lookup' | 'register'>(initialPhase);
  // True only when the register phase was reached via a failed phone lookup — drives the
  // "ไม่พบสมาชิกสำหรับเบอร์นี้" hint, which would be misleading when opening register directly.
  const [fromMiss, setFromMiss] = useState(false);
  const [searchMode, setSearchMode] = useState<'phone' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [redeem, setRedeem] = useState(false);
  const [rewardProduct, setRewardProduct] = useState<RewardProductRead | null>(null);
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
    setRedeem(false);
    setRewardProduct(null);
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
      onSelectMember({ account: acc, program: null, redeemReward: false, rewardProduct: null });
      return;
    }
    try {
      const res = await lookup.mutateAsync(acc.phone);
      if (res.found && res.account) {
        setPhone(acc.phone);
        setResult(res);
        setRedeem(false);
        setRewardProduct(null);
      } else {
        onSelectMember({ account: acc, program: null, redeemReward: false, rewardProduct: null });
      }
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    }
  };

  // register form
  const [regName, setRegName] = useState('');
  const [regDob, setRegDob] = useState('');

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
      setRedeem(false);
      setRewardProduct(null);
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
      const account = await register.mutateAsync({
        name: regName.trim(),
        phone: phone.trim(),
        date_of_birth: regDob || undefined,
      });
      toast({ kind: 'success', title: 'สมัครสมาชิกแล้ว', msg: account.customer_name });
      // New member has no points yet → attach without redeem.
      onSelectMember({ account, program: null, redeemReward: false, rewardProduct: null });
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    }
  };

  const confirmAttach = () => {
    if (!result?.account) return;
    const wantsFreeItem = redeem && result.program?.reward_type === 'FREE_ITEM';
    if (wantsFreeItem && !rewardProduct) {
      toast({ kind: 'warning', title: 'เลือกสินค้าที่จะแลกฟรี' });
      return;
    }
    onSelectMember({
      account: result.account,
      program: result.program,
      redeemReward: redeem,
      rewardProduct: redeem ? rewardProduct : null,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{
        width: 'min(480px, 92vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-accent-50)', color: 'var(--color-accent-600)', display: 'grid', placeItems: 'center' }}>
            <Icon name="user" size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{phase === 'register' ? 'สมัครสมาชิกใหม่' : 'สมาชิก / สะสมแต้ม'}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{phase === 'register' ? 'กรอกข้อมูลเพื่อสมัครสมาชิก' : searchMode === 'name' ? 'ค้นหาด้วยชื่อสมาชิก' : 'ค้นหาด้วยเบอร์โทรศัพท์'}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {/* Search-mode toggle (lookup only) */}
          {phase === 'lookup' && (
            <div style={{ display: 'flex', gap: 6, background: 'var(--color-surface-2)', padding: 4, borderRadius: 10, marginBottom: 14, width: 'fit-content' }}>
              {([['phone', 'เบอร์โทร'], ['name', 'ชื่อ']] as const).map(([m, label]) => (
                <button key={m} onClick={() => switchMode(m)}
                  style={{
                    padding: '6px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: searchMode === m ? 'var(--color-surface)' : 'transparent',
                    color: searchMode === m ? 'var(--color-text)' : 'var(--color-text-secondary)',
                    boxShadow: searchMode === m ? 'var(--shadow-xs)' : 'none',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Phone field — phone mode, or always while registering */}
          {(searchMode === 'phone' || phase === 'register') && (
            <>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>เบอร์โทรศัพท์</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value.replace(/[^\d]/g, '')); if (result) setResult(null); }}
                  inputMode="numeric"
                  placeholder="08XXXXXXXX"
                  style={IS}
                  onKeyDown={(e) => { if (e.key === 'Enter' && phase === 'lookup') doLookup(); }}
                />
                {phase === 'lookup' && (
                  <button onClick={doLookup} disabled={lookup.isPending}
                    style={{ padding: '10px 18px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    {lookup.isPending ? '...' : 'ค้นหา'}
                  </button>
                )}
              </div>
            </>
          )}

          {/* Name field + results — name mode (lookup) */}
          {searchMode === 'name' && phase === 'lookup' && (
            <>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อสมาชิก</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={nameInput}
                  onChange={(e) => { setNameInput(e.target.value); if (result) setResult(null); }}
                  placeholder="ชื่อ หรือบางส่วนของชื่อ"
                  style={IS}
                  onKeyDown={(e) => { if (e.key === 'Enter') doNameSearch(); }}
                  autoFocus
                />
                <button onClick={doNameSearch} disabled={membersQuery.isFetching}
                  style={{ padding: '10px 18px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                  {membersQuery.isFetching ? '...' : 'ค้นหา'}
                </button>
              </div>

              {submittedName && !result?.found && (
                <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                  {membersQuery.isFetching ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 8 }}>กำลังค้นหา…</div>
                  ) : (membersQuery.data?.items.length ?? 0) === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 8 }}>ไม่พบสมาชิกชื่อนี้ — ลองค้นหาด้วยเบอร์โทร</div>
                  ) : (
                    (membersQuery.data?.items ?? []).map((acc) => (
                      <button key={acc.id} onClick={() => selectFromNameResult(acc)} disabled={lookup.isPending}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                          padding: '10px 12px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                          border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                        }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.customer_name}</div>
                          <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{acc.phone ?? '—'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div className="num" style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-accent-600)' }}>{acc.points_balance.toLocaleString()}</div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>แต้ม</div>
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
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', background: 'var(--color-info-50)', padding: '10px 12px', borderRadius: 8 }}>
                  ไม่พบสมาชิกสำหรับเบอร์นี้ — สมัครใหม่ได้เลย
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อ *</label>
                <input value={regName} onChange={(e) => setRegName(e.target.value)} style={IS} placeholder="ชื่อ-นามสกุล" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันเกิด (ไม่บังคับ)</label>
                <input value={regDob} onChange={(e) => setRegDob(e.target.value)} type="date" style={IS} />
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>ใช้สำหรับโบนัสวันเกิด</div>
              </div>
            </div>
          )}

          {/* ── MEMBER FOUND ── */}
          {phase === 'lookup' && result?.found && result.account && (
            <div style={{ marginTop: 18 }}>
              <div style={{ background: 'var(--color-surface-2)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{result.account.customer_name}</div>
                  <Tag tone={TIER_TONE[result.account.tier]}>{TIER_LABEL[result.account.tier]}</Tag>
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>แต้มสะสม</div>
                    <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-accent-600)' }}>{result.account.points_balance.toLocaleString()}</div>
                  </div>
                  {result.points_to_next_reward != null && result.points_to_next_reward > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>อีก..แต้มถึงรางวัล</div>
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

              {/* Redeem section */}
              {result.program && result.reward_redeemable && (
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={redeem} onChange={(e) => { setRedeem(e.target.checked); if (!e.target.checked) setRewardProduct(null); }} style={{ accentColor: 'var(--color-accent)', width: 18, height: 18 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>ใช้สิทธิ์แลกรางวัล</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        ใช้ {result.program.points_to_redeem.toLocaleString()} แต้ม · {REWARD_DESC[result.program.reward_type] ?? result.program.reward_type}
                      </div>
                    </div>
                  </label>

                  {redeem && result.program.reward_type === 'FREE_ITEM' && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>เลือกสินค้าที่จะแลกฟรี</div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {result.eligible_reward_products.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>สินค้าที่แลกได้: ทุกชิ้นในบิล (ระบบจะคำนวณตอนบันทึก)</div>
                        ) : result.eligible_reward_products.map((rp) => {
                          const selected = rewardProduct?.id === rp.id;
                          return (
                            <button key={rp.id} onClick={() => setRewardProduct(rp)}
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, textAlign: 'left',
                                border: `1.5px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                background: selected ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: selected ? 'white' : 'var(--color-text)', cursor: 'pointer',
                              }}>
                              <span>{rp.name}</span>
                              <span className="num">{baht(Number(rp.price))}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 10, background: 'var(--color-surface-2)' }}>
          {phase === 'register' ? (
            <>
              <button onClick={() => { setPhase('lookup'); setFromMiss(false); }} style={{ padding: '11px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, cursor: 'pointer' }}>ย้อนกลับ</button>
              <button onClick={doRegister} disabled={register.isPending} style={{ flex: 1, padding: '11px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {register.isPending ? 'กำลังสมัคร...' : 'สมัครและแนบกับบิล'}
              </button>
            </>
          ) : result?.found && result.account ? (
            <button onClick={confirmAttach} style={{ flex: 1, padding: '11px 18px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              {redeem ? 'แนบสมาชิก + แลกรางวัล' : 'แนบสมาชิกกับบิล'}
            </button>
          ) : (
            <button onClick={onClose} style={{ flex: 1, padding: '11px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, cursor: 'pointer' }}>ปิด</button>
          )}
        </div>
      </div>
    </div>
  );
}
