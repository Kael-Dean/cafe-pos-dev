'use client';

import { useState, useMemo, useEffect } from 'react';
import Icon from '../icons';
import { useToast, baht } from '../app-common';
import { useAllProducts, useCategories, type MenuItem } from '@/hooks/use-products';
import { useProductDetail } from '@/hooks/use-bom';
import { useCreateOrder, usePayOrder } from '@/hooks/use-orders';
import { useEvaluatePromotions, type EligiblePromotion } from '@/hooks/use-promotions';
import ModifierModal from './modifier-modal';
import PaymentModal from './payment-modal';
import ReceiptModal, { type ReceiptData } from './receipt-modal';
import MembershipModal, { type MemberInfo } from './membership-modal';
import { useMembershipProgram, type ProgramRead } from '@/hooks/use-membership';
import { usePrinter } from '@/hooks/use-printer';

interface CartLine { menuId: string; name: string; basePrice: number; unitPrice: number; qty: number; mods: string[]; modIds: string[]; modKey: string; }

/** Cashier-facing ESTIMATE only — the server is authoritative for the final discount. */
function estimateMemberDiscount(member: MemberInfo | null, program: ProgramRead | null | undefined, subtotal: number): number {
  if (!member?.redeemReward) return 0;
  const rt = member.program?.reward_type;
  if (rt === 'FREE_ITEM') return Math.min(member.rewardProduct ? Math.round(Number(member.rewardProduct.price)) : 0, subtotal);
  const rv = Number(program?.reward_value ?? 0);
  if (rt === 'DISCOUNT_FIXED') return Math.min(Math.round(rv), subtotal);
  if (rt === 'DISCOUNT_PERCENT') return Math.min(Math.round((subtotal * rv) / 100), subtotal);
  return 0;
}

