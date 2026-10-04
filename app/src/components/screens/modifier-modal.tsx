'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Icon from '../icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useModifierGroups, type ModifierGroup } from '@/hooks/use-modifier-groups';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { haptic } from '@/lib/haptics';

// Fallback shown when the backend has no modifier groups configured
const FALLBACK_MODIFIERS: ModifierGroup[] = [
  {
    id: 'size', label: 'ขนาด', required: true, type: 'radio',
    options: [
      { id: 's', label: 'S',  diff: -5 },
      { id: 'm', label: 'M',  diff: 0, default: true },
      { id: 'l', label: 'L',  diff: 10 },
    ],
  },
  {
    id: 'milk', label: 'นม', required: true, type: 'radio',
    options: [
      { id: 'fresh',  label: 'นมสด',       diff: 0, default: true },
      { id: 'oat',    label: 'นมโอ๊ต',     diff: 10 },
      { id: 'almond', label: 'นมอัลมอนด์', diff: 15 },
      { id: 'skim',   label: 'นมพร่อง',    diff: 0 },
    ],
  },
  {
    id: 'sweet', label: 'ความหวาน', required: false, type: 'radio',
    options: [
      { id: 'no',  label: 'ไม่หวาน', diff: 0 },
      { id: 'low', label: 'น้อย',    diff: 0 },
      { id: 'std', label: 'ปกติ',    diff: 0, default: true },
      { id: 'much', label: 'มาก',    diff: 0 },
    ],
  },
  {
    id: 'addons', label: 'เพิ่มเติม', required: false, type: 'check',
    options: [
      { id: 'shot',  label: 'เพิ่มช็อต', diff: 15 },
      { id: 'whip',  label: 'วิปครีม',   diff: 10 },
      { id: 'pearl', label: 'มุก',       diff: 10 },
      { id: 'jelly', label: 'เยลลี่',   diff: 5  },
    ],
  },
];

interface MenuItem { id: string; name: string; nameEn: string; price: number; color: string; }
interface CartLine { menuId: string; name: string; basePrice: number; unitPrice: number; qty: number; mods: string[]; modIds: string[]; modKey: string; }
interface Props { item: MenuItem; onClose: () => void; onAdd: (line: CartLine) => void; groupIds?: string[]; }

