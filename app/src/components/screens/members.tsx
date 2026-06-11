'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useI18n } from '@/lib/i18n';
import { useStagger } from '@/lib/motion';
import { SkeletonTable } from '@/components/ui/skeleton';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  useMembers,
  useMemberDetail,
  useMemberOrders,
  useAdjustPoints,
  useRegisterMember,
  isMemberNameTaken,
  type MembershipTier,
  type PointTxType,
  type OrderStatus,
} from '@/hooks/use-membership';

const TIER_TONE: Record<MembershipTier, 'neutral' | 'success' | 'info' | 'accent'> = { NONE: 'neutral', BRONZE: 'success', SILVER: 'info', GOLD: 'accent' };
const TX_TONE: Record<PointTxType, 'success' | 'info' | 'accent' | 'danger'> = { EARN: 'success', REDEEM: 'info', ADJUST: 'accent', EXPIRE: 'danger' };
const ORDER_STATUS_TONE: Record<OrderStatus, 'neutral' | 'success' | 'info' | 'accent' | 'warning' | 'danger'> = { PENDING: 'warning', PAID: 'success', IN_PROGRESS: 'info', READY: 'accent', COMPLETED: 'neutral', VOID: 'danger' };

const IS: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14,
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
const fmtDateTime = (s: string) => new Date(s).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function MembersScreen() {
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState<{ name?: string; phone?: string }>({});
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const limit = 50;
  const { data, isLoading } = useMembers({ ...query, page, limit });

  if (!isAdmin(me?.role)) {
    return <div style={{ padding: 32, color: 'var(--color-text-muted)' }}>{t.members.adminOnly}</div>;
  }

  const runSearch = () => {
    const v = searchInput.trim();
    setPage(1);
    if (!v) { setQuery({}); return; }
    // All-digits → phone search; otherwise name.
    setQuery(/^\d+$/.test(v) ? { phone: v } : { name: v });
  };

  const members = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Rows fade+rise in once per result set. Re-keyed on page/query so a fresh
  // search replays the entrance; subtle (8px, 40ms apart), honors reduced-motion.
  const rowsRef = useStagger({ selector: 'tbody tr', each: 0.03 });

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>{t.members.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.members.subtitle(total.toLocaleString())}</div>
        </div>
        <button onClick={() => setShowRegister(true)} className="pressable"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', minHeight: 44, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <Icon name="plus" size={16} /> {t.members.registerBtn}
        </button>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, maxWidth: 460 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 10, left: 12, color: 'var(--color-text-muted)' }}><Icon name="search" size={16} /></div>
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            placeholder={t.members.searchPlaceholder} style={{ ...IS, paddingLeft: 36 }} />
        </div>
        <button onClick={runSearch} className="pressable" style={{ padding: '9px 20px', minHeight: 44, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t.common.search}</button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4) var(--space-5)' }}>
          <SkeletonTable rows={8} cols={6} label={t.common.loading} />
        </div>
      ) : members.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
          <Icon name="customers" size={40} color="var(--color-border)" />
          <div style={{ marginTop: 12, fontSize: 15 }}>{t.members.notFound}</div>
        </div>
      ) : (
        <div key={`${page}-${query.name ?? ''}-${query.phone ?? ''}`} ref={rowsRef} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-2)', textAlign: 'left' }}>
                <th style={thCell}>{t.members.colName}</th>
                <th style={thCell}>{t.members.colPhone}</th>
                <th style={{ ...thCell, textAlign: 'right' }}>{t.members.colBalance}</th>
                <th style={{ ...thCell, textAlign: 'right' }}>{t.members.colLifetime}</th>
                <th style={thCell}>{t.members.colTier}</th>
                <th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} onClick={() => setSelectedId(m.id)} style={{ borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ ...td, fontWeight: 600 }}>{m.customer_name}</td>
                  <td style={{ ...td, color: 'var(--color-text-secondary)' }} className="num">{m.phone ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="num">{m.points_balance.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--color-text-secondary)' }} className="num">{m.lifetime_points_earned.toLocaleString()}</td>
                  <td style={td}><Tag tone={TIER_TONE[m.tier]}>{t.members.tier[m.tier]}</Tag></td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--color-text-muted)' }}><Icon name="chevronRight" size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 18 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn(page <= 1)}>{t.common.prev}</button>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.common.page} {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pageBtn(page >= totalPages)}>{t.common.next}</button>
        </div>
      )}

      {selectedId && <MemberDetailModal accountId={selectedId} onClose={() => setSelectedId(null)} />}
      {showRegister && (
        <RegisterMemberModal
          onClose={() => setShowRegister(false)}
          onRegistered={(account) => { setShowRegister(false); setSelectedId(account.id); }}
        />
      )}
    </div>
  );
}

