'use client';

import { useState, useMemo, useEffect } from 'react';
import Icon from '../icons';
import { useToast, baht } from '../app-common';
import { useAllProducts, useCategories, type MenuItem } from '@/hooks/use-products';
import { useModifierGroups } from '@/hooks/use-modifier-groups';
import { useProductDetail } from '@/hooks/use-bom';
import ModifierModal from './modifier-modal';
import PaymentModal from './payment-modal';

interface CartLine { menuId: string; name: string; basePrice: number; unitPrice: number; qty: number; mods: string[]; modKey: string; }

export default function POSTerminal() {
  const toast = useToast();
  const [category, setCategory] = useState('fav');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [billNo, setBillNo] = useState(48);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [payment, setPayment] = useState<string | null>(null);

  const { data: categories, isLoading: catsLoading } = useCategories();
  const { data: products, isLoading: prodLoading, isError } = useAllProducts();
  const { data: modifierGroups } = useModifierGroups();
  const storeHasModifiers = (modifierGroups?.length ?? 0) > 0;

  // Prefetch product detail when hovered so click is instant
  const [pendingModifierId, setPendingModifierId] = useState<string | null>(null);
  const { data: pendingDetail } = useProductDetail(pendingModifierId);

  // Once detail loads, decide: show modifier modal or add directly
  useEffect(() => {
    if (!pendingModifierId || !pendingDetail) return;
    const item = products?.find(p => p.id === pendingModifierId);
    if (!item) return;
    if (pendingDetail.hasModifiers) {
      setModifierItem(item);
    } else {
      addLine({ menuId: item.id, name: item.name, basePrice: item.price, unitPrice: item.price, qty: 1, mods: [], modKey: '' });
      toast({ kind: 'success', title: 'เพิ่มลงตะกร้า', msg: item.name, duration: 1600 });
    }
    setPendingModifierId(null);
  }, [pendingDetail, pendingModifierId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first real category if fav is empty after load
  useEffect(() => {
    if (category === 'fav' && !prodLoading && products?.every(p => !p.hot) && categories?.[0]) {
      setCategory(categories[0].id);
    }
  }, [products, prodLoading, categories, category]);

  const filtered = useMemo(() => {
    if (!products) return [];
    if (search.trim()) {
      const s = search.toLowerCase();
      return products.filter(m => m.name.toLowerCase().includes(s) || m.nameEn.toLowerCase().includes(s));
    }
    if (category === 'fav') return products.filter(m => m.hot);
    return products.filter(m => m.cat === category);
  }, [products, category, search]);

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const discount = 0;
  const vat = Math.round((subtotal - discount) * 0.07);
  const total = subtotal - discount + vat;

  const onMenuClick = (item: MenuItem) => {
    if (storeHasModifiers) {
      // Fetch product detail to check if this specific product has modifier groups.
      // useProductDetail result is cached — second tap on same item is instant.
      setPendingModifierId(item.id);
    } else {
      addLine({ menuId: item.id, name: item.name, basePrice: item.price, unitPrice: item.price, qty: 1, mods: [], modKey: '' });
      toast({ kind: 'success', title: 'เพิ่มลงตะกร้า', msg: item.name, duration: 1600 });
    }
  };

  const addLine = (line: CartLine) => {
    setCart((cur) => {
      const idx = cur.findIndex((c) => c.menuId === line.menuId && c.modKey === line.modKey);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = { ...next[idx], qty: next[idx].qty + line.qty };
        return next;
      }
      return [...cur, line];
    });
  };

  const updateQty = (i: number, delta: number) => {
    setCart((cur) => {
      const next = [...cur];
      const q = Math.max(0, next[i].qty + delta);
      if (q === 0) return next.filter((_, k) => k !== i);
      next[i] = { ...next[i], qty: q };
      return next;
    });
  };

  const removeLine = (i: number) => setCart((cur) => cur.filter((_, k) => k !== i));
  const clearCart = () => { setCart([]); setBillNo((b) => b + 1); };

  const onPaid = () => {
    setPayment(null);
    toast({ kind: 'success', title: 'ชำระเงินสำเร็จ', msg: `บิล A0${billNo} • ${baht(total)} • ส่งครัวแล้ว`, duration: 3500 });
    clearCart();
  };

  return (
    <div style={{display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--color-bg)'}}>
      {/* LEFT: Menu (60%) */}
      <div style={{flex: '0 0 60%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)'}}>
        <div style={{padding: '16px 20px 0 20px', display: 'flex', flexDirection: 'column', gap: 12}}>
          <div style={{display: 'flex', gap: 12, alignItems: 'center'}}>
            <h1 style={{margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em'}}>เมนู</h1>
            <div style={{flex: 1, position: 'relative'}}>
              <div style={{position: 'absolute', top: 10, left: 12, color: 'var(--color-text-muted)'}}>
                <Icon name="search" size={16} />
              </div>
              <input type="text" placeholder="ค้นหาเมนู ชื่อ หรือ hotkey..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px 10px 36px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)', borderRadius: 8,
                  fontSize: 14, outline: 'none',
                }}
                onFocus={(e) => e.target.style.boxShadow = 'var(--shadow-focus)'}
                onBlur={(e) => e.target.style.boxShadow = 'none'}
              />
            </div>
          </div>
          <div style={{display: 'flex', gap: 6, overflowX: 'auto'}} className="scroll">
            <CategoryTab label="★ ขายดี" active={category === 'fav'} onClick={() => { setCategory('fav'); setSearch(''); }} highlight />
            {catsLoading && !categories ? (
              <div style={{ padding: '8px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>กำลังโหลด...</div>
            ) : (
              (categories ?? []).map((c) => (
                <CategoryTab key={c.id} label={c.label} active={category === c.id} onClick={() => { setCategory(c.id); setSearch(''); }} />
              ))
            )}
          </div>
        </div>

        <div className="scroll" style={{flex: 1, overflow: 'auto', padding: 20}}>
          {isError ? (
            <div style={{textAlign: 'center', padding: 60, color: 'var(--color-danger)'}}>
              <div style={{marginBottom: 8}}><Icon name="warning" size={32}/></div>
              ไม่สามารถโหลดเมนูได้ กรุณาตรวจสอบการเชื่อมต่อ
            </div>
          ) : prodLoading ? (
            <div style={{textAlign: 'center', padding: 60, color: 'var(--color-text-muted)'}}>
              กำลังโหลดเมนู...
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {filtered.map((m) => <MenuCard key={m.id} item={m} onClick={() => onMenuClick(m)} />)}
              </div>
              {filtered.length === 0 && (
                <div style={{textAlign: 'center', padding: 60, color: 'var(--color-text-muted)'}}>
                  <div style={{marginBottom: 8}}><Icon name="search" size={32}/></div>
                  ไม่พบเมนูที่ค้นหา
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* RIGHT: Cart (40%) */}
      <div style={{flex: '0 0 40%', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)'}}>
        <div style={{padding: '20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div>
            <div style={{fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500}}>บิลปัจจุบัน</div>
            <div style={{fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}} className="num">A0{billNo}</div>
          </div>
          <div style={{display: 'flex', gap: 6}}>
            <button className="btn btn-ghost" style={{padding: '8px 12px', fontSize: 12}}>
              <Icon name="user" size={14}/> ลูกค้า
            </button>
            <button className="btn btn-ghost" style={{padding: 8}} title="Park bill">
              <Icon name="park" size={16}/>
            </button>
          </div>
        </div>

        <div className="scroll" style={{flex: 1, overflow: 'auto', padding: '8px 0'}}>
          {cart.length === 0 ? (
            <div style={{padding: 60, textAlign: 'center', color: 'var(--color-text-muted)'}}>
              <div style={{marginBottom: 12, opacity: 0.6}}><Icon name="cart" size={48}/></div>
              <div style={{fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4}}>ตะกร้าว่าง</div>
              <div style={{fontSize: 13}}>เลือกเมนูจากด้านซ้ายเพื่อเริ่มออเดอร์</div>
            </div>
          ) : cart.map((l, i) => (
            <CartLine key={i} line={l} onInc={() => updateQty(i, +1)} onDec={() => updateQty(i, -1)} onRemove={() => removeLine(i)} />
          ))}
        </div>

        <div style={{padding: 20, borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)'}}>
          <Row label="Subtotal" value={baht(subtotal)} />
          <Row label="VAT 7%"  value={baht(vat)} />
          <Row label="ส่วนลด"  value={baht(0)} muted />
          <div style={{height: 1, background: 'var(--color-border)', margin: '12px 0'}}/>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
            <div style={{fontSize: 15, fontWeight: 600}}>รวมทั้งสิ้น</div>
            <div className="num" style={{fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-primary)'}}>
              {baht(total)}
            </div>
          </div>
        </div>

        <div style={{padding: '0 20px 20px', display: 'grid', gap: 8}}>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8}}>
            <PayButton icon="cash"  label="เงินสด"      onClick={() => cart.length && setPayment('cash')} disabled={!cart.length} />
            <PayButton icon="card"  label="บัตร"         onClick={() => cart.length && setPayment('card')} disabled={!cart.length} />
            <PayButton icon="qr"    label="QR PromptPay" onClick={() => cart.length && setPayment('qr')}   disabled={!cart.length} primary />
            <PayButton icon="line"  label="LINE Pay"     onClick={() => cart.length && setPayment('line')} disabled={!cart.length} />
          </div>
          <div style={{display: 'flex', gap: 8, marginTop: 4}}>
            <button className="btn btn-ghost" style={{flex: 1, fontSize: 12, padding: 8}}>
              <Icon name="discount" size={14}/> Discount
            </button>
            <button className="btn btn-ghost" style={{flex: 1, fontSize: 12, padding: 8}} onClick={() => cart.length && clearCart()}>
              <Icon name="void" size={14}/> Void
            </button>
          </div>
        </div>
      </div>

      {modifierItem && (
        <ModifierModal
          item={modifierItem}
          onClose={() => setModifierItem(null)}
          onAdd={(line) => {
            addLine(line);
            toast({ kind: 'success', title: 'เพิ่มลงตะกร้า', msg: `${line.name} • ${baht(line.unitPrice)}`, duration: 1800 });
            setModifierItem(null);
          }}
        />
      )}
      {payment && (
        <PaymentModal method={payment} total={total} billNo={billNo} onClose={() => setPayment(null)} onPaid={onPaid} />
      )}
    </div>
  );
}

const CategoryTab = ({ label, active, onClick, highlight }: { label: string; active: boolean; onClick: () => void; highlight?: boolean }) => (
  <button onClick={onClick} style={{
    padding: '8px 14px', borderRadius: 999,
    background: active ? 'var(--color-primary)' : (highlight ? 'var(--color-accent-50)' : 'var(--color-surface)'),
    color: active ? 'white' : (highlight ? 'var(--color-primary-700)' : 'var(--color-text-secondary)'),
    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
    transition: 'all 150ms var(--ease-out)',
  }}>{label}</button>
);

const MenuCard = ({ item, onClick }: { item: MenuItem; onClick: () => void }) => (
  <button onClick={onClick} style={{
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    textAlign: 'left', transition: 'all 150ms var(--ease-out)', position: 'relative',
  }}
    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
  >
    <div style={{
      aspectRatio: '4 / 3',
      background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}cc 100%)`,
      position: 'relative', display: 'grid', placeItems: 'center',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 8px, transparent 8px 16px)',
      }}/>
      <div style={{
        fontFamily: 'var(--font-num)', color: 'rgba(255,255,255,0.92)',
        fontSize: 11, letterSpacing: '0.08em', fontWeight: 500,
      }}>{item.nameEn.toUpperCase()}</div>
      {item.hot && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          background: 'var(--color-accent)', color: 'var(--color-primary-700)',
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
          <Icon name="star" size={10} /> ขายดี
        </div>
      )}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        background: 'rgba(0,0,0,0.4)', color: 'white',
        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
        fontFamily: 'var(--font-num)',
      }}>{item.tag}</div>
    </div>
    <div style={{padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4}}>
      <div style={{fontSize: 13, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3, minHeight: 34}}>{item.name}</div>
      <div className="num" style={{fontSize: 15, fontWeight: 700, color: 'var(--color-primary)'}}>฿{item.price}</div>
    </div>
  </button>
);

const CartLine = ({ line, onInc, onDec, onRemove }: { line: CartLine; onInc: () => void; onDec: () => void; onRemove: () => void }) => (
  <div style={{padding: '12px 20px', display: 'flex', gap: 12, alignItems: 'flex-start', borderBottom: '1px solid var(--color-surface-2)'}}>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 14, fontWeight: 600, marginBottom: 2}}>{line.name}</div>
      {line.mods.length > 0 && (
        <div style={{fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.45}}>
          {line.mods.join(' • ')}
        </div>
      )}
    </div>
    <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
      <button onClick={onDec} style={qtyBtnStyle}><Icon name="minus" size={14}/></button>
      <div className="num" style={{minWidth: 20, textAlign: 'center', fontWeight: 600}}>{line.qty}</div>
      <button onClick={onInc} style={qtyBtnStyle}><Icon name="plus" size={14}/></button>
    </div>
    <div style={{minWidth: 64, textAlign: 'right'}}>
      <div className="num" style={{fontWeight: 600, fontSize: 14}}>฿{(line.unitPrice * line.qty).toLocaleString()}</div>
      <button onClick={onRemove} style={{fontSize: 11, color: 'var(--color-danger)', marginTop: 2}}>ลบ</button>
    </div>
  </div>
);

const qtyBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  background: 'var(--color-surface-2)',
  display: 'grid', placeItems: 'center',
};

const Row = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
  <div style={{display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: muted ? 'var(--color-text-muted)' : 'var(--color-text-secondary)'}}>
    <span>{label}</span>
    <span className="num" style={{fontWeight: 500, color: muted ? 'var(--color-text-muted)' : 'var(--color-text)'}}>{value}</span>
  </div>
);

const PayButton = ({ icon, label, onClick, disabled, primary }: { icon: string; label: string; onClick: () => void; disabled: boolean; primary?: boolean }) => (
  <button onClick={onClick} disabled={disabled}
    style={{
      padding: '14px 12px', borderRadius: 8,
      background: disabled ? 'var(--color-surface-2)' : (primary ? 'var(--color-primary)' : 'var(--color-surface)'),
      color: disabled ? 'var(--color-text-muted)' : (primary ? 'white' : 'var(--color-text)'),
      border: `1px solid ${primary ? 'var(--color-primary)' : 'var(--color-border)'}`,
      fontWeight: 600, fontSize: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      minHeight: 64,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 150ms var(--ease-out)',
    }}
    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; } }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
  >
    <Icon name={icon} size={20}/>
    <span style={{fontSize: 12}}>{label}</span>
  </button>
);