export default function POSTerminal() {
  const toast = useToast();
  const [category, setCategory] = useState('fav');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [billNo, setBillNo] = useState(48);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [modifierGroupIds, setModifierGroupIds] = useState<string[]>([]);
  const [payment, setPayment] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [activeTab, setActiveTab] = useState<'menu' | 'cart'>('menu');
  const [showMembership, setShowMembership] = useState(false);
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [eligiblePromos, setEligiblePromos] = useState<EligiblePromotion[]>([]);
  const [selectedPromoIds, setSelectedPromoIds] = useState<string[]>([]);
  const [showPromoPanel, setShowPromoPanel] = useState(false);

  const { data: categories, isLoading: catsLoading } = useCategories();
  const { data: products, isLoading: prodLoading, isError } = useAllProducts();
  const { data: program } = useMembershipProgram();
  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const evaluate = useEvaluatePromotions();
  const { printReceipt } = usePrinter();

  // Prefetch product detail when hovered so click is instant
  const [pendingModifierId, setPendingModifierId] = useState<string | null>(null);
  const { data: pendingDetail } = useProductDetail(pendingModifierId);

  // Once detail loads, decide: show modifier modal or add directly
  useEffect(() => {
    if (!pendingModifierId || !pendingDetail) return;
    const item = products?.find(p => p.id === pendingModifierId);
    if (!item) return;
    if (pendingDetail.hasModifiers) {
      setModifierGroupIds(pendingDetail.modifierGroupIds);
      setModifierItem(item);
    } else {
      addLine({ menuId: item.id, name: item.name, basePrice: item.price, unitPrice: item.price, qty: 1, mods: [], modIds: [], modKey: '' });
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
    if (category === 'fav') {
      const favs = products.filter(m => m.hot);
      return favs.length > 0 ? favs : products;
    }
    if (category === 'all') return products;
    return products.filter(m => m.cat === category);
  }, [products, category, search]);

  // ── Promotions: evaluate eligible promos whenever the cart changes (debounced 300ms) ──
  const cartForEval = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of cart) map.set(l.menuId, (map.get(l.menuId) ?? 0) + l.qty);
    return Array.from(map, ([product_id, quantity]) => ({ product_id, quantity }));
  }, [cart]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (cartForEval.length === 0) { setEligiblePromos([]); setSelectedPromoIds([]); return; }
      evaluate.mutateAsync(cartForEval)
        .then(res => {
          if (cancelled) return;
          setEligiblePromos(res.eligible);
          // keep only selections that are still eligible after the refresh
          setSelectedPromoIds(prev => prev.filter(id => res.eligible.some(e => e.promotion_id === id)));
        })
        .catch(() => { if (!cancelled) setEligiblePromos([]); });
    }, cartForEval.length === 0 ? 0 : 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cartForEval]); // eslint-disable-line react-hooks/exhaustive-deps

  const exclusiveSelected = eligiblePromos.find(e => selectedPromoIds.includes(e.promotion_id) && e.is_exclusive) ?? null;
  const promoDiscount = eligiblePromos
    .filter(e => selectedPromoIds.includes(e.promotion_id))
    .reduce((s, e) => s + Number(e.discount_amount), 0);

  const togglePromo = (e: EligiblePromotion) => {
    setSelectedPromoIds(prev => {
      if (prev.includes(e.promotion_id)) return prev.filter(id => id !== e.promotion_id);
      if (e.is_exclusive) return [e.promotion_id];      // exclusive replaces all others
      if (exclusiveSelected) return prev;                // locked while an exclusive promo is selected
      return [...prev, e.promotion_id];
    });
  };

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const memberDiscount = estimateMemberDiscount(memberInfo, program, subtotal);
  const discount = Math.min(subtotal, memberDiscount + promoDiscount);
  const total = subtotal - discount;

  const onMenuClick = (item: MenuItem) => {
    // Always check product-level modifier groups; cached per-product so repeat taps are instant.
    setPendingModifierId(item.id);
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
  const clearCart = () => { setCart([]); setBillNo((b) => b + 1); setMemberInfo(null); setSelectedPromoIds([]); setEligiblePromos([]); setShowPromoPanel(false); };

  const PAY_LABEL: Record<string, string> = {
    cash: 'เงินสด', card: 'บัตรเครดิต', qr: 'QR PromptPay', line: 'LINE Pay',
  };

  const onPaid = () => {
    const method = payment;
    const cartSnapshot = [...cart];
    const subtotalSnapshot = subtotal;
    const totalSnapshot = total;
    const discountSnapshot = discount;
    const memberSnapshot = memberInfo;
    const promoSnapshot = selectedPromoIds;
    setPayment(null);
    clearCart();
    const methodMap: Record<string, 'CASH' | 'CARD' | 'QR_PROMPTPAY' | 'LINE_PAY'> = {
      cash: 'CASH', card: 'CARD', qr: 'QR_PROMPTPAY', line: 'LINE_PAY',
    };
    createOrder.mutateAsync({
      idempotency_key: crypto.randomUUID(),
      channel: 'DINE_IN',
      items: cartSnapshot.map(l => ({
        product_id: l.menuId,
        quantity: l.qty,
        modifier_ids: l.modIds,
      })),
      ...(memberSnapshot ? {
        member_id: memberSnapshot.account.id,
        redeem_reward: memberSnapshot.redeemReward,
        reward_product_id: memberSnapshot.rewardProduct?.id ?? null,
      } : {}),
      ...(promoSnapshot.length ? { promotion_ids: promoSnapshot } : {}),
    }).then(order =>
      payOrder.mutateAsync({
        orderId: order.id,
        payment_method: methodMap[method ?? 'cash'] ?? 'CASH',
      }).then(() => {
        // Server is authoritative for discount/total when a member and/or promotions were applied.
        const hasMember = !!memberSnapshot;
        const serverAuthoritative = hasMember || promoSnapshot.length > 0;
        const serverTotal = order.total != null ? Number(order.total) : totalSnapshot;
        const serverDiscount = order.discount != null ? Number(order.discount) : discountSnapshot;
        const finalTotal = serverAuthoritative ? serverTotal : totalSnapshot;
        const finalDiscount = serverAuthoritative ? serverDiscount : 0;
        const earned = order.points_earned ?? 0;
        toast({
          kind: 'success', title: 'ชำระเงินสำเร็จ',
          msg: `บิล ${order.order_number} • ${baht(finalTotal)}${earned > 0 ? ` • +${earned} แต้ม` : ''} • ส่งครัวแล้ว`,
          duration: 3500,
        });
        setReceiptData({
          orderNumber: String(order.order_number),
          items: cartSnapshot.map(l => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, mods: l.mods.length ? l.mods : undefined })),
          subtotal: subtotalSnapshot,
          total: finalTotal,
          paymentMethod: method ?? 'cash',
          paymentLabel: PAY_LABEL[method ?? 'cash'] ?? method ?? 'cash',
          discount: finalDiscount > 0 ? finalDiscount : undefined,
          memberName: memberSnapshot?.account.customer_name,
          pointsEarned: hasMember ? earned : undefined,
          rewardRedeemed: order.reward_redeemed,
        });
      })
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'กรุณาแจ้งผู้จัดการ';
      // Backend re-validates promotions at checkout — surface a specific message if a promo was rejected.
      const promoIssue = promoSnapshot.length > 0 && /promo|โปร|exclusive|expir|หมดอายุ|active|window|เวลา/i.test(msg);
      toast({
        kind: 'warning',
        title: promoIssue ? 'โปรโมชั่นใช้ไม่ได้' : 'บิลบันทึกไม่สำเร็จ',
        msg: promoIssue ? `${msg} — กรุณาตรวจสอบโปรโมชั่นแล้วลองใหม่` : msg,
        duration: 4500,
      });
    });
  };

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg)'}}>
      {/* Mobile tab strip — hidden on md+ */}
      <div role="tablist" aria-label="POS sections" className="flex md:hidden shrink-0" style={{
        height: 44,
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'menu'}
          onClick={() => setActiveTab('menu')}
          style={{
            flex: 1, fontWeight: 600, fontSize: 14,
            color: activeTab === 'menu' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            borderBottom: activeTab === 'menu' ? '2px solid var(--color-accent)' : '2px solid transparent',
            background: 'none', transition: 'all 150ms',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          เมนู
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cart'}
          onClick={() => setActiveTab('cart')}
          style={{
            flex: 1, fontWeight: 600, fontSize: 14,
            color: activeTab === 'cart' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            borderBottom: activeTab === 'cart' ? '2px solid var(--color-accent)' : '2px solid transparent',
            background: 'none', transition: 'all 150ms',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          ตะกร้า
          {cartCount > 0 && (
            <span aria-label={`${cartCount} รายการ`} style={{
              background: 'var(--color-primary)', color: 'white',
              borderRadius: 999, fontSize: 11, fontWeight: 700,
              padding: '1px 6px', lineHeight: '16px',
            }}>{cartCount}</span>
          )}
        </button>
      </div>

      {/* Two-panel row */}
      <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
        {/* LEFT: Menu — full-width on mobile, 60% on md+ */}
        <div
          className={`${activeTab === 'menu' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[60%] md:max-w-[60%] shrink-0`}
          style={{borderRight: '1px solid var(--color-border)'}}
        >
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
              <CategoryTab label="ทั้งหมด" active={category === 'all'} onClick={() => { setCategory('all'); setSearch(''); }} />
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
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-danger)'}}>
                <div style={{marginBottom: 8}}><Icon name="warning" size={32}/></div>
                ไม่สามารถโหลดเมนูได้ กรุณาตรวจสอบการเชื่อมต่อ
              </div>
            ) : prodLoading ? (
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-text-muted)'}}>
                กำลังโหลดเมนู...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]" style={{gap: 12}}>
                  {filtered.map((m) => <MenuCard key={m.id} item={m} onClick={() => onMenuClick(m)} />)}
                </div>
                {filtered.length === 0 && (
                  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-text-muted)'}}>
                    <div style={{marginBottom: 8}}><Icon name="search" size={32}/></div>
                    ไม่พบเมนูที่ค้นหา
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Cart — full-width on mobile, 40% on md+ */}
        <div
          className={`${activeTab === 'cart' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[40%] md:max-w-[40%] shrink-0`}
          style={{background: 'var(--color-surface)'}}
        >
          <div style={{padding: '20px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
              <div style={{fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500}}>บิลปัจจุบัน</div>
              <div style={{fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}} className="num">A0{billNo}</div>
            </div>
            <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
              {memberInfo ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 12px',
                  borderRadius: 999, background: 'var(--color-accent-50)', border: '1px solid var(--color-accent)',
                }}>
                  <Icon name="user" size={14} color="var(--color-accent-600)" />
                  <div style={{lineHeight: 1.1}}>
                    <div style={{fontSize: 12, fontWeight: 700, color: 'var(--color-primary-700)'}}>{memberInfo.account.customer_name}</div>
                    <div style={{fontSize: 10, color: 'var(--color-accent-600)'}}>
                      {memberInfo.account.points_balance.toLocaleString()} แต้ม{memberInfo.redeemReward ? ' • แลกรางวัล' : ''}
                    </div>
                  </div>
                  <button onClick={() => setMemberInfo(null)} title="นำสมาชิกออก"
                    style={{width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', color: 'var(--color-accent-600)'}}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ) : (
                <button className="btn btn-ghost" style={{padding: '8px 12px', fontSize: 12}} onClick={() => setShowMembership(true)}>
                  <Icon name="user" size={14}/> ลูกค้า
                </button>
              )}
              <button className="btn btn-ghost" style={{padding: 8}} title="Park bill">
                <Icon name="park" size={16}/>
              </button>
            </div>
          </div>

          <div className="scroll" style={{flex: 1, overflow: 'auto', padding: '8px 0'}}>
            {cart.length === 0 ? (
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-text-muted)'}}>
                <div style={{marginBottom: 12, opacity: 0.6}}><Icon name="cart" size={48}/></div>
                <div style={{fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4}}>ตะกร้าว่าง</div>
                <div style={{fontSize: 13}}>เลือกเมนูจากด้านซ้ายเพื่อเริ่มออเดอร์</div>
              </div>
            ) : cart.map((l, i) => (
              <CartLine key={i} line={l} onInc={() => updateQty(i, +1)} onDec={() => updateQty(i, -1)} onRemove={() => removeLine(i)} />
            ))}
          </div>

          {/* Sticky checkout section on mobile */}
          <div style={{flexShrink: 0, borderTop: '1px solid var(--color-border)'}}>
            <div style={{padding: 20, background: 'var(--color-surface-2)'}}>
              <Row label="ยอดรวม" value={baht(subtotal)} />
              {memberDiscount > 0 && <Row label="ส่วนลดสมาชิก (โดยประมาณ)" value={`-${baht(memberDiscount)}`} />}
              {promoDiscount > 0 && <Row label="ส่วนลดโปรโมชั่น" value={`-${baht(promoDiscount)}`} />}
              {discount === 0 && <Row label="ส่วนลด" value={baht(0)} muted />}
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
                <button className="btn btn-ghost" style={{flex: 1, fontSize: 12, padding: 8, opacity: eligiblePromos.length ? 1 : 0.5}}
                  onClick={() => eligiblePromos.length && setShowPromoPanel(true)} disabled={!eligiblePromos.length}>
                  <Icon name="discount" size={14}/> โปรโมชั่น
                  {eligiblePromos.length > 0 && (
                    <span style={{ marginLeft: 4, background: 'var(--color-accent)', color: 'var(--color-primary-700)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>
                      {selectedPromoIds.length > 0 ? `${selectedPromoIds.length}/${eligiblePromos.length}` : eligiblePromos.length}
                    </span>
                  )}
                </button>
                <button className="btn btn-ghost" style={{flex: 1, fontSize: 12, padding: 8}} onClick={() => cart.length && clearCart()}>
                  <Icon name="void" size={14}/> Void
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {modifierItem && (
        <ModifierModal
          item={modifierItem}
          groupIds={modifierGroupIds}
          onClose={() => { setModifierItem(null); setModifierGroupIds([]); }}
          onAdd={(line) => {
            addLine(line);
            toast({ kind: 'success', title: 'เพิ่มลงตะกร้า', msg: `${line.name} • ${baht(line.unitPrice)}`, duration: 1800 });
            setModifierItem(null);
            setModifierGroupIds([]);
          }}
        />
      )}
      {showMembership && (
        <MembershipModal
          onClose={() => setShowMembership(false)}
          onSelectMember={(info) => { setMemberInfo(info); setShowMembership(false); }}
        />
      )}
      {showPromoPanel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowPromoPanel(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 520, maxHeight: '70vh', overflowY: 'auto', padding: 20, boxShadow: '0 -8px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>โปรโมชั่นที่ใช้ได้</div>
              <button onClick={() => setShowPromoPanel(false)} style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center' }}><Icon name="x" size={16} /></button>
            </div>
            {eligiblePromos.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>ไม่มีโปรโมชั่นที่ใช้ได้กับตะกร้านี้</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {eligiblePromos.map(e => {
                  const checked = selectedPromoIds.includes(e.promotion_id);
                  const locked = !!exclusiveSelected && exclusiveSelected.promotion_id !== e.promotion_id;
                  return (
                    <label key={e.promotion_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: checked ? 'var(--color-accent-50)' : 'var(--color-surface-2)', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.5 : 1 }}>
                      <input type="checkbox" checked={checked} disabled={locked} onChange={() => togglePromo(e)} style={{ width: 16, height: 16 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {e.name}{e.is_exclusive && <span style={{ fontSize: 11, color: 'var(--color-danger)', fontWeight: 600 }}> • ใช้เดี่ยว</span>}
                        </div>
                      </div>
                      <div className="num" style={{ fontWeight: 700, color: 'var(--color-accent-600)' }}>-{baht(Number(e.discount_amount))}</div>
                    </label>
                  );
                })}
              </div>
            )}
            <button onClick={() => setShowPromoPanel(false)} style={{ marginTop: 16, width: '100%', padding: 12, borderRadius: 10, background: 'var(--color-primary)', color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              ใช้ส่วนลด{promoDiscount > 0 ? ` (-${baht(promoDiscount)})` : ''}
            </button>
          </div>
        </div>
      )}
      {payment && (
        <PaymentModal method={payment} total={total} billNo={billNo} onClose={() => setPayment(null)} onPaid={onPaid} />
      )}
      {receiptData && (
        <ReceiptModal
          data={receiptData}
          onClose={() => setReceiptData(null)}
          onPrint={async () => {
            await printReceipt({
              orderNumber: receiptData.orderNumber,
              items: receiptData.items,
              subtotal: receiptData.subtotal,
              total: receiptData.total,
              paymentMethod: receiptData.paymentMethod,
              cashGiven: receiptData.cashGiven,
              memberName: receiptData.memberName,
            });
          }}
        />
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
