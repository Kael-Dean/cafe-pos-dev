'use client';

import { useState } from 'react';
import { useToast, Tag, baht } from '../app-common';
import Icon from '../icons';
import { SkeletonTable } from '@/components/ui/skeleton';
import { useFadeRise } from '@/lib/motion';
import { useI18n } from '@/lib/i18n';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { ApiError } from '@/lib/api-client';
import { useDeletedProducts, useRestoreProduct } from '@/hooks/use-products';
import { useDeletedInventory, useRestoreInventoryItem, type InventoryItem } from '@/hooks/use-inventory';

// Recycle bin = the deleted-items list + restore. "Delete" in this POS is a soft
// delete (is_active=false); nothing is ever hard-removed, so every row here can be
// restored. OWNER/MANAGER only — the backend enforces it and this screen gates too.
// Today: Products + Ingredients. Staff / Categories / Modifier groups / Customers
// share the identical contract and slot in as extra tabs once their BE ships.

type Tab = 'products' | 'inventory';

// ── Shared style helpers ──────────────────────────────────────────────────────
const restoreBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
  border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontWeight: 600,
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
};

export default function RecycleBin() {
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const screenRef = useFadeRise();
  const [tab, setTab] = useState<Tab>('products');

  if (me && !isAdmin(me.role)) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: 'var(--color-bg)' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{t.recycleBin.noAccess}</p>
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ['products', t.recycleBin.tabProducts],
    ['inventory', t.recycleBin.tabInventory],
  ];

  return (
    <div ref={screenRef} style={{ padding: 24, height: '100%', overflowY: 'auto', background: 'var(--color-bg)', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>{t.recycleBin.title}</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4, marginBottom: 0 }}>{t.recycleBin.subtitle}</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--color-surface-2)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer',
            background: tab === id ? 'var(--color-surface)' : 'transparent',
            color: tab === id ? 'var(--color-text)' : 'var(--color-text-secondary)',
            boxShadow: tab === id ? 'var(--shadow-xs)' : 'none',
            fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'products' ? <ProductsTab /> : <InventoryTab />}
    </div>
  );
}

// ── Products tab ──────────────────────────────────────────────────────────────
function ProductsTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: products, isLoading } = useDeletedProducts();
  const restore = useRestoreProduct();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);

  const doRestore = async (id: string, name: string) => {
    try {
      await restore.mutateAsync(id);
      toast({ kind: 'success', title: t.recycleBin.restored(name) });
      setTarget(null);
    } catch (e: unknown) {
      const is404 = e instanceof ApiError && e.status === 404;
      toast({
        kind: 'danger',
        title: is404 ? t.recycleBin.notFound : t.recycleBin.restoreFailed,
        msg: is404 ? undefined : String(e instanceof Error ? e.message : e),
      });
      setTarget(null); // list refetches via invalidation either way
    }
  };

  if (isLoading) {
    return (
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4) var(--space-5)' }}>
        <SkeletonTable rows={6} cols={3} label={t.common.loading} />
      </div>
    );
  }

  if (!products || products.length === 0) {
    return <EmptyBin label={t.recycleBin.emptyProducts} />;
  }

  return (
    <>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>
              <th style={thCss}>{t.recycleBin.colName}</th>
              <th style={{ ...thCss, textAlign: 'right' }}>{t.recycleBin.colPrice}</th>
              <th style={{ ...thCss, textAlign: 'right' }} aria-label={t.recycleBin.restore} />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={tdCss}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <Tag tone="danger">{t.common.delete}</Tag>
                  </div>
                </td>
                <td style={{ ...tdCss, textAlign: 'right' }} className="num">{baht(Number(p.price))}</td>
                <td style={{ ...tdCss, textAlign: 'right' }}>
                  <button onClick={() => setTarget({ id: p.id, name: p.name })} style={restoreBtnStyle} className="pressable">
                    <Icon name="refresh" size={14} />{t.recycleBin.restore}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <RestoreConfirmModal
          name={target.name}
          pending={restore.isPending}
          onConfirm={() => doRestore(target.id, target.name)}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

// ── Inventory tab ─────────────────────────────────────────────────────────────
function InventoryTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: items, isLoading } = useDeletedInventory();
  const restore = useRestoreInventoryItem();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);

  const doRestore = async (id: string, name: string) => {
    try {
      await restore.mutateAsync(id);
      toast({ kind: 'success', title: t.recycleBin.restored(name) });
      setTarget(null);
    } catch (e: unknown) {
      const is404 = e instanceof ApiError && e.status === 404;
      toast({
        kind: 'danger',
        title: is404 ? t.recycleBin.notFound : t.recycleBin.restoreFailed,
        msg: is404 ? undefined : String(e instanceof Error ? e.message : e),
      });
      setTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4) var(--space-5)' }}>
        <SkeletonTable rows={6} cols={3} label={t.common.loading} />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <EmptyBin label={t.recycleBin.emptyInventory} />;
  }

  return (
    <>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>
              <th style={thCss}>{t.recycleBin.colName}</th>
              <th style={{ ...thCss, textAlign: 'right' }}>{t.recycleBin.colStock}</th>
              <th style={{ ...thCss, textAlign: 'right' }} aria-label={t.recycleBin.restore} />
            </tr>
          </thead>
          <tbody>
            {items.map((it: InventoryItem) => (
              <tr key={it.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={tdCss}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{it.name}</span>
                    <Tag tone="danger">{t.common.delete}</Tag>
                  </div>
                </td>
                <td style={{ ...tdCss, textAlign: 'right' }} className="num">
                  {it.stock.toLocaleString()} {it.unit}
                </td>
                <td style={{ ...tdCss, textAlign: 'right' }}>
                  <button onClick={() => setTarget({ id: it.id, name: it.name })} style={restoreBtnStyle} className="pressable">
                    <Icon name="refresh" size={14} />{t.recycleBin.restore}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <RestoreConfirmModal
          name={target.name}
          pending={restore.isPending}
          onConfirm={() => doRestore(target.id, target.name)}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────
const thCss: React.CSSProperties = { padding: '12px 16px', fontWeight: 600 };
const tdCss: React.CSSProperties = { padding: '12px 16px', color: 'var(--color-text)' };

function EmptyBin({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
      <Icon name="trash" size={40} color="var(--color-border)" />
      <div style={{ marginTop: 12, fontSize: 15 }}>{label}</div>
    </div>
  );
}

function RestoreConfirmModal({ name, pending, onConfirm, onClose }: { name: string; pending: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 94vw)', padding: 24 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>{t.recycleBin.restoreConfirmTitle}</h3>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-secondary)' }}>{t.recycleBin.restoreConfirm(name)}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="pressable" style={ghostBtnStyle}>{t.common.cancel}</button>
          <button onClick={onConfirm} disabled={pending} className="pressable" style={{ ...restoreBtnStyle, padding: '8px 16px', fontSize: 13, opacity: pending ? 0.6 : 1 }}>
            {pending ? t.recycleBin.restoring : t.recycleBin.restore}
          </button>
        </div>
      </div>
    </div>
  );
}