function RegisterMemberModal({ onClose, onRegistered }: { onClose: () => void; onRegistered: (account: { id: string }) => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const register = useRegisterMember();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast({ kind: 'warning', title: t.members.enterName }); return; }
    if (!phone.trim()) { toast({ kind: 'warning', title: t.members.enterPhone }); return; }
    try {
      setChecking(true);
      if (await isMemberNameTaken(name)) {
        toast({ kind: 'warning', title: t.members.nameTaken, msg: t.members.nameTakenMsg });
        return;
      }
      const account = await register.mutateAsync({ name: name.trim(), phone: phone.trim(), date_of_birth: dob || undefined });
      await qc.invalidateQueries({ queryKey: ['membership', 'members'] });
      toast({ kind: 'success', title: t.members.registered, msg: account.customer_name });
      onRegistered(account);
    } catch (e: unknown) {
      // 409 when the phone is already a member — surfaced via ApiError.message.
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 94vw)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--color-accent-50)', color: 'var(--color-accent-600)', display: 'grid', placeItems: 'center' }}>
            <Icon name="user" size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{t.members.registerTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t.members.registerDesc}</div>
          </div>
          <button onClick={onClose} aria-label={t.common.cancel} className="icon-btn hit-44" style={{ width: 36, height: 36, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'grid', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{t.members.nameLabel}</label>
            <input value={name} onChange={e => setName(e.target.value)} style={IS} placeholder={t.members.namePlaceholder} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{t.members.phoneLabel}</label>
            <input value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" style={IS} placeholder="08XXXXXXXX"
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{t.members.dobLabel}</label>
            <input value={dob} onChange={e => setDob(e.target.value)} type="date" style={IS} />
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{t.members.dobHint}</div>
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 10, background: 'var(--color-surface-2)' }}>
          <button onClick={onClose} className="pressable" style={{ padding: '11px 18px', minHeight: 44, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, cursor: 'pointer' }}>{t.common.cancel}</button>
          <button onClick={submit} disabled={register.isPending || checking} className="pressable"
            style={{ flex: 1, padding: '11px 18px', minHeight: 44, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 700, fontSize: 14, cursor: (register.isPending || checking) ? 'not-allowed' : 'pointer', opacity: (register.isPending || checking) ? 0.6 : 1 }}>
            {checking ? t.members.checking : register.isPending ? t.members.registering : t.members.registerBtn}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberDetailModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const { data: member, isLoading } = useMemberDetail(accountId);
  const adjust = useAdjustPoints();
  const [tab, setTab] = useState<'points' | 'orders'>('points');
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');

  const submitAdjust = async () => {
    const d = Number(delta);
    if (!delta.trim() || Number.isNaN(d) || d === 0) { toast({ kind: 'warning', title: t.members.enterDelta }); return; }
    if (!note.trim()) { toast({ kind: 'warning', title: t.members.enterReason }); return; }
    try {
      await adjust.mutateAsync({ accountId, delta: d, note: note.trim() });
      toast({ kind: 'success', title: t.members.adjusted });
      setDelta(''); setNote('');
    } catch (e: unknown) {
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{member?.customer_name ?? t.members.memberFallback}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }} className="num">{member?.phone ?? ''}</div>
          </div>
          {member && <Tag tone={TIER_TONE[member.tier]}>{t.members.tier[member.tier]}</Tag>}
          <button onClick={onClose} aria-label={t.common.cancel} className="icon-btn hit-44" style={{ width: 36, height: 36, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}><Icon name="x" size={18} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: '1px solid var(--color-border)' }}>
          <TabButton active={tab === 'points'} onClick={() => setTab('points')}>{t.members.tabPoints}</TabButton>
          <TabButton active={tab === 'orders'} onClick={() => setTab('orders')}>{t.members.tabOrders}</TabButton>
        </div>

        <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {tab === 'orders' ? (
            <MemberOrdersTab accountId={accountId} />
          ) : isLoading || !member ? (
            <SkeletonTable rows={6} cols={3} header={false} label={t.common.loading} />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Stat label={t.members.statBalance} value={member.points_balance.toLocaleString()} accent />
                <Stat label={t.members.statLifetime} value={member.lifetime_points_earned.toLocaleString()} />
                <Stat label={t.members.statJoined} value={fmtDate(member.joined_at)} small />
              </div>

              {/* Adjust points */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t.members.adjustTitle}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input type="number" value={delta} onChange={e => setDelta(e.target.value)} placeholder={t.members.deltaPlaceholder} style={{ ...IS, width: 120 }} />
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder={t.members.reasonPlaceholder} style={IS} />
                </div>
                <button onClick={submitAdjust} disabled={adjust.isPending} className="pressable"
                  style={{ padding: '8px 18px', minHeight: 44, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 13, cursor: adjust.isPending ? 'not-allowed' : 'pointer', opacity: adjust.isPending ? 0.6 : 1 }}>
                  {adjust.isPending ? t.members.savingAdjust : t.members.saveAdjust}
                </button>
              </div>

              {/* History */}
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t.members.historyTitle}</div>
              {member.recent_transactions.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t.members.noHistory}</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {member.recent_transactions.map(tx => (
                    <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface-2)' }}>
                      <Tag tone={TX_TONE[tx.type]}>{t.members.tx[tx.type]}</Tag>
                      <div style={{ flex: 1, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {fmtDateTime(tx.created_at)}{tx.note ? ` · ${tx.note}` : ''}
                      </div>
                      <div className="num" style={{ fontWeight: 700, fontSize: 14, color: tx.delta < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                        {tx.delta > 0 ? `+${tx.delta}` : tx.delta}
                      </div>
                      <div className="num" style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 54, textAlign: 'right' }}>= {tx.balance_after.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '12px 8px', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: 'none', marginBottom: -1,
      color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
      borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
    }}>{children}</button>
  );
}

function MemberOrdersTab({ accountId }: { accountId: string }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading } = useMemberOrders(accountId, page, limit);

  if (isLoading) return <SkeletonTable rows={5} cols={2} header={false} label={t.common.loading} />;

  const orders = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (total === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
        <Icon name="cart" size={36} color="var(--color-border)" />
        <div style={{ marginTop: 10, fontSize: 14 }}>{t.members.noOrders}</div>
      </div>
    );
  }

  return (
    <>
      {/* Lifetime summary — aggregated across ALL orders, not just this page */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
        <Stat label={t.members.statTotalOrders} value={total.toLocaleString()} />
        <Stat label={t.members.statTotalSpent} value={baht(Number(data?.total_spent ?? 0))} accent />
        <Stat label={t.members.statTotalDiscount} value={baht(Number(data?.total_discount ?? 0))} />
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {orders.map(o => <OrderCard key={o.id} o={o} />)}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn(page <= 1)}>{t.common.prev}</button>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.common.page} {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pageBtn(page >= totalPages)}>{t.common.next}</button>
        </div>
      )}
    </>
  );
}

