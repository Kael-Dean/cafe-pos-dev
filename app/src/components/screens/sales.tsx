'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, baht } from '../app-common';
import { useI18n } from '@/lib/i18n';
import { useStagger } from '@/lib/motion';
import { SkeletonTable } from '@/components/ui/skeleton';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { ApiError } from '@/lib/api-client';
import {
  useSalespeople,
  useCreateSalesperson,
  useUpdateSalesperson,
  useDeleteSalesperson,
  type Salesperson,
} from '@/hooks/use-salespeople';
import { useSalespersonKpi, type KpiMember } from '@/hooks/use-salesperson-kpi';

const IS: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14,
};

// ── Date helpers ──────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const TODAY = ymd(new Date());
const MONTH_START = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
// First and last calendar day of the previous month.
const LAST_MONTH_START = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
const LAST_MONTH_END = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 0));

type Preset = 'month' | 'lastMonth' | 'today';
const PRESETS: { id: Preset; label: string; from: string; to: string }[] = [
  { id: 'month', label: 'เดือนนี้', from: MONTH_START, to: TODAY },
  { id: 'lastMonth', label: 'เดือนก่อน', from: LAST_MONTH_START, to: LAST_MONTH_END },
  { id: 'today', label: 'วันนี้', from: TODAY, to: TODAY },
];

