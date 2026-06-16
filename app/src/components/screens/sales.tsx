'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
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

const IS: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14,
};

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

  // Rows fade+rise in once per result set; honors reduced-motion.
  const rowsRef = useStagger({ selector: 'tbody tr', each: 0.03 });

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

  const list = salespeople ?? [];

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>{t.sales.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.sales.subtitle(list.length.toLocaleString())}</div>
        </div>
        <button onClick={() => { setIsAdding(true); setAddingName(''); }} className="pressable"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', minHeight: 44, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <Icon name="plus" size={16} /> {t.sales.addBtn}
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4) var(--space-5)' }}>
          <SkeletonTable rows={6} cols={2} label={t.common.loading} />
        </div>
      ) : (
        <div ref={rowsRef} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', maxWidth: 640 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-2)', textAlign: 'left' }}>
                <th style={thCell}>{t.sales.colName}</th>
                <th style={{ ...thCell, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map(sp => (
                <tr key={sp.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ ...td }}>
                    {editingId === sp.id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(sp.id); if (e.key === 'Escape') setEditingId(null); }}
                          style={{ ...IS, padding: '6px 10px', maxWidth: 280 }} />
                        <button onClick={() => handleRename(sp.id)} disabled={updateSales.isPending} className="pressable" style={btnSm('primary')}>{t.common.save}</button>
                        <button onClick={() => setEditingId(null)} className="pressable" style={btnSm('ghost')}>{t.common.cancel}</button>
                      </div>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{sp.name}</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {editingId !== sp.id && (
                      <>
                        <button onClick={() => { setEditingId(sp.id); setEditingName(sp.name); }} className="pressable" style={btnSm('ghost')}>
                          <Icon name="pencil" size={14} /> {t.common.edit}
                        </button>
                        <button onClick={() => setDeleteTarget(sp)} className="pressable" style={{ ...btnSm('ghost'), marginLeft: 6, color: 'var(--color-danger)' }}>
                          <Icon name="trash" size={14} /> {t.common.delete}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}

              {isAdding && (
                <tr style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-accent-50)' }}>
                  <td style={td} colSpan={2}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input autoFocus placeholder={t.sales.namePlaceholder} value={addingName} onChange={e => setAddingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsAdding(false); }}
                        style={{ ...IS, padding: '6px 10px', maxWidth: 280 }} />
                      <button onClick={handleCreate} disabled={!addingName.trim() || createSales.isPending} className="pressable" style={btnSm('primary')}>{t.sales.addBtn}</button>
                      <button onClick={() => setIsAdding(false)} className="pressable" style={btnSm('ghost')}>{t.common.cancel}</button>
                    </div>
                  </td>
                </tr>
              )}

              {list.length === 0 && !isAdding && (
                <tr>
                  <td colSpan={2} style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <Icon name="staff" size={36} color="var(--color-border)" />
                    <div style={{ marginTop: 10, fontSize: 14 }}>{t.sales.empty}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 'min(380px, 94vw)', padding: 24 }}>
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

// 409 on create/rename means the name is already taken.
function errTitle(err: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (err instanceof ApiError && err.status === 409) return t.sales.nameTaken;
  return t.sales.saveFailed;
}

const thCell: React.CSSProperties = { padding: '11px 16px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' };
const td: React.CSSProperties = { padding: '10px 16px' };

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
