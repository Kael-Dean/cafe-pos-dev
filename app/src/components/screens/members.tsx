'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  useMembers,
  useMemberDetail,
  useAdjustPoints,
  useRegisterMember,
  type MembershipTier,
  type PointTxType,
} from '@/hooks/use-membership';

const TIER_LABEL: Record<MembershipTier, string> = { NONE: 'สมาชิก', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold' };
const TIER_TONE: Record<MembershipTier, 'neutral' | 'success' | 'info' | 'accent'> = { NONE: 'neutral', BRONZE: 'success', SILVER: 'info', GOLD: 'accent' };

const TX_LABEL: Record<PointTxType, string> = { EARN: 'ได้รับ', REDEEM: 'แลกรางวัล', ADJUST: 'ปรับแต้ม', EXPIRE: 'หมดอายุ' };
const TX_TONE: Record<PointTxType, 'success' | 'info' | 'accent' | 'danger'> = { EARN: 'success', REDEEM: 'info', ADJUST: 'accent', EXPIRE: 'danger' };

const IS: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14,
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
const fmtDateTime = (s: string) => new Date(s).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function MembersScreen() {
  const { data: me } = useCurrentUser();
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState<{ name?: string; phone?: string }>({});
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const limit = 50;
  const { data, isLoading } = useMembers({ ...query, page, limit });

  if (!isAdmin(me?.role)) {
    return <div style={{ padding: 32, color: 'var(--color-text-muted)' }}>เฉพาะผู้จัดการหรือเจ้าของร้านเท่านั้น</div>;
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

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>สมาชิก / Members</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการสมาชิกสะสมแต้มและประวัติแต้ม · ทั้งหมด {total.toLocaleString()} คน</div>
        </div>
        <button onClick={() => setShowRegister(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <Icon name="plus" size={16} /> สมัครสมาชิก
        </button>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, maxWidth: 460 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 10, left: 12, color: 'var(--color-text-muted)' }}><Icon name="search" size={16} /></div>
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            placeholder="ค้นหาด้วยชื่อ หรือเบอร์โทร..." style={{ ...IS, paddingLeft: 36 }} />
        </div>
        <button onClick={runSearch} style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>ค้นหา</button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ color: 'var(--color-text-secondary)', padding: 20 }}>กำลังโหลด...</div>
      ) : members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
          <Icon name="customers" size={40} color="var(--color-border)" />
          <div style={{ marginTop: 12, fontSize: 15 }}>ไม่พบสมาชิก</div>
        </div>
      ) : (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-2)', textAlign: 'left' }}>
                <th style={th}>ชื่อ</th>
                <th style={th}>เบอร์โทร</th>
                <th style={{ ...th, textAlign: 'right' }}>แต้มคงเหลือ</th>
                <th style={{ ...th, textAlign: 'right' }}>สะสมตลอดชีพ</th>
                <th style={th}>ระดับ</th>
                <th style={th}></th>
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
                  <td style={td}><Tag tone={TIER_TONE[m.tier]}>{TIER_LABEL[m.tier]}</Tag></td>
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
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn(page <= 1)}>ก่อนหน้า</button>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>หน้า {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pageBtn(page >= totalPages)}>ถัดไป</button>
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
  const qc = useQueryClient();
  const register = useRegisterMember();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');

  const submit = async () => {
    if (!name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อสมาชิก' }); return; }
    if (!phone.trim()) { toast({ kind: 'warning', title: 'กรอกเบอร์โทร' }); return; }
    try {
      const account = await register.mutateAsync({ name: name.trim(), phone: phone.trim(), date_of_birth: dob || undefined });
      await qc.invalidateQueries({ queryKey: ['membership', 'members'] });
      toast({ kind: 'success', title: 'สมัครสมาชิกแล้ว', msg: account.customer_name });
      onRegistered(account);
    } catch (e: unknown) {
      // 409 when the phone is already a member — surfaced via ApiError.message.
      toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) });
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
            <div style={{ fontSize: 17, fontWeight: 700 }}>สมัครสมาชิกใหม่</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>กรอกข้อมูลเพื่อสมัครสมาชิกสะสมแต้ม</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'grid', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อ *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={IS} placeholder="ชื่อ-นามสกุล" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>เบอร์โทรศัพท์ *</label>
            <input value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" style={IS} placeholder="08XXXXXXXX"
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันเกิด (ไม่บังคับ)</label>
            <input value={dob} onChange={e => setDob(e.target.value)} type="date" style={IS} />
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>ใช้สำหรับโบนัสวันเกิด</div>
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 10, background: 'var(--color-surface-2)' }}>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={submit} disabled={register.isPending}
            style={{ flex: 1, padding: '11px 18px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {register.isPending ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberDetailModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const toast = useToast();
  const { data: member, isLoading } = useMemberDetail(accountId);
  const adjust = useAdjustPoints();
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');

  const submitAdjust = async () => {
    const d = Number(delta);
    if (!delta.trim() || Number.isNaN(d) || d === 0) { toast({ kind: 'warning', title: 'กรอกจำนวนแต้ม (+ เพิ่ม / - ลด)' }); return; }
    if (!note.trim()) { toast({ kind: 'warning', title: 'ต้องระบุเหตุผล' }); return; }
    try {
      await adjust.mutateAsync({ accountId, delta: d, note: note.trim() });
      toast({ kind: 'success', title: 'ปรับแต้มแล้ว' });
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
            <div style={{ fontSize: 17, fontWeight: 700 }}>{member?.customer_name ?? 'สมาชิก'}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }} className="num">{member?.phone ?? ''}</div>
          </div>
          {member && <Tag tone={TIER_TONE[member.tier]}>{TIER_LABEL[member.tier]}</Tag>}
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}><Icon name="x" size={18} /></button>
        </div>

        <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {isLoading || !member ? (
            <div style={{ color: 'var(--color-text-secondary)' }}>กำลังโหลด...</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <Stat label="แต้มคงเหลือ" value={member.points_balance.toLocaleString()} accent />
                <Stat label="สะสมตลอดชีพ" value={member.lifetime_points_earned.toLocaleString()} />
                <Stat label="สมัครเมื่อ" value={fmtDate(member.joined_at)} small />
              </div>

              {/* Adjust points */}
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>ปรับแต้มด้วยตนเอง</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input type="number" value={delta} onChange={e => setDelta(e.target.value)} placeholder="+/- แต้ม" style={{ ...IS, width: 120 }} />
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="เหตุผล (จำเป็น)" style={IS} />
                </div>
                <button onClick={submitAdjust} disabled={adjust.isPending}
                  style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  {adjust.isPending ? 'กำลังบันทึก...' : 'บันทึกการปรับแต้ม'}
                </button>
              </div>

              {/* History */}
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>ประวัติแต้มล่าสุด</div>
              {member.recent_transactions.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>ยังไม่มีประวัติ</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {member.recent_transactions.map(tx => (
                    <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface-2)' }}>
                      <Tag tone={TX_TONE[tx.type]}>{TX_LABEL[tx.type]}</Tag>
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

function Stat({ label, value, accent, small }: { label: string; value: string; accent?: boolean; small?: boolean }) {
  return (
    <div style={{ flex: 1, background: 'var(--color-surface-2)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{label}</div>
      <div className="num" style={{ fontSize: small ? 15 : 22, fontWeight: 800, color: accent ? 'var(--color-accent-600)' : 'var(--color-text)' }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '11px 16px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' };
const td: React.CSSProperties = { padding: '11px 16px' };
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '7px 16px', borderRadius: 8, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)', opacity: disabled ? 0.5 : 1,
});