export default function SalesScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: me } = useCurrentUser();

  const { data: salespeople, isLoading } = useSalespeople();
  const createSales = useCreateSalesperson();
  const updateSales = useUpdateSalesperson();
  const deleteSales = useDeleteSalesperson();

  const [isAdding, setIsAdding] = useState(false);
  const [addingName, setAddingName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Salesperson | null>(null);

  // KPI date range — defaults to the current month.
  const [from, setFrom] = useState(MONTH_START);
  const [to, setTo] = useState(TODAY);
  const { data: kpiMap, isLoading: kpiLoading, isError: kpiError } = useSalespersonKpi(from, to);
  const activePreset = PRESETS.find((p) => p.from === from && p.to === to)?.id ?? null;

  const [openSales, setOpenSales] = useState<Set<string>>(new Set());
  const toggleSales = (id: string) =>
    setOpenSales((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Cards fade+rise in once per result set; honors reduced-motion.
  const rowsRef = useStagger({ selector: '[data-sp-card]', each: 0.04 });

  if (me && !isAdmin(me.role)) {
    return <div style={{ padding: 32, color: 'var(--color-text-muted)' }}>{t.sales.adminOnly}</div>;
  }

  const handleCreate = async () => {
    const name = addingName.trim();
    if (!name) return;
    try {
      await createSales.mutateAsync(name);
      setIsAdding(false);
      setAddingName('');
      toast({ kind: 'success', title: t.sales.added });
    } catch (err) {
      toast({ kind: 'danger', title: errTitle(err, t), msg: err instanceof Error ? err.message : t.sales.tryAgain });
    }
  };

  const handleRename = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    try {
      await updateSales.mutateAsync({ id, name });
      setEditingId(null);
      toast({ kind: 'success', title: t.sales.renamed });
    } catch (err) {
      toast({ kind: 'danger', title: errTitle(err, t), msg: err instanceof Error ? err.message : t.sales.tryAgain });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSales.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast({ kind: 'success', title: t.sales.deleted });
    } catch (err) {
      setDeleteTarget(null);
      toast({ kind: 'danger', title: t.sales.deleteFailed, msg: err instanceof Error ? err.message : t.sales.tryAgain });
    }
  };

  const setRange = (f: string, tt: string) => { setFrom(f); setTo(tt); };
  const list = salespeople ?? [];

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>{t.sales.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            ยอดขายและ KPI ของเซลส์แต่ละคน · ทั้งหมด {list.length.toLocaleString()} คน
          </div>
        </div>
        <button onClick={() => { setIsAdding(true); setAddingName(''); }} className="pressable"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', minHeight: 44, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <Icon name="plus" size={16} /> {t.sales.addBtn}
        </button>
      </div>

      {/* Date range toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => setRange(p.from, p.to)} className="pressable"
            style={{
              padding: '7px 14px', minHeight: 38, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: '1px solid ' + (activePreset === p.id ? 'var(--color-primary)' : 'var(--color-border)'),
              background: activePreset === p.id ? 'var(--color-primary)' : 'var(--color-surface)',
              color: activePreset === p.id ? 'var(--color-text-inverse)' : 'var(--color-text)',
            }}>
            {p.label}
          </button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จาก</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
            style={{ ...IS, width: 'auto', padding: '7px 10px' }} />
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>ถึง</span>
          <input type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)}
            style={{ ...IS, width: 'auto', padding: '7px 10px' }} />
        </div>
      </div>

      {kpiError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: 'var(--color-danger-50)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}>
          โหลด KPI ไม่สำเร็จ — แสดงเฉพาะรายชื่อเซลส์ (ต้องเป็นผู้จัดการหรือเจ้าของจึงจะดู KPI ได้)
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4) var(--space-5)', maxWidth: 920 }}>
          <SkeletonTable rows={4} cols={3} label={t.common.loading} />
        </div>
      ) : (
        <div ref={rowsRef} style={{ display: 'grid', gap: 12, maxWidth: 920 }}>
          {list.map((sp) => (
            <SalespersonCard
              key={sp.id}
              sp={sp}
              kpi={kpiMap?.[sp.id]}
              kpiLoading={kpiLoading}
              open={openSales.has(sp.id)}
              onToggle={() => toggleSales(sp.id)}
              isEditing={editingId === sp.id}
              editingName={editingName}
              setEditingName={setEditingName}
              onStartEdit={() => { setEditingId(sp.id); setEditingName(sp.name); }}
              onCancelEdit={() => setEditingId(null)}
              onRename={() => handleRename(sp.id)}
              renamePending={updateSales.isPending}
              onDelete={() => setDeleteTarget(sp)}
            />
          ))}

          {isAdding && (
            <div data-sp-card style={{ background: 'var(--color-accent-50)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input autoFocus placeholder={t.sales.namePlaceholder} value={addingName} onChange={(e) => setAddingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsAdding(false); }}
                  style={{ ...IS, padding: '6px 10px', maxWidth: 280 }} />
                <button onClick={handleCreate} disabled={!addingName.trim() || createSales.isPending} className="pressable" style={btnSm('primary')}>{t.sales.addBtn}</button>
                <button onClick={() => setIsAdding(false)} className="pressable" style={btnSm('ghost')}>{t.common.cancel}</button>
              </div>
            </div>
          )}

          {list.length === 0 && !isAdding && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
              <Icon name="staff" size={36} color="var(--color-border)" />
              <div style={{ marginTop: 10, fontSize: 14 }}>{t.sales.empty}</div>
            </div>
          )}
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(380px, 94vw)', padding: 24 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>{t.sales.deleteTitle}</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-secondary)' }}>
              {t.sales.deleteConfirm} <strong>{deleteTarget.name}</strong>?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} className="pressable" style={btnSm('ghost')}>{t.common.cancel}</button>
              <button onClick={handleDelete} disabled={deleteSales.isPending} className="pressable" style={btnSm('danger')}>{t.common.delete}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Salesperson card ────────────────────────────────────────────────────────────
function SalespersonCard({
  sp, kpi, kpiLoading, open, onToggle,
  isEditing, editingName, setEditingName, onStartEdit, onCancelEdit, onRename, renamePending, onDelete,
}: {
  sp: Salesperson;
  kpi: import('@/hooks/use-salesperson-kpi').SalespersonKpi | undefined;
  kpiLoading: boolean;
  open: boolean;
  onToggle: () => void;
  isEditing: boolean;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: () => void;
  renamePending: boolean;
  onDelete: () => void;
}) {
  const memberCount = kpi?.memberCount ?? 0;
  const buyers = kpi?.buyingMemberCount ?? 0;
  const conv = memberCount > 0 ? Math.round((buyers / memberCount) * 100) : 0;
  const totalItems = kpi?.totalItems ?? 0;
  const totalValue = kpi?.totalValue ?? 0;

  // Only members who actually bought are worth listing; sort by spend.
  const buyingMembers = (kpi?.members ?? [])
    .filter((m) => m.orderCount > 0)
    .sort((a, b) => b.totalValue - a.totalValue);

  return (
    <div data-sp-card style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Top row: name + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onRename(); if (e.key === 'Escape') onCancelEdit(); }}
                style={{ ...IS, padding: '6px 10px', maxWidth: 280 }} />
              <button onClick={onRename} disabled={renamePending} className="pressable" style={btnSm('primary')}>บันทึก</button>
              <button onClick={onCancelEdit} className="pressable" style={btnSm('ghost')}>ยกเลิก</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-accent-50)', color: 'var(--color-primary)', fontWeight: 700, fontSize: 14 }}>
                {sp.name.slice(0, 1)}
              </span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{sp.name}</span>
            </div>
          )}
        </div>
        {!isEditing && (
          <div style={{ whiteSpace: 'nowrap' }}>
            <button onClick={onStartEdit} className="pressable" style={btnSm('ghost')}>
              <Icon name="pencil" size={14} /> แก้ไข
            </button>
            <button onClick={onDelete} className="pressable" style={{ ...btnSm('ghost'), marginLeft: 6, color: 'var(--color-danger)' }}>
              <Icon name="trash" size={14} /> ลบ
            </button>
          </div>
        )}
      </div>

      {/* Metrics strip — click to expand the member breakdown */}
      <button onClick={onToggle} className="pressable" aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer',
          borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'inherit', textAlign: 'left',
        }}>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          <Metric label="สมาชิกที่ดูแล" value={kpiLoading ? '…' : memberCount.toLocaleString()} />
          <Metric label="มาซื้อ" value={kpiLoading ? '…' : buyers.toLocaleString()} tone="success" />
          <Metric label="อัตราซื้อ" value={kpiLoading ? '…' : `${conv}%`} />
          <Metric label="จำนวนชิ้น" value={kpiLoading ? '…' : totalItems.toLocaleString()} />
          <Metric label="ยอดขายรวม" value={kpiLoading ? '…' : baht(totalValue)} tone="primary" />
        </div>
        <Icon name="chevronDown" size={18} color="var(--color-text-muted)"
          style={{ transition: 'transform .18s ease', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </button>

      {/* Member breakdown */}
      {open && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '6px 8px 10px' }}>
          {kpiLoading ? (
            <div style={{ padding: 16 }}><SkeletonTable rows={3} cols={4} /></div>
          ) : buyingMembers.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
              ยังไม่มีสมาชิกของเซลส์คนนี้มาซื้อในช่วงที่เลือก
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '6px 8px 10px' }}>
                มาซื้อ {buyers.toLocaleString()} จาก {memberCount.toLocaleString()} คน
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                    <th style={mTh}>สมาชิก</th>
                    <th style={mTh}>เบอร์</th>
                    <th style={{ ...mTh, textAlign: 'right' }}>ออเดอร์</th>
                    <th style={{ ...mTh, textAlign: 'right' }}>ชิ้น</th>
                    <th style={{ ...mTh, textAlign: 'right' }}>ยอดซื้อ</th>
                  </tr>
                </thead>
                <tbody>
                  {buyingMembers.map((m) => (
                    <MemberRow key={m.customerId} m={m} />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// One member row that expands to reveal what they bought.
function MemberRow({ m }: { m: KpiMember }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => setOpen((v) => !v)} style={{ borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}>
        <td style={mTd}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chevronDown" size={13} color="var(--color-text-muted)"
              style={{ transition: 'transform .18s ease', transform: open ? 'rotate(180deg)' : 'rotate(-90deg)' }} />
            <span style={{ fontWeight: 600 }}>{m.name}</span>
          </span>
        </td>
        <td style={{ ...mTd, color: 'var(--color-text-secondary)' }}>{m.phone || '—'}</td>
        <td style={{ ...mTd, textAlign: 'right' }}>{m.orderCount.toLocaleString()}</td>
        <td style={{ ...mTd, textAlign: 'right' }}>{m.totalItems.toLocaleString()}</td>
        <td style={{ ...mTd, textAlign: 'right', fontWeight: 700 }}>{baht(m.totalValue)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ padding: '4px 12px 12px 32px', background: 'var(--color-surface-2)' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '6px 0' }}>ซื้ออะไรบ้าง</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {m.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <span>{it.productName} <span style={{ color: 'var(--color-text-muted)' }}>× {it.quantity}</span></span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{baht(it.value)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'primary' | 'success' }) {
  const color =
    tone === 'primary' ? 'var(--color-primary)' : tone === 'success' ? 'var(--color-success)' : 'var(--color-text)';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

// 409 on create/rename means the name is already taken.
function errTitle(err: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (err instanceof ApiError && err.status === 409) return t.sales.nameTaken;
  return t.sales.saveFailed;
}

const mTh: React.CSSProperties = { padding: '6px 8px', fontSize: 11, fontWeight: 600 };
const mTd: React.CSSProperties = { padding: '8px' };

function btnSm(variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', minHeight: 36,
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: '1px solid transparent',
  };
  if (variant === 'primary') return { ...base, background: 'var(--color-primary)', color: 'var(--color-text-inverse)' };
  if (variant === 'danger') return { ...base, background: 'var(--color-danger)', color: '#fff' };
  return { ...base, background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' };
}
