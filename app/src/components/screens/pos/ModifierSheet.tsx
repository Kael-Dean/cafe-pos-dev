'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../icons';
import { baht } from '../../app-common';
import { Button, Input, NumberField, Sheet, Skeleton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useModifierGroups, type ModifierGroup } from '@/hooks/use-modifier-groups';
import { useProductMods } from './use-product-mods';
import type { MenuItem } from '@/hooks/use-products';
import type { CartLine, NewCartLine } from '@/stores/cart-store';

/**
 * One sheet for both jobs (spec §2.2):
 *  - add  : a product with modifiers (required groups preselected; Enter = add),
 *           or a long-pressed tile (qty + note before adding);
 *  - edit : a cart line (qty, modifiers, note, remove) — the "Line sheet".
 *
 * There is NO fallback modifier list: if the product has no groups configured,
 * the sheet shows only qty + note. (The old modal invented S/M/L, milk and
 * sweetness options whose ids the server would reject.)
 */
export type ModifierTarget =
  | { mode: 'add'; item: MenuItem }
  | { mode: 'edit'; line: CartLine; item: MenuItem | null };

interface ModifierSheetProps {
  target: ModifierTarget | null;
  onClose: () => void;
  onConfirm: (line: NewCartLine, target: ModifierTarget) => void;
  onRemove: (key: string) => void;
}