function OrderCard({ o }: { o: import('@/hooks/use-membership').MemberOrderRead }) {
  const { t } = useI18n();
  const discount = Number(o.discount);
  const earned = o.points_earned ?? 0; // null = predates membership → show as 0
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--color-surface-2)' }}>
        <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>#{o.order_number}</span>
        <Tag tone={ORDER_STATUS_TONE[o.status]}>{t.members.orderStatus[o.status]}</Tag>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{fmtDateTime(o.created_at)}</span>
      </div>
      <div style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Tag tone="neutral">{(t.members.channel as Record<string, string>)[o.channel] ?? o.channel}</Tag>
          {o.payment_method && <Tag tone="neutral">{(t.members.payment as Record<string, string>)[o.payment_method] ?? o.payment_method}</Tag>}
          {o.reward_redeemed && <Tag tone="info">{t.members.usedReward}</Tag>}
          {earned > 0 && <Tag tone="success">{t.members.pointsEarned(earned)}</Tag>}
        </div>
        <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          {o.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              <span className="num" style={{ width: 28, color: 'var(--color-text-muted)' }}>{it.quantity}×</span>
              <span style={{ flex: 1 }}>{it.product_name}</span>
              <span className="num">{baht(Number(it.line_total))}</span>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, display: 'grid', gap: 3, fontSize: 13 }}>
          <Row label={t.members.subtotalRow} value={baht(Number(o.subtotal))} muted />
          {discount > 0 && <Row label={t.members.discountRow} value={`-${baht(discount)}`} discount />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
            <span>{t.members.netRow}</span><span className="num">{baht(Number(o.total))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted, discount }: { label: string; value: string; muted?: boolean; discount?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: discount ? 'var(--color-danger)' : muted ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>
      <span>{label}</span><span className="num">{value}</span>
    </div>
  );
}

function Stat({ label, value, accent, small }: { label: string; value: string; accent?: boolean; small?: boolean }) {
  return (
    <div style={{ flex: 1, background: 'var(--color-surface-2)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{label}</div>
      <div className="num" style={{ fontSize: small ? 15 : 22, fontWeight: 800, color: accent ? 'var(--color-accent-600)' : 'var(--color-text)' }}>{value}</div>
    </div>
  );
}

const thCell: React.CSSProperties = { padding: '11px 16px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' };
const td: React.CSSProperties = { padding: '11px 16px' };
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '7px 16px', minHeight: 44, borderRadius: 8, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)', opacity: disabled ? 0.5 : 1,
});
