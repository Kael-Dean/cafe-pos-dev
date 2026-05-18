'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Icon from '../icons';
import { useModifierGroups, type ModifierGroup } from '@/hooks/use-modifier-groups';

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
  const { data: apiGroups } = useModifierGroups();

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
          if (!isHiddenDefault) labels.push(o.label);
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
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{
        width: 'min(560px, 92vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 16}}>
          <div style={{
            width: 56, height: 56, borderRadius: 12,
            background: `linear-gradient(135deg, ${item.color}, ${item.color}cc)`,
            display: 'grid', placeItems: 'center',
            color: 'rgba(255,255,255,0.9)', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
          }}>{item.nameEn.split(' ')[0].toUpperCase()}</div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 18, fontWeight: 700}}>{item.name}</div>
            <div style={{fontSize: 13, color: 'var(--color-text-secondary)'}}>{item.nameEn} • ราคาเริ่มต้น ฿{item.price}</div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-2)'}
             onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div className="scroll" style={{flex: 1, overflow: 'auto', padding: '20px 24px'}}>
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
                      style={{
                        padding: '12px 14px',
                        borderRadius: 8, textAlign: 'left',
                        background: isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
                        color: isSelected ? 'white' : 'var(--color-text)',
                        border: `1.5px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        fontSize: 13, fontWeight: 600,
                        transition: 'all 120ms var(--ease-out)',
                        minHeight: 48,
                      }}
                    >
                      <span>{o.label}</span>
                      {o.diff !== 0 && (
                        <span className="num" style={{
                          fontSize: 11, fontWeight: 600,
                          color: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--color-text-muted)',
                        }}>{o.diff > 0 ? `+${o.diff}` : o.diff}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <div style={{fontSize: 14, fontWeight: 600, marginBottom: 8}}>หมายเหตุ <span style={{fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)'}}>(ตัวเลือก)</span></div>
            <input type="text" placeholder="เช่น ไม่ใส่น้ำแข็ง, ใส่ในแก้วร้อน"
              value={note} onChange={(e) => setNote(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 8, fontSize: 13, outline: 'none',
              }}
              onFocus={(e) => e.target.style.boxShadow = 'var(--shadow-focus)'}
              onBlur={(e) => e.target.style.boxShadow = 'none'}
            />
          </div>
        </div>

        <div style={{padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-surface-2)', borderRadius: '0 0 var(--radius-xl) var(--radius-xl)'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 4, padding: 4, background: 'white', borderRadius: 8, border: '1px solid var(--color-border)'}}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{width: 32, height: 32, borderRadius: 6, display: 'grid', placeItems: 'center'}}><Icon name="minus" size={14}/></button>
            <div className="num" style={{minWidth: 24, textAlign: 'center', fontWeight: 600}}>{qty}</div>
            <button onClick={() => setQty((q) => q + 1)} style={{width: 32, height: 32, borderRadius: 6, display: 'grid', placeItems: 'center'}}><Icon name="plus" size={14}/></button>
          </div>
          <div style={{flex: 1, textAlign: 'right'}}>
            <div style={{fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500}}>ราคารวม</div>
            <div className="num" style={{fontSize: 22, fontWeight: 700, color: 'var(--color-primary)', letterSpacing: '-0.01em'}}>฿{(unitPrice * qty).toLocaleString()}</div>
          </div>
          <button onClick={onConfirm} className="btn btn-primary btn-lg" style={{minWidth: 160}}>
            <Icon name="plus" size={16}/> เพิ่มลงตะกร้า
          </button>
        </div>
      </div>
    </div>
  );
}
