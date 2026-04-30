'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { MENU, CATEGORIES, INVENTORY, RECIPES } from '../data/mock-data';

export default function BOMBuilder() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState(MENU[0].id);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);

  const [recipes, setRecipes] = useState<Record<string, { invId: string; qty: number }[]>>(() => {
    const o: Record<string, { invId: string; qty: number }[]> = {};
    MENU.forEach(m => { o[m.id] = (RECIPES[m.id] || []).map(x => ({ ...x })); });
    return o;
  });
  const [prices, setPrices] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    MENU.forEach(m => { o[m.id] = m.price; });
    return o;
  });

  const computeCost = (items: { invId: string; qty: number }[]) => items.reduce((s, r) => {
    const inv = INVENTORY.find(i => i.id === r.invId);
    return s + (inv ? inv.costPerUnit * r.qty : 0);
  }, 0);

  const menu = MENU.find(m => m.id === selectedId)!;
  const cat = CATEGORIES.find(c => c.id === menu.cat);
  const recipe = recipes[selectedId] || [];
  const sellingPrice = prices[selectedId] || 0;
  const totalCost = computeCost(recipe);
  const margin = sellingPrice - totalCost;
  const marginPct = sellingPrice > 0 ? (margin / sellingPrice) * 100 : 0;

  const updateQty = (idx: number, qty: number) => setRecipes(r => {
    const next = { ...r };
    next[selectedId] = [...next[selectedId]];
    next[selectedId][idx] = { ...next[selectedId][idx], qty: Math.max(0, qty) };
    return next;
  });

  const removeItem = (idx: number) => setRecipes(r => {
    const next = { ...r };
    next[selectedId] = next[selectedId].filter((_, i) => i !== idx);
    return next;
  });

  const addItem = (invId: string) => {
    setRecipes(r => {
      const next = { ...r };
      next[selectedId] = [...(next[selectedId] || []), { invId, qty: 1 }];
      return next;
    });
    setPicker(false);
    toast({ kind: 'info', title: 'เพิ่มวัตถุดิบแล้ว', msg: 'ปรับปริมาณตามสูตรจริง' });
  };

  const filteredMenu = MENU.filter(m => !search || m.name.includes(search) || m.nameEn.toLowerCase().includes(search.toLowerCase()));
  const marginToneOf = (pct: number) => pct >= 65 ? 'success' : pct >= 50 ? 'warning' : 'danger';
  const marginColorOf = (pct: number) => pct >= 65 ? 'var(--color-success)' : pct >= 50 ? '#9C6A1F' : 'var(--color-danger)';

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--color-bg)' }}>
      {/* LEFT */}
      <div style={{ width: 320, flexShrink: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>P1 — Inventory</div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>BOM Builder</h2>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>สูตรอาหาร · ต้นทุน · margin</div>
        </div>
        <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
            <Icon name="search" size={16} color="var(--color-text-muted)" />
          </div>
          <input type="text" placeholder="ค้นหาเมนู..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {filteredMenu.map(m => {
            const isActive = m.id === selectedId;
            const r = recipes[m.id] || [];
            const cost = computeCost(r);
            const mp = prices[m.id] || 0;
            const mar = mp > 0 ? ((mp - cost) / mp) * 100 : 0;
            const hasRecipe = r.length > 0;
            return (
              <button key={m.id} onClick={() => setSelectedId(m.id)} style={{
                display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 10, marginBottom: 2, borderRadius: 8,
                background: isActive ? 'var(--color-accent-50)' : 'transparent',
                border: isActive ? '1px solid var(--color-accent)' : '1px solid transparent',
                cursor: 'pointer', textAlign: 'left', transition: 'all 150ms var(--ease-out)',
              }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 8, background: m.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{m.tag}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                    <span className="num" style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{baht(mp)}</span>
                    <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>•</span>
                    <span className="num" style={{ fontSize: 11, fontWeight: 700, color: hasRecipe ? marginColorOf(mar) : 'var(--color-text-muted)' }}>
                      {hasRecipe ? `${mar.toFixed(0)}%` : 'ไม่มีสูตร'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT */}
      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 80, height: 80, borderRadius: 12, background: menu.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800, flexShrink: 0 }}>{menu.tag}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{menu.nameEn}</div>
            <h1 style={{ margin: '2px 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{menu.name}</h1>
            <div style={{ display: 'flex', gap: 6 }}>
              <Tag tone="neutral">{cat?.label}</Tag>
              <Tag tone={recipe.length > 0 ? 'success' : 'warning'}>{recipe.length > 0 ? `${recipe.length} วัตถุดิบ` : 'ยังไม่มีสูตร'}</Tag>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>ราคาขาย</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 18, color: 'var(--color-text-secondary)' }}>฿</span>
              <input type="number" min={0} step={5} value={sellingPrice}
                onChange={e => setPrices(p => ({ ...p, [selectedId]: Number(e.target.value) }))}
                className="num"
                style={{ width: 96, fontSize: 30, fontWeight: 700, textAlign: 'right', border: 'none', borderBottom: '2px solid var(--color-border)', outline: 'none', padding: '4px 0', background: 'transparent', fontFamily: 'inherit', letterSpacing: '-0.02em' }}
                onFocus={e => e.target.style.borderBottomColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderBottomColor = 'var(--color-border)'}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <SummaryCard label="ต้นทุนวัตถุดิบ" value={`฿${totalCost.toFixed(2)}`} />
          <SummaryCard label="ส่วนต่าง (Contribution)" value={`฿${margin.toFixed(2)}`} color={margin >= 0 ? 'var(--color-text)' : 'var(--color-danger)'} />
          <SummaryCard label="Margin" value={`${marginPct.toFixed(1)}%`} highlight={marginToneOf(marginPct)} />
        </div>

        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>ส่วนประกอบ (Bill of Materials)</div>
            <button onClick={() => setPicker(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} />เพิ่มวัตถุดิบ</button>
          </div>

          {recipe.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--color-surface-2)', margin: '0 auto 12px', display: 'grid', placeItems: 'center' }}><Icon name="inv" size={28} color="var(--color-text-muted)" /></div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>ยังไม่มีสูตรสำหรับเมนูนี้</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 100px 90px 36px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                <div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>ปริมาณ</div><div>หน่วย</div><div style={{ textAlign: 'right' }}>ราคา/หน่วย</div><div style={{ textAlign: 'right' }}>รวม</div><div></div>
              </div>
              {recipe.map((r, idx) => {
                const inv = INVENTORY.find(i => i.id === r.invId);
                if (!inv) return null;
                const lineCost = inv.costPerUnit * r.qty;
                const stockOk = inv.stock >= r.qty * 10;
                return (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 100px 90px 36px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === recipe.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{inv.name}</div>
                      <div style={{ fontSize: 11, color: stockOk ? 'var(--color-text-muted)' : 'var(--color-warning)', marginTop: 2 }}>คงเหลือ {inv.stock.toLocaleString()} {inv.unit}{!stockOk && ' · ใกล้หมด'}</div>
                    </div>
                    <input type="number" step={1} min={0} value={r.qty} onChange={e => updateQty(idx, Number(e.target.value))} className="num" style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px', outline: 'none', fontFamily: 'inherit', background: 'var(--color-surface)' }} onFocus={e => e.target.style.borderColor = 'var(--color-accent)'} onBlur={e => e.target.style.borderColor = 'var(--color-border)'} />
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{inv.unit}</div>
                    <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>฿{inv.costPerUnit.toFixed(2)}</div>
                    <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>฿{lineCost.toFixed(2)}</div>
                    <button onClick={() => removeItem(idx)} title="ลบวัตถุดิบ" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}><Icon name="trash" size={14} /></button>
                  </div>
                );
              })}
              <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 90px 36px', gap: 12, alignItems: 'center', background: 'var(--color-surface-2)', borderTop: '2px solid var(--color-border)' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>ต้นทุนรวมต่อหน่วยขาย</div>
                <div className="num" style={{ fontSize: 16, fontWeight: 800, textAlign: 'right' }}>฿{totalCost.toFixed(2)}</div>
                <div></div>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={() => toast({ kind: 'success', title: 'บันทึกสูตรแล้ว', msg: `${menu.name} • ${recipe.length} วัตถุดิบ • ต้นทุน ฿${totalCost.toFixed(2)} • Margin ${marginPct.toFixed(1)}%` })} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}>
            <Icon name="check" size={16} />บันทึกสูตร
          </button>
        </div>

        <div style={{ marginTop: 24, padding: 16, background: 'var(--color-info-50)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Icon name="info" size={20} color="var(--color-info)" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-info)', marginBottom: 6 }}>เรื่อง Margin ที่ควรรู้</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
              คาเฟ่ทั่วไปควรมี margin <strong style={{ color: 'var(--color-success)' }}>≥ 65%</strong> สำหรับเครื่องดื่ม และ <strong style={{ color: 'var(--color-success)' }}>≥ 60%</strong> สำหรับเบเกอรี่
            </div>
          </div>
        </div>
      </div>

      {picker && <IngredientPicker existingIds={recipe.map(r => r.invId)} onSelect={addItem} onClose={() => setPicker(false)} />}
    </div>
  );
}

