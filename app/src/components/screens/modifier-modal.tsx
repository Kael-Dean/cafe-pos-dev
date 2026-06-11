'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Icon from '../icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useModifierGroups, type ModifierGroup } from '@/hooks/use-modifier-groups';

/**
 * Modal a11y: trap focus inside the dialog, close on Esc, restore focus to the
 * element that opened it. Mirrors the role="dialog"/aria-modal convention used
 * in payment-modal / receipt-modal. Visual open/close stays on the CSS
 * .modal-in / .backdrop-in classes — this only wires keyboard + focus.
 */
function useModalA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

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
        (sel[g.id] as string[]).forEach((oid) => {
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
      const list = cur[groupId] as string[];
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
        (sel[g.id] as string[]).forEach((oid) => {
          const o = g.options.find((x) => x.id === oid);
          if (o) {
            labels.push(`+ ${o.label}`);
            modKey += `${g.id}:${oid};`;
            modIds.push(oid);
          }
        });
      }
    });
    if (note.trim()) { labels.push(`📝 ${note.trim()}`); modKey += `note:${note.trim()};`; }
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
        <div style={{padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)'}}>
          <div style={{
            width: 56, height: 56, borderRadius: 'var(--radius-lg)',
            background: `linear-gradient(135deg, ${item.color}, ${item.color}cc)`,
            display: 'grid', placeItems: 'center',
            color: 'rgba(255,255,255,0.9)', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
          }}>{item.nameEn.split(' ')[0].toUpperCase()}</div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 18, fontWeight: 700}}>{item.name}</div>
            <div style={{fontSize: 'var(--fs-14)', color: 'var(--color-text-secondary)'}}>{item.nameEn} • ราคาเริ่มต้น ฿{item.price}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="icon-btn hit-44" style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div className="scroll" style={{flex: 1, overflow: 'auto', padding: 'var(--space-5) var(--space-6)'}}>
          {isLoading ? (
            <ModifierGroupsSkeleton />
          ) : (
          <>
          {groups.map((g) => (
            <div key={g.id} style={{marginBottom: 22}}>
              <div style={{display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10}}>
                <div style={{fontSize: 14, fontWeight: 600}}>{g.label}</div>
                {g.required && <span style={{fontSize: 11, color: 'var(--color-danger)', fontWeight: 600}}>* จำเป็น</span>}
                {!g.required && <span style={{fontSize: 11, color: 'var(--color-text-muted)'}}>ตัวเลือก</span>}
              </div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8}}>
                {g.options.map((o) => {
                  const isSelected = g.type === 'radio' ? sel[g.id] === o.id : (sel[g.id] as string[]).includes(o.id);
                  const onPick = () => g.type === 'radio'
                    ? setSel((c) => ({ ...c, [g.id]: o.id }))
                    : toggleCheck(g.id, o.id);
                  return (
                    <button key={o.id} onClick={onPick}
                      aria-pressed={isSelected}
                      className="pressable"
                      style={{
                        padding: '12px var(--space-4)',
                        borderRadius: 'var(--radius-md)', textAlign: 'left',
                        background: isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
                        color: isSelected ? 'var(--color-text-inverse)' : 'var(--color-text)',
                        border: `1.5px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
                        fontSize: 13, fontWeight: 600,
                        transition: 'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
                        minHeight: 48,
                      }}
                    >
                      <span>{o.label}</span>
                      {o.diff !== 0 && (
                        <span className="num" style={{
                          fontSize: 11, fontWeight: 600,
                          opacity: isSelected ? 0.8 : 1,
                          color: isSelected ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                        }}>{o.diff > 0 ? `+${o.diff}` : o.diff}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <div style={{fontSize: 'var(--fs-14)', fontWeight: 600, marginBottom: 'var(--space-2)'}}>หมายเหตุ <span style={{fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)'}}>(ตัวเลือก)</span></div>
            <input type="text" placeholder="เช่น ไม่ใส่น้ำแข็ง, ใส่ในแก้วร้อน"
              value={note} onChange={(e) => setNote(e.target.value)}
              className="input-std"
              style={{
                width: '100%', padding: '10px var(--space-3)', minHeight: 44,
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', fontSize: 13, outline: 'none',
                color: 'var(--color-text)', boxSizing: 'border-box',
              }}
            />
          </div>
          </>
          )}
        </div>

        <div style={{padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'var(--color-surface-2)', borderRadius: '0 0 var(--radius-xl) var(--radius-xl)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-1)', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)'}}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="ลดจำนวน" className="icon-btn hit-44" style={{width: 36, height: 36, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center'}}><Icon name="minus" size={14}/></button>
            <div className="num" aria-live="polite" style={{minWidth: 28, textAlign: 'center', fontWeight: 600}}>{qty}</div>
            <button onClick={() => setQty((q) => q + 1)} aria-label="เพิ่มจำนวน" className="icon-btn hit-44" style={{width: 36, height: 36, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center'}}><Icon name="plus" size={14}/></button>
          </div>
          <div style={{flex: 1, textAlign: 'right'}}>
            <div style={{fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500}}>ราคารวม</div>
            <div className="num" style={{fontSize: 22, fontWeight: 700, color: 'var(--color-primary)', letterSpacing: '-0.01em'}}>฿{(unitPrice * qty).toLocaleString()}</div>
          </div>
          <button onClick={onConfirm} disabled={isLoading} className="btn btn-primary btn-lg pressable" style={{minWidth: 160, minHeight: 44, opacity: isLoading ? 0.5 : 1}}>
            <Icon name="plus" size={16}/> เพิ่มลงตะกร้า
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
              <Skeleton key={i} height={48} radius="var(--radius-md)" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