export default function ModifierModal({ item, onClose, onAdd, groupIds }: Props) {
  const { data: apiGroups, isLoading } = useModifierGroups();
  const dialogRef = useModalA11y(onClose);

  const groups = (() => {
    if (!apiGroups || apiGroups.length === 0) return FALLBACK_MODIFIERS;
    if (groupIds && groupIds.length > 0) {
      const filtered = groupIds
        .map(id => apiGroups.find(g => g.id === id))
        .filter((g): g is ModifierGroup => g !== undefined);
      return filtered.length > 0 ? filtered : apiGroups;
    }
    return apiGroups;
  })();

  const buildDefaultSel = (gs: ModifierGroup[]) => {
    const s: Record<string, string | string[]> = {};
    gs.forEach((g) => {
      if (g.type === 'radio') {
        const def = g.options.find((o) => o.default) ?? g.options[0];
        s[g.id] = def?.id ?? '';
      } else {
        s[g.id] = [];
      }
    });
    return s;
  };

  const [sel, setSel] = useState<Record<string, string | string[]>>(() => buildDefaultSel(groups));
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  // Re-initialise selections when API groups load or a different product is opened
  const prevItemIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!apiGroups || apiGroups.length === 0) return;
    if (prevItemIdRef.current === item.id) return;
    prevItemIdRef.current = item.id;
    setSel(buildDefaultSel(groups));
  }, [apiGroups, item.id, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceDelta = useMemo(() => {
    let d = 0;
    groups.forEach((g) => {
      if (g.type === 'radio') {
        const o = g.options.find((x) => x.id === sel[g.id]);
        if (o) d += o.diff;
      } else {
        ((sel[g.id] as string[]) ?? []).forEach((oid) => {
          const o = g.options.find((x) => x.id === oid);
          if (o) d += o.diff;
        });
      }
    });
    return d;
  }, [sel, groups]);

  const unitPrice = item.price + priceDelta;

  const toggleCheck = (groupId: string, optionId: string) => {
    setSel((cur) => {
      const list = (cur[groupId] as string[]) ?? [];
      return { ...cur, [groupId]: list.includes(optionId) ? list.filter((x) => x !== optionId) : [...list, optionId] };
    });
  };

  const buildModLabels = () => {
    const labels: string[] = [];
    const modIds: string[] = [];
    let modKey = '';
    groups.forEach((g) => {
      if (g.type === 'radio') {
        const o = g.options.find((x) => x.id === sel[g.id]);
        if (o) {
          const isHiddenDefault = (g.id === 'sweet' && o.id === 'std') || (g.id === 'milk' && o.id === 'fresh');
          // Prefix the group name so the receipt reads "ความหวาน น้อย" instead of a
          // bare "น้อย" that gives no context about which attribute it refers to.
          if (!isHiddenDefault) labels.push(`${g.label} ${o.label}`);
          modKey += `${g.id}:${o.id};`;
          modIds.push(o.id);
        }
      } else {
        ((sel[g.id] as string[]) ?? []).forEach((oid) => {
          const o = g.options.find((x) => x.id === oid);
          if (o) {
            labels.push(`+ ${o.label}`);
            modKey += `${g.id}:${oid};`;
            modIds.push(oid);
          }
        });
      }
    });
    if (note.trim()) { labels.push(`หมายเหตุ: ${note.trim()}`); modKey += `note:${note.trim()};`; }
    return { labels, modKey, modIds };
  };

  const onConfirm = () => {
    const { labels, modKey, modIds } = buildModLabels();
    onAdd({
      menuId: item.id,
      name: item.name,
      basePrice: item.price,
      unitPrice,
      qty,
      mods: labels,
      modIds,
      modKey,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`ปรับแต่ง ${item.name}`}
        aria-busy={isLoading || undefined}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}
      >
        {/* .pad-phone: 16px gutters on phones — two 140px option columns still fit a 360px screen */}
        <div className="pad-phone" style={{padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexShrink: 0}}>
          {/* Flat product colour swatch (TOUCH-SPEC §3.2: no gradient placeholder). */}
          <div aria-hidden style={{
            width: 56, height: 56, borderRadius: 'var(--radius-lg)', flexShrink: 0, background: item.color,
          }} />
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontSize: 'var(--fs-title)', fontWeight: 700, lineHeight: 'var(--lh-tight)'}}>{item.name}</div>
            <div style={{fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)'}}>{item.nameEn} • ราคาเริ่มต้น <span className="num">฿{item.price}</span></div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="icon-btn tap-std tap-sq" style={{
            margin: '-8px -8px -8px 0', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={20}/>
          </button>
        </div>

        <div className="scroll pad-phone" style={{flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--space-5) var(--space-6)'}}>
          {isLoading ? (
            <ModifierGroupsSkeleton />
          ) : (
          <>
          {groups.map((g) => (
            <div key={g.id} style={{marginBottom: 22}}>
              <div style={{display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10}}>
                <div style={{fontSize: 'var(--fs-body)', fontWeight: 600}}>{g.label}</div>
                {g.required && <span style={{fontSize: 'var(--fs-cap)', color: 'var(--color-danger-fg)', fontWeight: 600}}>* จำเป็น</span>}
                {!g.required && <span style={{fontSize: 'var(--fs-cap)', color: 'var(--color-text-muted)'}}>ตัวเลือก</span>}
              </div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--tap-gap)'}}>
                {g.options.map((o) => {
                  const isSelected = g.type === 'radio' ? sel[g.id] === o.id : ((sel[g.id] as string[]) ?? []).includes(o.id);
                  const onPick = () => g.type === 'radio'
                    ? setSel((c) => ({ ...c, [g.id]: o.id }))
                    : toggleCheck(g.id, o.id);
                  return (
                    <button key={o.id} onClick={onPick}
                      aria-pressed={isSelected}
                      className="tap tap-lg"
                      style={{
                        padding: '0 var(--space-3)',
                        borderRadius: 'var(--radius-md)', textAlign: 'left',
                        background: isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
                        color: isSelected ? 'var(--color-text-inverse)' : 'var(--color-text)',
                        border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        fontSize: 'var(--fs-body)', fontWeight: 600,
                      }}
                    >
                      <OptionMark kind={g.type === 'radio' ? 'radio' : 'check'} on={isSelected} />
                      <span style={{flex: 1, minWidth: 0}}>{o.label}</span>
                      {o.diff !== 0 && (
                        <span className="num" style={{
                          fontSize: 'var(--fs-cap)', fontWeight: 600,
                          color: isSelected ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                        }}>{o.diff > 0 ? `+${o.diff}` : o.diff}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <div style={{fontSize: 'var(--fs-body)', fontWeight: 600, marginBottom: 'var(--space-2)'}}>หมายเหตุ <span style={{fontSize: 'var(--fs-cap)', fontWeight: 500, color: 'var(--color-text-muted)'}}>(ตัวเลือก)</span></div>
            <input type="text" placeholder="เช่น ไม่ใส่น้ำแข็ง, ใส่ในแก้วร้อน"
              value={note} onChange={(e) => setNote(e.target.value)}
              aria-label="หมายเหตุ"
              // Font size as a class, not an inline fontSize: on touch the global
              // 16px input rule (no iOS focus-zoom) has to win, and it cannot beat an inline style.
              className="input-std text-body"
              style={{
                width: '100%', padding: '10px var(--space-3)', minHeight: 'var(--tap-std)',
                background: 'var(--color-surface)', border: 'var(--hairline)',
                borderRadius: 'var(--radius-md)', outline: 'none',
                color: 'var(--color-text)', boxSizing: 'border-box',
              }}
            />
          </div>
          </>
          )}
        </div>

        {/* Phones: the row wraps — stepper + total first, then the add button on its
            own full-width row (it used to overlap the total at 390px). */}
        <div className="wrap-phone modmodal-foot" style={{padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'var(--color-surface-2)', borderRadius: '0 0 var(--radius-xl) var(--radius-xl)', flexShrink: 0}}>
          <style>{`@media (max-width: 767px) { .modmodal-foot { padding: 12px 16px !important; row-gap: 10px !important; } }`}</style>
          {/* One surface group: − qty + (TOUCH-SPEC §3.6: ± 56×56, value 20px tabular).
              ± act on pointerdown like the cash keypad (§4); keyboard clicks (detail 0) still work. */}
          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-1)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: 'var(--hairline)'}}>
            <button {...instantProps(() => setQty((q) => Math.max(1, q - 1)))} disabled={qty <= 1} aria-label="ลดจำนวน" className="icon-btn tap tap-lg tap-sq" style={{borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)', opacity: qty <= 1 ? 0.45 : 1}}><Icon name="minus" size={20}/></button>
            <div className="num" aria-live="polite" style={{minWidth: 36, textAlign: 'center', fontWeight: 700, fontSize: 'var(--fs-h2)'}}>{qty}</div>
            <button {...instantProps(() => setQty((q) => q + 1))} aria-label="เพิ่มจำนวน" className="icon-btn tap tap-lg tap-sq" style={{borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)'}}><Icon name="plus" size={20}/></button>
          </div>
          <div style={{flex: 1, textAlign: 'right'}}>
            <div style={{fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)', fontWeight: 500}}>ราคารวม</div>
            <div className="num" style={{fontSize: 'var(--fs-h1)', fontWeight: 700, color: 'var(--color-primary)', letterSpacing: '-0.01em', lineHeight: 'var(--lh-tight)'}}>฿{(unitPrice * qty).toLocaleString()}</div>
          </div>
          <button onClick={onConfirm} disabled={isLoading} className="btn btn-primary btn-lg tap-lg full-phone" style={{minWidth: 180, opacity: isLoading ? 0.5 : 1}}>
            <Icon name="plus" size={20}/> เพิ่มลงตะกร้า
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Loading placeholder that mirrors the real option-group layout (label bar +
 * a grid of option chips) so the modal doesn't pop fully-formed controls in
 * cold or briefly show fallback options that then swap out. aria-busy lives on
 * the dialog; this is the visual side.
 */
function ModifierGroupsSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((g) => (
        <div key={g} style={{ marginBottom: 22 }}>
          <Skeleton width={g === 0 ? '28%' : '36%'} height="var(--space-4)" radius="var(--radius-sm)" style={{ marginBottom: 'var(--space-3)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' }}>
            {Array.from({ length: g === 0 ? 3 : 4 }).map((_, i) => (
              <Skeleton key={i} height={56} radius="var(--radius-md)" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Instant control (TOUCH-SPEC §4): acts on pointerdown with an 8ms haptic tick.
 * The click that follows a touch/mouse press (detail ≥ 1) is ignored; keyboard and
 * assistive-tech activation (detail 0) still goes through onClick.
 */
function instantProps(act: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.currentTarget.disabled) return;
      act();
      haptic();
    },
    onClick: (e: React.MouseEvent) => { if (e.detail === 0) act(); },
  };
}

/** Drawn 22px radio / checkbox mark, so the row reads as single vs multi choice. */
function OptionMark({ kind, on }: { kind: 'radio' | 'check'; on: boolean }) {
  return (
    // Selected rows are espresso-filled, so the "on" mark is drawn in the inverse ink.
    <span aria-hidden style={{
      width: 22, height: 22, flexShrink: 0, display: 'grid', placeItems: 'center',
      borderRadius: kind === 'radio' ? 999 : 6,
      border: `1px solid ${on ? 'var(--color-text-inverse)' : 'var(--color-border-strong)'}`,
      background: on && kind === 'check' ? 'var(--color-text-inverse)' : 'transparent',
      color: 'var(--color-primary)',
    }}>
      {kind === 'radio'
        ? on && <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--color-text-inverse)' }} />
        : on && <Icon name="check" size={16} strokeWidth={2.25} />}
    </span>
  );
}
