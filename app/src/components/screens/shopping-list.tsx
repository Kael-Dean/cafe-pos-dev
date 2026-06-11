'use client';

import { useEffect, useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useI18n } from '@/lib/i18n';
import { useStagger } from '@/lib/motion';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  useShoppingList, useAddToShoppingList, useRemoveFromShoppingList, usePatchShoppingListItem,
  type ShoppingListItem,
} from '@/hooks/use-shopping-list';
import { useInventory } from '@/hooks/use-inventory';

/** Display amount with up to 3 decimals and thousands separators (e.g. 1,250 / 3.5). */
const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function ShoppingListScreen() {
  const toast = useToast();
  const { t } = useI18n();
  const [addOpen, setAddOpen] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addNote, setAddNote] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [invFocused, setInvFocused] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useShoppingList();
  const { data: invItems = [] } = useInventory(invSearch || undefined);
  const addMut = useAddToShoppingList();
  const removeMut = useRemoveFromShoppingList();

  const selectedInvUnit = invItems.find(it => it.id === addItemId)?.unit ?? '';

  // List rows fade+rise in once the data arrives. Re-keyed on count so adding /
  // removing an item replays the entrance. Honors reduced-motion via the hook.
  const listRef = useStagger({ selector: ':scope > *', each: 0.03 });

  const resetAddForm = () => {
    setAddOpen(false);
    setAddItemId('');
    setAddQty('');
    setAddNote('');
    setInvSearch('');
    setInvFocused(false);
  };

  const handleAdd = async () => {
    if (!addItemId) return;
    const qty = addQty.trim();
    const qtyNum = Number(qty);
    if (qty && (Number.isNaN(qtyNum) || qtyNum < 0)) {
      toast({ kind: 'warning', title: t.shoppingList.invalidQty });
      return;
    }
    try {
      await addMut.mutateAsync({
        inventory_item_id: addItemId,
        quantity: qty ? qty : undefined,
        note: addNote.trim() || undefined,
      });
      resetAddForm();
      toast({ kind: 'success', title: t.shoppingList.added });
    } catch (err) {
      toast({ kind: 'danger', title: t.common.error, msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleRemove = async (item: ShoppingListItem) => {
    setRemovingId(item.id);
    try {
      await removeMut.mutateAsync(item.id);
      toast({ kind: 'success', title: t.shoppingList.removed(item.inventoryItemName) });
    } catch (err) {
      toast({ kind: 'danger', title: t.shoppingList.removeFailed, msg: err instanceof Error ? err.message : undefined });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.shoppingList.title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => window.open('/api/v1/shopping-list/print', '_blank')}
            className="pressable"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', minHeight: 44, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
          >
            <Icon name="print" size={16} />
            {t.shoppingList.printList}
          </button>
          <button
            onClick={() => setAddOpen(v => !v)}
            className="pressable"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', minHeight: 44, borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            <Icon name="plus" size={16} />
            {t.shoppingList.addItem}
          </button>
        </div>
      </div>

      {/* Inline add form */}
      {addOpen && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {/* Ingredient search */}
            <div
              style={{ flex: 2, minWidth: 200, position: 'relative' }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setInvFocused(false);
                  setTimeout(() => { if (!addItemId) setInvSearch(''); }, 150);
                }
              }}
            >
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{t.shoppingList.ingredient}</label>
              <input
                placeholder={t.shoppingList.searchPlaceholder}
                value={invSearch}
                onFocus={() => setInvFocused(true)}
                onChange={e => { setInvSearch(e.target.value); setAddItemId(''); }}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, background: 'var(--color-bg)', boxSizing: 'border-box' }}
              />
              {invFocused && invItems.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)', zIndex: 20, maxHeight: 180, overflowY: 'auto', marginTop: 2, boxShadow: 'var(--shadow-md)' }}>
                  {invItems.slice(0, 8).map(it => (
                    <div
                      key={it.id}
                      onMouseDown={(e) => { e.preventDefault(); setAddItemId(it.id); setInvSearch(it.name); setInvFocused(false); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', background: 'transparent' }}
                    >
                      <span>{it.name}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{it.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Quantity (optional override) */}
            <div style={{ flex: 1, minWidth: 110 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{t.shoppingList.qtyOptional}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder={t.shoppingList.auto}
                  value={addQty}
                  onChange={e => setAddQty(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, background: 'var(--color-bg)', boxSizing: 'border-box' }}
                />
                {selectedInvUnit && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{selectedInvUnit}</span>}
              </div>
            </div>
            {/* Note */}
            <div style={{ flex: 3, minWidth: 160 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>{t.shoppingList.noteOptional}</label>
              <input
                placeholder={t.shoppingList.notePlaceholder}
                value={addNote}
                onChange={e => setAddNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                maxLength={255}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, background: 'var(--color-bg)', boxSizing: 'border-box' }}
              />
            </div>
            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAdd}
                disabled={!addItemId || addMut.isPending}
                className="pressable"
                style={{ padding: '8px 16px', minHeight: 44, borderRadius: 7, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 13, cursor: (!addItemId || addMut.isPending) ? 'not-allowed' : 'pointer', opacity: (!addItemId || addMut.isPending) ? 0.5 : 1 }}
              >
                {addMut.isPending ? t.shoppingList.adding : t.common.add}
              </button>
              <button
                onClick={resetAddForm}
                disabled={addMut.isPending}
                className="pressable"
                style={{ padding: '8px 12px', minHeight: 44, borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4)' }}>
          <SkeletonTable rows={6} cols={3} header={false} label={t.common.loading} />
        </div>
      ) : items.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-text-secondary)' }}>
          <Icon name="cart" size={40} color="var(--color-border-strong)" />
          <div style={{ marginTop: 12, fontSize: 14 }}>{t.shoppingList.empty}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{t.shoppingList.emptyHint}</div>
        </div>
      ) : (
        <div key={items.length} ref={listRef} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
          {items.map((item, idx) => (
            <ShoppingRow
              key={item.id}
              item={item}
              isLast={idx === items.length - 1}
              removing={removingId === item.id}
              onRemove={() => handleRemove(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single row — shows the buy amount, editable, with reset-to-suggested ─────────
function ShoppingRow({ item, isLast, removing, onRemove }: {
  item: ShoppingListItem;
  isLast: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const toast = useToast();
  const { t } = useI18n();
  const patch = usePatchShoppingListItem();

  const isOverride = item.quantity != null;
  const effective = item.quantity ?? item.suggestedQty;

  const [draft, setDraft] = useState(String(effective));
  const [focused, setFocused] = useState(false);

  // Keep the input in sync with server-side recomputation (suggestion changes as
  // pre-orders / stock move) — but never clobber what the user is mid-typing.
  useEffect(() => {
    if (!focused) setDraft(String(effective));
  }, [effective, focused]);

  const commit = async () => {
    setFocused(false);
    const trimmed = draft.trim();
    const n = Number(trimmed);
    if (trimmed === '' || Number.isNaN(n) || n < 0) {
      setDraft(String(effective)); // revert invalid input
      return;
    }
    if (n === effective) return;   // no real change
    try {
      await patch.mutateAsync({ itemId: item.id, quantity: n });
    } catch (err) {
      toast({ kind: 'danger', title: t.shoppingList.saveQtyFailed, msg: err instanceof Error ? err.message : undefined });
      setDraft(String(effective));
    }
  };

  const resetToSuggested = async () => {
    try {
      await patch.mutateAsync({ itemId: item.id, quantity: null });
    } catch (err) {
      toast({ kind: 'danger', title: t.shoppingList.resetFailed, msg: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12,
        borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
      }}
    >
      {/* Name + note */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{item.inventoryItemName}</span>
          {isOverride ? (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-50)', padding: '1px 7px', borderRadius: 999 }}>
              {t.shoppingList.overrideTag}
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', background: 'var(--color-surface-2)', padding: '1px 7px', borderRadius: 999 }}>
              {t.shoppingList.suggestedTag}
            </span>
          )}
        </div>
        {item.note && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{item.note}</div>
        )}
        {isOverride && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {t.shoppingList.suggestionLabel(fmtQty(item.suggestedQty), item.unit)}
          </div>
        )}
      </div>

      {/* Editable buy amount */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <input
          type="number"
          min={0}
          step="any"
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          disabled={patch.isPending}
          aria-label={t.shoppingList.qtyAria(item.inventoryItemName)}
          style={{
            width: 84, padding: '7px 10px', borderRadius: 7, fontSize: 14, fontWeight: 600,
            textAlign: 'right', boxSizing: 'border-box', background: 'var(--color-bg)',
            border: `1px solid ${isOverride ? 'var(--color-primary)' : 'var(--color-border)'}`,
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', minWidth: 28 }}>{item.unit}</span>

        {/* Reset to suggested — only when overridden */}
        <button
          onClick={resetToSuggested}
          disabled={!isOverride || patch.isPending}
          title={t.shoppingList.resetTitle}
          aria-label={t.shoppingList.resetTitle}
          className="icon-btn hit-44"
          style={{
            width: 32, height: 32, borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'transparent', display: 'grid', placeItems: 'center',
            cursor: isOverride ? 'pointer' : 'default', color: 'var(--color-text-secondary)',
            opacity: isOverride ? 1 : 0.3,
          }}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        disabled={removing}
        aria-label={`${t.common.remove} ${item.inventoryItemName}`}
        className="icon-btn hit-44"
        style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--color-text-secondary)', flexShrink: 0 }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