export function ModifierSheet({ target, onClose, onConfirm, onRemove }: ModifierSheetProps) {
  const { t } = useI18n();
  const title = target
    ? (target.mode === 'add' ? target.item.name : target.line.name)
    : '';
  return (
    <Sheet
      open={target != null}
      onClose={onClose}
      title={title}
      description={target?.mode === 'edit' ? t.pos.editLineHint : undefined}
    >
      {target && (
        <ModifierBody
          key={target.mode === 'add' ? `add:${target.item.id}` : `edit:${target.line.key}`}
          target={target}
          onConfirm={onConfirm}
          onRemove={onRemove}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

type Selection = Record<string, string | string[]>;

function initialSelection(groups: ModifierGroup[], fromIds: string[] | null): Selection {
  const s: Selection = {};
  for (const g of groups) {
    if (g.type === 'radio') {
      const picked = fromIds ? g.options.find((o) => fromIds.includes(o.id)) : undefined;
      s[g.id] = (picked ?? g.options.find((o) => o.default) ?? g.options[0])?.id ?? '';
    } else {
      s[g.id] = fromIds ? g.options.filter((o) => fromIds.includes(o.id)).map((o) => o.id) : [];
    }
  }
  return s;
}

function ModifierBody({ target, onConfirm, onRemove, onClose }: {
  target: ModifierTarget;
  onConfirm: ModifierSheetProps['onConfirm'];
  onRemove: (key: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const productId = target.mode === 'add' ? target.item.id : target.line.menuId;
  const basePrice = target.mode === 'add' ? target.item.price : target.line.basePrice;
  const name = target.mode === 'add' ? target.item.name : target.line.name;

  const detail = useProductMods(productId);
  const all = useModifierGroups();

  const groups = useMemo<ModifierGroup[]>(() => {
    const ids = detail.data?.groupIds ?? [];
    if (!all.data || ids.length === 0) return [];
    return ids.map((id) => all.data.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g);
  }, [detail.data, all.data]);

  const loading = detail.isLoading || (all.isLoading && (detail.data?.groupIds.length ?? 0) > 0);
  const loadFailed = detail.isError || all.isError;

  const [sel, setSel] = useState<Selection | null>(null);
  // Lazily seed the selection once the groups are known (they arrive async).
  const selection = sel ?? (loading ? {} : initialSelection(groups, target.mode === 'edit' ? target.line.modIds : null));

  const [qty, setQty] = useState(target.mode === 'edit' ? target.line.qty : 1);
  const [note, setNote] = useState(target.mode === 'edit' ? target.line.note : '');

  const pickRadio = (gid: string, oid: string) => setSel({ ...selection, [gid]: oid });
  const toggleCheck = (gid: string, oid: string) => {
    const list = (selection[gid] as string[] | undefined) ?? [];
    setSel({ ...selection, [gid]: list.includes(oid) ? list.filter((x) => x !== oid) : [...list, oid] });
  };

  let delta = 0;
  const labels: string[] = [];
  const modIds: string[] = [];
  let modKey = '';
  for (const g of groups) {
    if (g.type === 'radio') {
      const o = g.options.find((x) => x.id === selection[g.id]);
      if (o) { delta += o.diff; labels.push(`${g.label} ${o.label}`); modIds.push(o.id); modKey += `${g.id}:${o.id};`; }
    } else {
      for (const oid of (selection[g.id] as string[] | undefined) ?? []) {
        const o = g.options.find((x) => x.id === oid);
        if (o) { delta += o.diff; labels.push(`+ ${o.label}`); modIds.push(o.id); modKey += `${g.id}:${o.id};`; }
      }
    }
  }
  const missing = groups.find((g) => g.required && g.type === 'check' && ((selection[g.id] as string[] | undefined) ?? []).length === 0);
  const unitPrice = basePrice + delta;

  const confirm = () => {
    if (missing || loading) return;
    onConfirm({
      menuId: productId, name, basePrice, unitPrice, qty,
      mods: labels, modIds, modKey, note: note.trim(),
    }, target);
  };

  const confirmLabel = target.mode === 'add' ? t.pos.addToBill : t.pos.saveLine;

  // Land on the primary action once options are ready, so Enter adds (spec §2.2).
  // Deferred one tick: the sheet's own focus-trap effect runs after this one.
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (loading) return;
    const id = window.setTimeout(() => confirmRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [loading]);

  return (
    <div
      className="pos-mod"
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        const el = e.target as HTMLElement;
        if (el.tagName === 'TEXTAREA' || (el.tagName === 'BUTTON' && !el.getAttribute('role'))) return;
        e.preventDefault();
        confirm();
      }}
    >
      {loading ? (
        <div className="pos-mod__skel" aria-busy="true">
          <span className="sr-only" role="status">{t.pos.loadingOptions}</span>
          {[0, 1].map((i) => (
            <div key={i} className="pos-mod__group">
              <Skeleton height={14} width={96} />
              <div className="pos-mod__opts">
                {[0, 1, 2].map((j) => <Skeleton key={j} height={56} radius="var(--radius-md)" />)}
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <p className="pos-mod__error" role="alert">
          <Icon name="warning" size={16} /> {t.pos.optionsLoadFailed}
        </p>
      ) : (
        groups.map((g) => (
          <fieldset key={g.id} className="pos-mod__group">
            <legend className="pos-mod__legend">
              {g.label}
              <span className="pos-mod__req">{g.required ? t.pos.required : g.type === 'check' ? t.pos.optionalMulti : t.pos.optional}</span>
            </legend>
            <div className="pos-mod__opts" role={g.type === 'radio' ? 'radiogroup' : 'group'} aria-label={g.label}>
              {g.options.map((o) => {
                const on = g.type === 'radio'
                  ? selection[g.id] === o.id
                  : ((selection[g.id] as string[] | undefined) ?? []).includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="pos-opt"
                    role={g.type === 'radio' ? 'radio' : 'checkbox'}
                    aria-checked={on}
                    onClick={() => (g.type === 'radio' ? pickRadio(g.id, o.id) : toggleCheck(g.id, o.id))}
                  >
                    <span className="pos-opt__label">{o.label}</span>
                    {o.diff !== 0 && <span className="pos-opt__diff num">{o.diff > 0 ? '+' : '-'}{baht(Math.abs(o.diff))}</span>}
                    {on && <Icon name="check" size={16} strokeWidth={2.25} className="pos-opt__check" />}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))
      )}

      <div className="pos-mod__row">
        <NumberField label={t.pos.qty} value={qty} onChange={setQty} min={1} max={99} integer size="lg" />
        <Input label={t.pos.lineNote} value={note} onChange={(e) => setNote(e.target.value)} maxLength={120}
          placeholder={t.pos.lineNotePlaceholder} size="lg" className="pos-mod__note" />
      </div>

      <div className="pos-mod__foot">
        {target.mode === 'edit' && (
          <Button variant="danger" size="lg" icon={<Icon name="trash" size={18} />}
            onClick={() => { onRemove(target.line.key); onClose(); }}>
            {t.pos.removeLine}
          </Button>
        )}
        <Button ref={confirmRef} variant="primary" size="xl" fullWidth kbd="Enter" onClick={confirm}
          disabled={!!missing || loading}
          disabledReason={missing ? t.pos.pickRequired(missing.label) : undefined}
          trailing={<span className="ui-btn__amount">{baht(unitPrice * qty)}</span>}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