const SummaryCard = ({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: 'success' | 'warning' | 'danger' }) => {
  const tones = {
    success: { bg: 'var(--color-success-50)', border: 'var(--color-success)', fg: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning)', fg: '#9C6A1F' },
    danger: { bg: 'var(--color-danger-50)', border: 'var(--color-danger)', fg: 'var(--color-danger)' },
  };
  const t = highlight ? tones[highlight] : null;
  return (
    <div style={{ background: t ? t.bg : 'var(--color-surface)', border: t ? `1px solid ${t.border}` : '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: t ? t.fg : 'var(--color-text-secondary)' }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: t ? t.fg : (color || 'var(--color-text)') }}>{value}</div>
    </div>
  );
};

const IngredientPicker = ({ existingIds, onSelect, onClose }: { existingIds: string[]; onSelect: (id: string) => void; onClose: () => void }) => {
  const [q, setQ] = useState('');
  const list = INVENTORY.filter(inv => !q || inv.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.55)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20, animation: 'backdrop-in 200ms var(--ease-out)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', animation: 'modal-in 220ms var(--ease-out)' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div><div style={{ fontSize: 16, fontWeight: 700 }}>เลือกวัตถุดิบ</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{INVENTORY.length} รายการในคลัง</div></div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'grid', placeItems: 'center' }}><Icon name="x" size={18} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}><Icon name="search" size={16} color="var(--color-text-muted)" /></div>
            <input type="text" placeholder="ค้นหาวัตถุดิบ..." autoFocus value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {list.map(inv => {
            const exists = existingIds.includes(inv.id);
            return (
              <button key={inv.id} onClick={() => !exists && onSelect(inv.id)} disabled={exists} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 12, marginBottom: 2, borderRadius: 8, background: 'transparent', border: '1px solid transparent', cursor: exists ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: exists ? 0.55 : 1, transition: 'background 150ms var(--ease-out)', fontFamily: 'inherit' }} onMouseEnter={e => { if (!exists) e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{inv.name}</div>
                  <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>฿{inv.costPerUnit.toFixed(2)}/{inv.unit} · คงเหลือ {inv.stock.toLocaleString()} {inv.unit}</div>
                </div>
                {exists ? <Tag tone="success">เพิ่มแล้ว</Tag> : <Icon name="plus" size={16} color="var(--color-primary)" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
