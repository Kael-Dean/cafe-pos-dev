'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../icons';
import { useToast, baht, Select, ModalShell } from '../app-common';
import { useI18n } from '@/lib/i18n';
import { useAllProducts, useCategories, type MenuItem } from '@/hooks/use-products';
import { useBestSellerNames } from '@/hooks/use-best-sellers';
import { productDetailQuery, type ProductDetail } from '@/hooks/use-bom';
import { haptic } from '@/lib/haptics';
import { UndoBar, useUndo } from '@/components/ui/undo-bar';
import { useCreateOrder, usePayOrder, useSetOrderDate, displayOrderNo } from '@/hooks/use-orders';
import { TABLE_TIME_PRODUCT_NAME } from '@/hooks/use-features';
import { ApiError } from '@/lib/api-client';
import { useEvaluatePromotions, type EligiblePromotion } from '@/hooks/use-promotions';
import ModifierModal from './modifier-modal';
import PaymentModal from './payment-modal';
import ReceiptModal, { type ReceiptData } from './receipt-modal';
import MembershipModal, { type MemberInfo } from './membership-modal';
import { useMembershipProgram, type ProgramRead } from '@/hooks/use-membership';
import { useCustomerDetail } from '@/hooks/use-customers';
import { usePrinter } from '@/hooks/use-printer';
import { useStagger } from '@/lib/motion';
import { useIsPhone } from '@/hooks/use-media-query';

interface CartLine { menuId: string; name: string; basePrice: number; unitPrice: number; qty: number; mods: string[]; modIds: string[]; modKey: string; }

/** addLine merges on exactly (menuId, modKey), so this pair identifies a line. */
const lineKey = (l: { menuId: string; modKey: string }) => `${l.menuId}|${l.modKey}`;

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

export interface POSTableSession {
  sessionId: string;
  tableName: string;
}

interface POSTerminalProps {
  /**
   * Board-game table tab. While set, checkout creates the order with `session_id`
   * and takes NO payment — the table's food, drinks and time charge are settled
   * together from the floor plan when the session closes.
   */
  session?: POSTableSession | null;
  onClearSession?: () => void;
}

export default function POSTerminal({ session = null, onClearSession }: POSTerminalProps = {}) {
  const toast = useToast();
  const { t } = useI18n();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [billNo, setBillNo] = useState(48);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [modifierGroupIds, setModifierGroupIds] = useState<string[]>([]);
  const [payment, setPayment] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  // Server-issued order time for the live receipt; keeps the IV "เลขที่:" stable across reprints.
  const [receiptIssuedAt, setReceiptIssuedAt] = useState<Date | null>(null);
  // Order id behind the live receipt — lets us backdate it (past-sale entry).
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'menu' | 'cart'>('menu');
  const [showMembership, setShowMembership] = useState(false);
  const [membershipPhase, setMembershipPhase] = useState<'lookup' | 'register'>('lookup');
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [eligiblePromos, setEligiblePromos] = useState<EligiblePromotion[]>([]);
  const [selectedPromoIds, setSelectedPromoIds] = useState<string[]>([]);
  const [showPromoPanel, setShowPromoPanel] = useState(false);
  // "Void bill" wipes the whole cart, so it asks first — it sits right beside
  // the promotions button and is easy to hit by mistake on a phone.
  const [confirmVoid, setConfirmVoid] = useState(false);
  // Phones (< 768px): the cart panel swaps its checkout block for a compact one and
  // the menu panel grows a "cart" bar. Structure differs, so this is a hook, not CSS.
  const isPhone = useIsPhone();
  // Phone only: subtotal / discount rows are folded behind the grand-total row.
  const [totalsOpen, setTotalsOpen] = useState(false);

  const { data: categories, isLoading: catsLoading } = useCategories();
  const { data: rawProducts, isLoading: prodLoading, isError } = useAllProducts();
  const { data: bestSellers } = useBestSellerNames();

  // Overlay real best-sellers (last 30 days) onto the catalog — drives the
  // ★ ขายดี tab + the best-seller badge. mapProduct keeps hot:false as default.
  const products = useMemo(
    () => (rawProducts ?? []).map(m => ({ ...m, hot: bestSellers?.has(m.name) ?? false })),
    [rawProducts, bestSellers],
  );
  const { data: program } = useMembershipProgram();
  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const setOrderDate = useSetOrderDate();
  const evaluate = useEvaluatePromotions();
  const { printReceipt } = usePrinter();

  // ── Add to cart (TOUCH-SPEC §3.3): optimistic ──────────────────────────────
  // Whether a product needs the modifier modal comes from its detail. The list
  // endpoint does not carry it yet, so the details of the visible category are
  // prefetched in the background; a tap on a product whose detail is cached adds
  // the line synchronously. Unknown detail → the card shows a pending state, the
  // taps made meanwhile are queued (never dropped) and land when the fetch resolves.
  const queryClient = useQueryClient();
  const undo = useUndo();
  // Product id → taps waiting for its detail.
  const queuedTaps = useRef(new Map<string, number>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  // The cart line that last changed; `n` re-keys the flash so it replays on repeat taps.
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null);
  const flashSeq = useRef(0);

  // Auto-select first real category if fav is empty after load
  useEffect(() => {
    if (category === 'fav' && !prodLoading && products?.every(p => !p.hot) && categories?.[0]) {
      setCategory(categories[0].id);
    }
  }, [products, prodLoading, categories, category]);

  const filtered = useMemo(() => {
    if (!products) return [];
    // COMPONENT = ส่วนผสมทำเอง (ไม่ขาย) — กันไม่ให้โผล่ในหน้าขาย (BE ก็ block 422 อีกชั้น)
    // ค่าโต๊ะ = สินค้าระบบที่ backend สร้าง/คิดเงินเองตอนปิดโต๊ะ — ห้ามให้พนักงานหยิบใส่ตะกร้าเอง
    const sellable = products.filter(m => m.productType !== 'COMPONENT' && m.name !== TABLE_TIME_PRODUCT_NAME);
    if (search.trim()) {
      const s = search.toLowerCase();
      return sellable.filter(m => m.name.toLowerCase().includes(s) || m.nameEn.toLowerCase().includes(s));
    }
    if (category === 'fav') {
      const favs = sellable.filter(m => m.hot);
      return favs.length > 0 ? favs : sellable;
    }
    if (category === 'all') return sellable;
    return sellable.filter(m => m.cat === category);
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

  // Resolve the attached member's assigned salesperson (เซลส์) so it can be shown
  // on the bill chip and printed on the receipt. Disabled until a member is set.
  const { data: memberCustomer } = useCustomerDetail(memberInfo?.account.customer_id);
  const memberSalesName = memberCustomer?.sales_name ?? undefined;

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const memberDiscount = estimateMemberDiscount(memberInfo, program, subtotal);
  const discount = Math.min(subtotal, memberDiscount + promoDiscount);
  const total = subtotal - discount;

  // ── Member reward redemption — offered inside the promotions panel ──────────
  const rewardType = memberInfo?.program?.reward_type ?? null;
  const isFreeItemReward = rewardType === 'FREE_ITEM';

  // Distinct products currently in the cart — a FREE_ITEM reward targets one product.
  const cartProducts = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; price: number }>();
    for (const l of cart) if (!seen.has(l.menuId)) seen.set(l.menuId, { id: l.menuId, name: l.name, price: l.basePrice });
    return Array.from(seen.values());
  }, [cart]);

  // Which cart products may be taken as the free item. Empty eligible list = any item.
  const redeemableCartProducts = useMemo(() => {
    if (!memberInfo) return [] as { id: string; name: string; price: number }[];
    const ids = memberInfo.eligibleRewardProducts.map(p => p.id);
    return ids.length ? cartProducts.filter(p => ids.includes(p.id)) : cartProducts;
  }, [memberInfo, cartProducts]);

  // Show the redeem row only when points qualify and the reward can actually apply.
  const redeemAvailable = !!memberInfo?.rewardRedeemable && cart.length > 0
    && (!isFreeItemReward || redeemableCartProducts.length > 0);

  const toggleRedeem = (on: boolean) => {
    setMemberInfo(m => {
      if (!m) return m;
      if (!on) return { ...m, redeemReward: false, rewardProduct: null };
      let rp = m.rewardProduct;
      if (m.program?.reward_type === 'FREE_ITEM' && !rp) {
        // Default to the priciest eligible item — best value for the customer.
        const best = [...redeemableCartProducts].sort((a, b) => b.price - a.price)[0];
        rp = best ? { id: best.id, name: best.name, price: String(best.price) } : null;
      }
      return { ...m, redeemReward: true, rewardProduct: rp };
    });
  };

  const pickRewardProduct = (productId: string) => {
    const p = redeemableCartProducts.find(x => x.id === productId);
    if (!p) return;
    setMemberInfo(m => m ? { ...m, rewardProduct: { id: p.id, name: p.name, price: String(p.price) } } : m);
  };

  // Keep the chosen free item valid as the cart changes (it may be removed).
  useEffect(() => {
    if (!memberInfo?.redeemReward || memberInfo.program?.reward_type !== 'FREE_ITEM') return;
    const ids = redeemableCartProducts.map(p => p.id);
    if (memberInfo.rewardProduct && ids.includes(memberInfo.rewardProduct.id)) return;
    const best = [...redeemableCartProducts].sort((a, b) => b.price - a.price)[0];
    setMemberInfo(m => m ? {
      ...m,
      rewardProduct: best ? { id: best.id, name: best.name, price: String(best.price) } : null,
      redeemReward: best ? m.redeemReward : false,
    } : m);
  }, [redeemableCartProducts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel offer / selected counts include the member redeem row alongside promos.
  const panelOfferCount = eligiblePromos.length + (redeemAvailable ? 1 : 0);
  const panelSelectedCount = selectedPromoIds.length + (memberInfo?.redeemReward ? 1 : 0);

  const rewardDescLabel =
    rewardType === 'FREE_ITEM' ? t.pos.rewardFreeItem
    : rewardType === 'DISCOUNT_FIXED' ? t.pos.rewardDiscountFixed
    : rewardType === 'DISCOUNT_PERCENT' ? t.pos.rewardDiscountPercent
    : '';
  const pointsToRedeem = memberInfo?.program?.points_to_redeem ?? 0;
  const pointsBalance = memberInfo?.account.points_balance ?? 0;

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
    // The cart is the feedback: flash the touched line + a haptic tick, no toast.
    flashSeq.current += 1;
    setFlash({ key: lineKey(line), n: flashSeq.current });
    haptic();
  };

  /** Act on a product whose detail is known: modal for modifiers, else add `qty` now. */
  const resolveTap = (item: MenuItem, detail: ProductDetail, qty: number) => {
    if (detail.hasModifiers) {
      setModifierGroupIds(detail.modifierGroupIds);
      setModifierItem(item);
      return;
    }
    addLine({ menuId: item.id, name: item.name, basePrice: item.price, unitPrice: item.price, qty, mods: [], modIds: [], modKey: '' });
  };

  const setPending = (id: string, on: boolean) => setPendingIds((cur) => {
    if (cur.has(id) === on) return cur;
    const next = new Set(cur);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const onMenuTap = (item: MenuItem) => {
    const cached = queryClient.getQueryData<ProductDetail>(productDetailQuery(item.id).queryKey);
    if (cached) { resolveTap(item, cached, 1); return; }
    const queued = queuedTaps.current.get(item.id) ?? 0;
    queuedTaps.current.set(item.id, queued + 1);
    if (queued > 0) return; // a fetch is already in flight; this tap rides on it
    setPending(item.id, true);
    queryClient.fetchQuery(productDetailQuery(item.id))
      .then((detail) => {
        const n = queuedTaps.current.get(item.id) ?? 1;
        queuedTaps.current.delete(item.id);
        setPending(item.id, false);
        resolveTap(item, detail, n);
      })
      .catch(() => {
        queuedTaps.current.delete(item.id);
        setPending(item.id, false);
        toast({
          kind: 'danger',
          title: t.touchPos.addFailed(item.name),
          msg: t.touchPos.addFailedMsg,
          action: { label: t.touchPos.retry, onAction: () => onMenuTap(item) },
        });
      });
  };

  // Prefetch the details of the products on screen (low priority, staggered) so the
  // first tap on any of them is already an instant add. Re-runs per category / search.
  useEffect(() => {
    const ids = filtered.slice(0, 60).map((m) => m.id)
      .filter((id) => !queryClient.getQueryData(productDetailQuery(id).queryKey));
    if (!ids.length) return;
    let cancelled = false;
    let timer = 0;
    const next = (i: number) => {
      if (cancelled || i >= ids.length) return;
      void queryClient.prefetchQuery({ ...productDetailQuery(ids[i]), staleTime: 5 * 60_000 });
      timer = window.setTimeout(() => next(i + 1), 40);
    };
    timer = window.setTimeout(() => next(0), 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [filtered, queryClient]);

  // Bring the line that just changed into view (a long bill scrolls).
  useEffect(() => {
    if (!flash) return;
    document.querySelector(`[data-line-key="${CSS.escape(flash.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [flash]);

  // How many of each product are on the bill — the badge on the menu card.
  const qtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.menuId, (m.get(l.menuId) ?? 0) + l.qty);
    return m;
  }, [cart]);

  /** Remove a line, with a 5s undo that puts it back where it was. */
  const removeLineWithUndo = (key: string) => {
    const index = cart.findIndex((l) => lineKey(l) === key);
    if (index < 0) return;
    const line = cart[index];
    setCart((cur) => cur.filter((l) => lineKey(l) !== key));
    undo.push(t.touchPos.lineRemoved(line.name), () => {
      setCart((cur) => {
        const at = cur.findIndex((l) => lineKey(l) === key);
        if (at >= 0) {
          const next = [...cur];
          next[at] = { ...next[at], qty: next[at].qty + line.qty };
          return next;
        }
        const next = [...cur];
        next.splice(Math.min(index, next.length), 0, line);
        return next;
      });
    });
  };

  const updateQty = (key: string, delta: number) => {
    const line = cart.find((l) => lineKey(l) === key);
    if (!line) return;
    haptic();
    // − at qty 1 removes the line, with the same undo as the trash button.
    if (line.qty + delta <= 0) { removeLineWithUndo(key); return; }
    // Clamped at 1: a second fast tap computed against a stale render must not
    // leave a 0-qty line behind (removal only happens through the branch above).
    setCart((cur) => cur.map((l) => (lineKey(l) === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  };

  const clearCart = () => { setCart([]); setBillNo((b) => b + 1); setMemberInfo(null); setSelectedPromoIds([]); setEligiblePromos([]); setShowPromoPanel(false); undo.dismiss(); };

  /**
   * Board-game tab: create the order against the open table session and stop
   * there. No payment is taken — the order stays PENDING on the table's tab and
   * is settled together with the time charge when the session closes.
   */
  const addToTab = () => {
    if (!session || createOrder.isPending || !cart.length) return;
    const cartSnapshot = [...cart];
    const memberSnapshot = memberInfo;
    const promoSnapshot = selectedPromoIds;
    clearCart();
    createOrder.mutateAsync({
      idempotency_key: crypto.randomUUID(),
      channel: 'DINE_IN',
      session_id: session.sessionId,
      items: cartSnapshot.map(l => ({
        product_id: l.menuId,
        quantity: l.qty,
        modifier_ids: l.modIds,
      })),
      ...(memberSnapshot ? {
        customer_id: memberSnapshot.account.customer_id,
        member_id: memberSnapshot.account.id,
        redeem_reward: memberSnapshot.redeemReward,
        reward_product_id: memberSnapshot.rewardProduct?.id ?? null,
      } : {}),
      ...(promoSnapshot.length ? { promotion_ids: promoSnapshot } : {}),
    }).then(() => {
      toast({
        kind: 'success',
        title: t.pos.tableAdded(session.tableName),
        msg: t.pos.tableAddedMsg,
        duration: 3000,
      });
    }).catch((err: unknown) => {
      // The order was NOT created, so restoring the cart is safe — and it re-runs
      // promotion evaluation before the cashier tries again.
      const msg = err instanceof Error ? err.message : t.pos.contactManager;
      // A 404 with a member attached means the customer no longer exists for this
      // store (the backend scopes customer_id per store and hides the difference).
      // Restoring the member would resend the same dead id on every retry, so drop
      // it and keep the cart. Gated on the snapshot, not on the message: with no
      // member attached customer_id was never sent, so nothing changes there.
      const memberGone = err instanceof ApiError && err.status === 404 && !!memberSnapshot;
      setCart(cartSnapshot);
      setMemberInfo(memberGone ? null : memberSnapshot);
      setSelectedPromoIds(promoSnapshot);
      toast({
        kind: 'warning',
        title: memberGone ? t.pos.memberCleared : t.pos.orderSaveFailed,
        msg: memberGone ? t.pos.memberClearedMsg : t.pos.cartRestoredMsg(msg),
        duration: 4500,
      });
    });
  };

  const onPaid = () => {
    // Re-entrancy guard: ignore the call if an order/payment is already being
    // created, so a double-submit can't produce a duplicate (or empty) order.
    if (createOrder.isPending || payOrder.isPending) return;
    const method = payment;
    const cartSnapshot = [...cart];
    const subtotalSnapshot = subtotal;
    const totalSnapshot = total;
    const discountSnapshot = discount;
    const memberDiscountSnapshot = memberDiscount;
    const memberSnapshot = memberInfo;
    const salesNameSnapshot = memberSalesName;
    const promoSnapshot = selectedPromoIds;
    // Snapshot the selected promos' names + amounts now — clearCart() wipes
    // eligiblePromos below, but the receipt needs the breakdown after the await.
    const promoDetailSnapshot = eligiblePromos
      .filter(e => selectedPromoIds.includes(e.promotion_id))
      .map(e => ({ name: e.name, amount: Number(e.discount_amount) }));
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
        // Attribute the sale to the member's customer so the salesperson KPI
        // (Order → Customer → Salesperson) can pick it up — orders without
        // customer_id are excluded from that report.
        customer_id: memberSnapshot.account.customer_id,
        member_id: memberSnapshot.account.id,
        redeem_reward: memberSnapshot.redeemReward,
        reward_product_id: memberSnapshot.rewardProduct?.id ?? null,
      } : {}),
      ...(promoSnapshot.length ? { promotion_ids: promoSnapshot } : {}),
    }).then(order =>
      payOrder.mutateAsync({
        orderId: order.id,
        payment_method: methodMap[method ?? 'cash'] ?? 'CASH',
      }).then((paid) => {
        // Server is authoritative for discount/total when a member and/or promotions were applied.
        // Points (earn/redeem) are posted at PAYMENT, so read them off the pay
        // response — the create response still carries points_earned=0 /
        // reward_redeemed=false, which would print the pre-redeem balance.
        const hasMember = !!memberSnapshot;
        const serverAuthoritative = hasMember || promoSnapshot.length > 0;
        const serverTotal = order.total != null ? Number(order.total) : totalSnapshot;
        const serverDiscount = order.discount != null ? Number(order.discount) : discountSnapshot;
        const finalTotal = serverAuthoritative ? serverTotal : totalSnapshot;
        const finalDiscount = serverAuthoritative ? serverDiscount : 0;
        const earned = paid.points_earned ?? 0;

        // ── Discount breakdown (cashier-side estimate; total uses server value) ──
        const discountLines: { label: string; amount: number }[] = [];
        for (const p of promoDetailSnapshot) {
          if (p.amount > 0) discountLines.push({ label: p.name, amount: p.amount });
        }
        if (memberSnapshot && memberDiscountSnapshot > 0) {
          const freeItem = memberSnapshot.program?.reward_type === 'FREE_ITEM';
          discountLines.push({
            label: freeItem
              ? `ส่วนลดสมาชิก (${memberSnapshot.rewardProduct?.name ?? 'ของรางวัล'})`
              : 'ส่วนลดสมาชิก',
            amount: memberDiscountSnapshot,
          });
        }

        // ── Points (earn OR redeem — mutually exclusive; server is authoritative
        //    for which happened via reward_redeemed / points_earned) ──
        // The pay/create response may omit reward_redeemed entirely; when it does,
        // fall back to the cashier's own redeem choice (sent as redeem_reward on
        // the order) so the printed balance still reflects the redemption. Only a
        // server-supplied `false` overrides the cashier's intent.
        const didRedeem = paid.reward_redeemed ?? memberSnapshot?.redeemReward ?? false;
        const redeemed = didRedeem
          ? (memberSnapshot?.program?.points_to_redeem ?? program?.points_to_redeem ?? 0)
          : 0;
        const balanceBefore = memberSnapshot?.account.points_balance ?? 0;
        const pointsBalanceAfter = hasMember ? balanceBefore + earned - redeemed : undefined;
        const rewardLabel = didRedeem
          ? (memberSnapshot?.rewardProduct?.name ?? undefined)
          : undefined;
        toast({
          kind: 'success', title: t.pos.paid,
          msg: t.pos.paidMsg(String(displayOrderNo(order)), baht(finalTotal), earned > 0 ? t.pos.pointsPart(earned) : ''),
          duration: 3500,
        });
        setReceiptIssuedAt(new Date(order.created_at));
        setReceiptOrderId(order.id);
        setReceiptData({
          orderNumber: String(displayOrderNo(order)),
          ...(order.receipt_no ? { receiptNo: order.receipt_no } : {}),
          items: cartSnapshot.map(l => ({ name: l.name, qty: l.qty, unitPrice: l.unitPrice, mods: l.mods.length ? l.mods : undefined })),
          subtotal: subtotalSnapshot,
          total: finalTotal,
          paymentMethod: method ?? 'cash',
          paymentLabel: (t.pos.payReceipt as Record<string, string>)[method ?? 'cash'] ?? method ?? 'cash',
          discount: finalDiscount > 0 ? finalDiscount : undefined,
          discountLines: finalDiscount > 0 && discountLines.length > 0 ? discountLines : undefined,
          memberName: memberSnapshot?.account.customer_name,
          salesName: memberSnapshot ? salesNameSnapshot : undefined,
          pointsEarned: hasMember ? earned : undefined,
          pointsRedeemed: redeemed > 0 ? redeemed : undefined,
          rewardLabel,
          pointsBalanceAfter,
          rewardRedeemed: didRedeem,
        });
      }).catch((payErr: unknown) => {
        // The order WAS created (it's already in the kitchen) but recording the
        // payment failed. Do NOT restore the cart — re-submitting would create a
        // duplicate order. Tell the cashier to settle the existing bill instead.
        const pmsg = payErr instanceof Error ? payErr.message : t.pos.tryAgain;
        toast({
          kind: 'warning',
          title: t.pos.paidFailedTitle,
          msg: t.pos.paidFailedMsg(String(displayOrderNo(order)), pmsg),
          duration: 6000,
        });
      })
    ).catch((err: unknown) => {
      // Reached only when createOrder itself failed — the order was NOT created,
      // so it is safe to restore the cart and let the cashier retry. Restoring the
      // cart also re-triggers POST /evaluate (the backend re-validates promotions/
      // membership at checkout — e.g. a HAPPY_HOUR that just expired), refreshing
      // eligibility so the cashier sees the current promos before trying again.
      const msg = err instanceof Error ? err.message : t.pos.contactManager;
      // See addToTab: a 404 while a member is attached means that customer is gone
      // for this store — clearing it is the only way out of an otherwise endless
      // retry with the same dead customer_id.
      const memberGone = err instanceof ApiError && err.status === 404 && !!memberSnapshot;
      setCart(cartSnapshot);
      setMemberInfo(memberGone ? null : memberSnapshot);
      setSelectedPromoIds(promoSnapshot);
      // 422 = checkout re-validation rejected the order (stale promo/membership state).
      const isValidation = err instanceof ApiError && err.status === 422;
      const promoIssue = isValidation && promoSnapshot.length > 0;
      toast({
        kind: 'warning',
        title: memberGone ? t.pos.memberCleared : promoIssue ? t.pos.promoUnusable : t.pos.orderSaveFailed,
        msg: memberGone ? t.pos.memberClearedMsg : promoIssue ? t.pos.promoRefreshedMsg(msg) : t.pos.cartRestoredMsg(msg),
        duration: 4500,
      });
    });
  };

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  // Order/payment being recorded — pay buttons show a spinner and lock out re-entry.
  const paying = createOrder.isPending || payOrder.isPending;

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg)'}}>
      <PosStyles />
      {/* Table-tab banner — the cashier must always be able to see that this sale
          is going on a table's bill instead of being paid now. */}
      {session && (
        <div role="status" className="shrink-0 pos-banner" style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 20px', background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
        }}>
          <Icon name="park" size={18} />
          <div className="pos-banner-text" style={{ flex: 1, minWidth: 180 }}>
            <div className="pos-banner-title" style={{ fontWeight: 700, fontSize: 14 }}>{t.pos.tableBanner(session.tableName)}</div>
            <div className="hide-phone" style={{ fontSize: 'var(--fs-cap)', opacity: 0.85 }}>{t.pos.tableBannerHint}</div>
          </div>
          {onClearSession && (
            <button
              onClick={onClearSession}
              className="btn btn-ghost"
              // No inline minHeight: .btn is already 42px tall, and an inline 40 would
              // beat the 44px phone tap-target rule.
              style={{ color: 'var(--color-text-inverse)', borderColor: 'currentColor' }}
            >
              {t.pos.tableExit}
            </button>
          )}
        </div>
      )}

      {/* Mobile tab strip — hidden on md+ */}
      <div role="tablist" aria-label={t.touchPay.posSections} className="flex md:hidden shrink-0" style={{
        height: 48,
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
          {t.pos.tabMenu}
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
          {t.pos.tabCart}
          {cartCount > 0 && (
            <span aria-label={t.pos.itemsAria(cartCount)} style={{
              background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
              borderRadius: 999, fontSize: 'var(--fs-cap)', fontWeight: 700,
              padding: '1px 7px', lineHeight: '18px',
            }}>{cartCount}</span>
          )}
        </button>
      </div>

      {/* Two-panel row */}
      <div style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
        {/* LEFT: Menu — full-width on mobile, 60% on md+ */}
        <div
          className={`${activeTab === 'menu' ? 'flex' : 'hidden'} md:flex flex-col pos-menu`}
          style={{borderRight: '1px solid var(--color-border)'}}
        >
          <div className="pos-menu-head" style={{padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 12}}>
            <div style={{display: 'flex', gap: 12, alignItems: 'center'}}>
              {/* Phones: the tab above already says "เมนู" — the search gets the full row. */}
              <h1 className="hide-phone" style={{margin: 0, fontSize: 'var(--fs-h2)', fontWeight: 700, letterSpacing: '-0.01em'}}>{t.pos.menuTitle}</h1>
              <div style={{flex: 1, position: 'relative'}}>
                <div style={{position: 'absolute', top: 0, bottom: 0, left: 14, display: 'grid', placeItems: 'center', color: 'var(--color-text-muted)', pointerEvents: 'none'}}>
                  <Icon name="search" size={18} />
                </div>
                <input type="text" placeholder={t.pos.searchPlaceholder}
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  aria-label={t.pos.searchPlaceholder}
                  className="input-std pos-search"
                  style={{
                    width: '100%', padding: `0 ${search ? 52 : 14}px 0 42px`, height: 'var(--tap-std)',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)', borderRadius: 8,
                    fontSize: 'var(--fs-lg)', outline: 'none',
                  }}
                />
                {search && (
                  <button type="button" className="tap tap-min tap-sq" aria-label={t.ui.clearSearch}
                    onClick={() => setSearch('')}
                    style={{ position: 'absolute', top: 2, right: 2, width: 44, height: 44, minHeight: 44, borderRadius: 6, color: 'var(--color-text-secondary)' }}>
                    <Icon name="x" size={18} />
                  </button>
                )}
              </div>
            </div>
            <div style={{display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap'}} className="scroll tab-strip">
              <CategoryTab label={t.pos.catFav} active={category === 'fav'} onClick={() => { setCategory('fav'); setSearch(''); }} highlight />
              <CategoryTab label={t.pos.catAll} active={category === 'all'} onClick={() => { setCategory('all'); setSearch(''); }} />
              {catsLoading && !categories ? (
                <div aria-hidden style={{ display: 'flex', gap: 8 }}>
                  {[72, 96, 80, 88].map((w, i) => (
                    <div key={i} className="skeleton pos-chip-skel" style={{ width: w, borderRadius: 'var(--radius-pill)', flexShrink: 0 }} />
                  ))}
                </div>
              ) : (
                (categories ?? []).map((c) => (
                  <CategoryTab key={c.id} label={c.label} active={category === c.id} onClick={() => { setCategory(c.id); setSearch(''); }} />
                ))
              )}
            </div>
          </div>

          <div className="scroll pos-menu-scroll" style={{flex: 1, overflow: 'auto'}}>
            {isError ? (
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-danger)'}}>
                <div style={{marginBottom: 8}}><Icon name="warning" size={32}/></div>
                {t.pos.loadMenuError}
              </div>
            ) : prodLoading ? (
              /* Skeleton grid mirrors the real card layout so there is no layout shift */
              <div aria-hidden className="pos-grid">
                <span className="sr-only">{t.pos.loadingMenu}</span>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 12, overflow: 'hidden',
                  }}>
                    <div className="skeleton" style={{ aspectRatio: '4 / 3', borderRadius: 0 }} />
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="skeleton" style={{ height: 15, width: '80%' }} />
                      <div className="skeleton" style={{ height: 16, width: '45%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Keyed by category only: switching category remounts the grid and the
                    cards stagger in (a deliberate, infrequent tap). Typing in search
                    filters the cards in place with no re-animation — a cashier typing
                    fast wants instant results, not motion on every keystroke. */}
                <ProductGrid key={category}>
                  {filtered.map((m) => (
                    <MenuCard key={m.id} item={m} inCart={qtyByProduct.get(m.id) ?? 0}
                      pending={pendingIds.has(m.id)} onTap={() => onMenuTap(m)} />
                  ))}
                </ProductGrid>
                {filtered.length === 0 && (
                  <div className="fade-in" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-16) var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)'}}>
                    <div style={{
                      width: 64, height: 64, borderRadius: 'var(--radius-pill)',
                      background: 'var(--color-surface-2)', display: 'grid', placeItems: 'center',
                      marginBottom: 'var(--space-4)',
                    }}>
                      <Icon name={search.trim() ? 'search' : 'coffee'} size={28}/>
                    </div>
                    <div style={{fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>
                      {search.trim() ? t.pos.noSearchResults : t.pos.emptyCategory}
                    </div>
                    <div style={{fontSize: 'var(--fs-sm)'}}>
                      {search.trim() ? t.pos.noSearchHint : t.pos.emptyCategoryHint}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Phones: running total under the menu. A flex child of the panel (not
              position: fixed), so it always sits above the bottom tab bar. */}
          {isPhone && cartCount > 0 && (
            <div className="pos-cartbar-wrap">
              <button type="button" className="pos-cartbar pressable" onClick={() => setActiveTab('cart')}>
                <Icon name="cart" size={20} />
                <span>{t.pos.tabCart}</span>
                {/* keyed so the pill replays its short bump when the count changes */}
                <span key={cartCount} className="num pos-cartbar-count">{t.pos.itemsAria(cartCount)}</span>
                <span className="num pos-cartbar-total">{baht(total)}</span>
                <Icon name="chevronRight" size={18} />
              </button>
              <span className="sr-only" role="status">{t.pos.tabCart} {t.pos.itemsAria(cartCount)} {baht(total)}</span>
            </div>
          )}
        </div>

        {/* RIGHT: Cart — full-width on mobile, 40% on md+ */}
        <div
          className={`${activeTab === 'cart' ? 'flex' : 'hidden'} md:flex flex-col pos-cart`}
          style={{background: 'var(--color-surface)'}}
        >
          <div className="pos-cart-head" style={{padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12}}>
            <div className="pos-bill">
              <div className="pos-bill-label" style={{fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)', fontWeight: 500}}>{t.pos.currentBill}</div>
              <div style={{fontSize: 'var(--fs-h1)', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2}} className="num pos-bill-no">{'A' + String(billNo).padStart(3, '0')}</div>
            </div>
            <div className="pos-cart-actions" style={{display: 'flex', gap: 8, alignItems: 'center', minWidth: 0}}>
              {memberInfo ? (
                <div className="pos-member-chip" style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 2px 12px', minWidth: 0,
                  borderRadius: 999, background: 'var(--color-accent-50)', border: '1px solid var(--color-accent)',
                }}>
                  <Icon name="user" size={16} color="var(--color-accent-600)" style={{flexShrink: 0}} />
                  <div className="pos-member-text" style={{lineHeight: 1.25, minWidth: 0}}>
                    <div style={{fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--color-primary-700)'}}>{memberInfo.account.customer_name}</div>
                    {/* Points and salesperson share one line, so the chip stays two lines tall. */}
                    <div style={{fontSize: 'var(--fs-cap)', color: 'var(--color-accent-600)'}}>
                      <span className="num">{t.pos.pointsUnit(memberInfo.account.points_balance.toLocaleString())}{memberInfo.redeemReward ? t.pos.redeemSuffix : ''}</span>
                      {memberSalesName && (
                        <span style={{color: 'var(--color-text-secondary)'}}> · {t.pos.salesLabel}: {memberSalesName}</span>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => setMemberInfo(null)} aria-label={t.pos.removeMember}
                    className="tap tap-min tap-sq"
                    style={{width: 44, height: 44, minHeight: 44, borderRadius: 999, color: 'var(--color-accent-600)'}}>
                    <Icon name="x" size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost pos-head-btn tap-std" style={{padding: '0 14px', fontSize: 'var(--fs-sm)'}} onClick={() => { setMembershipPhase('lookup'); setShowMembership(true); }}>
                    <Icon name="user" size={16}/> {t.pos.customer}
                  </button>
                  <button type="button" className="btn btn-ghost pos-head-btn tap-std" style={{padding: '0 14px', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap'}} onClick={() => { setMembershipPhase('register'); setShowMembership(true); }}>
                    <Icon name="plus" size={16}/> {t.pos.register}
                  </button>
                </>
              )}
              {/* Park bill: hidden until the park feature exists (TOUCH-SPEC §3.4, no
                  dead controls). When it lands it is a 48×48 icon button here. */}
            </div>
          </div>

          {/* Positioned so the undo bar pins to the bottom of the line list, above the totals. */}
          <div style={{flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column'}}>
            <div className="scroll pos-lines" style={{flex: 1, overflow: 'auto', paddingBottom: undo.entry ? 72 : undefined}}>
              {cart.length === 0 ? (
                <div className="pos-empty" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--color-text-muted)'}}>
                  <div style={{marginBottom: 12, opacity: 0.6}}><Icon name="cart" size={48}/></div>
                  <div style={{fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4}}>{t.pos.emptyCart}</div>
                  <div style={{fontSize: 'var(--fs-sm)'}}>{t.pos.emptyCartHint}</div>
                </div>
              ) : cart.map((l) => {
                const key = lineKey(l);
                return (
                  // Keyed by (menuId, modKey) — unique per line; index keys would
                  // misattach rows when a middle line is removed.
                  <CartLine key={key} lineId={key} line={l}
                    flashN={flash?.key === key ? flash.n : 0}
                    onInc={() => updateQty(key, +1)} onDec={() => updateQty(key, -1)}
                    onRemove={() => removeLineWithUndo(key)} />
                );
              })}
            </div>
            <UndoBar undo={undo} />
          </div>

          {isPhone ? (
            /* Phone checkout: the line list keeps the height. Subtotal / discount rows
               fold behind the grand-total row, and the four methods share one row —
               still one tap from the cart to the payment dialog. */
            <div className="pos-co">
              {totalsOpen && (
                <div id="pos-co-rows" className="pos-co-rows">
                  <Row label={t.pos.subtotal} value={baht(subtotal)} />
                  {memberDiscount > 0 && <Row label={t.pos.memberDiscount} value={`-${baht(memberDiscount)}`} />}
                  {promoDiscount > 0 && <Row label={t.pos.promoDiscount} value={`-${baht(promoDiscount)}`} />}
                  {discount === 0 && <Row label={t.pos.discount} value={baht(0)} muted />}
                </div>
              )}
              <button type="button" className="pos-co-total" aria-expanded={totalsOpen} aria-controls="pos-co-rows" onClick={() => setTotalsOpen(v => !v)}>
                <span className="pos-co-total-text">
                  <span className="pos-co-total-label">{t.pos.grandTotal}</span>
                  <span className="num pos-co-total-sub">
                    {t.pos.itemsAria(cartCount)}{discount > 0 ? ` · ${t.pos.discount} -${baht(discount)}` : ''}
                  </span>
                </span>
                <span className="num pos-co-amount">{baht(total)}</span>
                {/* the rows open upward, so the chevron points up while closed */}
                <Icon name="chevronDown" size={16} style={{ flexShrink: 0, color: 'var(--color-text-secondary)', transform: totalsOpen ? 'none' : 'rotate(180deg)' }} />
              </button>
              <div className="pos-co-actions">
                {session ? (
                  <PayButton compact icon="park" label={t.pos.tableAddToTab} onClick={addToTab} disabled={!cart.length} pending={paying} primary />
                ) : (
                  <div className="pos-co-pay">
                    <PayButton compact icon="cash" label={t.pos.pay.cash} onClick={() => cart.length && setPayment('cash')} disabled={!cart.length} pending={paying} />
                    <PayButton compact icon="card" label={t.pos.pay.card} onClick={() => cart.length && setPayment('card')} disabled={!cart.length} pending={paying} />
                    <PayButton compact icon="qr"   label="QR" ariaLabel={t.pos.pay.qr} onClick={() => cart.length && setPayment('qr')} disabled={!cart.length} pending={paying} primary />
                    <PayButton compact icon="line" label={t.pos.pay.line} onClick={() => cart.length && setPayment('line')} disabled={!cart.length} pending={paying} />
                  </div>
                )}
                <SecondaryActions offerCount={panelOfferCount} selectedCount={panelSelectedCount}
                  onPromos={() => panelOfferCount && setShowPromoPanel(true)}
                  onVoid={() => cart.length && setConfirmVoid(true)} />
              </div>
            </div>
          ) : (
          <div style={{flexShrink: 0, borderTop: '1px solid var(--color-border)'}}>
            <div style={{padding: '14px 16px 12px', background: 'var(--color-surface-2)'}}>
              <Row label={t.pos.subtotal} value={baht(subtotal)} />
              {memberDiscount > 0 && <Row label={t.pos.memberDiscount} value={`-${baht(memberDiscount)}`} />}
              {promoDiscount > 0 && <Row label={t.pos.promoDiscount} value={`-${baht(promoDiscount)}`} />}
              {discount === 0 && <Row label={t.pos.discount} value={baht(0)} muted />}
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8}}>
                <div style={{fontSize: 'var(--fs-body)', fontWeight: 600}}>{t.pos.grandTotal}</div>
                <div className="num text-num-lg" style={{letterSpacing: '-0.02em', color: 'var(--color-primary)'}}>
                  {baht(total)}
                </div>
              </div>
            </div>

            <div style={{padding: '12px 16px 16px', display: 'grid', gap: 8}}>
              {session ? (
                // Table mode: one action, and it takes no money. Payment happens
                // once, at close-out, for the whole tab plus the time charge.
                <PayButton icon="park" label={t.pos.tableAddToTab} onClick={addToTab} disabled={!cart.length} pending={paying} primary />
              ) : (
                <div className="pos-pay-grid">
                  <PayButton icon="cash"  label={t.pos.pay.cash} onClick={() => cart.length && setPayment('cash')} disabled={!cart.length} pending={paying} />
                  <PayButton icon="card"  label={t.pos.pay.card} onClick={() => cart.length && setPayment('card')} disabled={!cart.length} pending={paying} />
                  <PayButton icon="qr"    label={t.pos.pay.qr}   onClick={() => cart.length && setPayment('qr')}   disabled={!cart.length} pending={paying} primary />
                  <PayButton icon="line"  label={t.pos.pay.line} onClick={() => cart.length && setPayment('line')} disabled={!cart.length} pending={paying} />
                </div>
              )}
              <SecondaryActions offerCount={panelOfferCount} selectedCount={panelSelectedCount}
                onPromos={() => panelOfferCount && setShowPromoPanel(true)}
                onVoid={() => cart.length && setConfirmVoid(true)} />
            </div>
          </div>
          )}
        </div>
      </div>

      {modifierItem && (
        <ModifierModal
          item={modifierItem}
          groupIds={modifierGroupIds}
          onClose={() => { setModifierItem(null); setModifierGroupIds([]); }}
          onAdd={(line) => {
            addLine(line); // feedback = line flash + card badge + haptic, never a toast
            setModifierItem(null);
            setModifierGroupIds([]);
          }}
        />
      )}
      {showMembership && (
        <MembershipModal
          initialPhase={membershipPhase}
          onClose={() => setShowMembership(false)}
          onSelectMember={(info) => { setMemberInfo(info); setShowMembership(false); }}
        />
      )}
      {showPromoPanel && (
        <ModalShell
          title={t.pos.promoPanelTitle}
          onClose={() => setShowPromoPanel(false)}
          width={520}
          footer={
            <button onClick={() => setShowPromoPanel(false)} className="btn btn-primary btn-lg" style={{ flex: 1, minHeight: 48 }}>
              {t.pos.applyDiscount}{discount > 0 ? ` (-${baht(discount)})` : ''}
            </button>
          }
        >
            {/* Member reward redemption — shown alongside promotions when points qualify. */}
            {redeemAvailable && memberInfo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 10, marginBottom: 8, border: `1px solid ${memberInfo.redeemReward ? 'var(--color-accent)' : 'var(--color-border)'}`, background: memberInfo.redeemReward ? 'var(--color-accent-50)' : 'var(--color-surface-2)' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={memberInfo.redeemReward} onChange={e => toggleRedeem(e.target.checked)} style={{ width: 22, height: 22, marginTop: 0, flexShrink: 0, accentColor: 'var(--color-accent)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{t.pos.redeemTitle}</div>
                    <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>{t.pos.redeemDesc(pointsToRedeem.toLocaleString(), rewardDescLabel)}</div>
                    <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-accent-600)', marginTop: 2 }}>
                      {t.pos.redeemPointsBalance(pointsBalance.toLocaleString(), Math.max(0, pointsBalance - pointsToRedeem).toLocaleString())}
                    </div>
                  </div>
                  {memberInfo.redeemReward && memberDiscount > 0 && (
                    <div className="num" style={{ fontWeight: 700, color: 'var(--color-accent-600)' }}>-{baht(memberDiscount)}</div>
                  )}
                </label>

                {/* FREE_ITEM: choose which cart item is redeemed. */}
                {memberInfo.redeemReward && isFreeItemReward && (
                  <div>
                    <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)', marginBottom: 6 }}>{t.pos.redeemPickItem}</div>
                    <Select
                      value={memberInfo.rewardProduct?.id ?? ''}
                      onChange={pickRewardProduct}
                      ariaLabel={t.pos.redeemPickItem}
                      options={redeemableCartProducts.map(p => ({ value: p.id, label: `${p.name} · ${baht(p.price)}` }))}
                    />
                  </div>
                )}
              </div>
            )}

            {eligiblePromos.length === 0 ? (
              !redeemAvailable && <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>{t.pos.noPromos}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {eligiblePromos.map(e => {
                  const checked = selectedPromoIds.includes(e.promotion_id);
                  const locked = !!exclusiveSelected && exclusiveSelected.promotion_id !== e.promotion_id;
                  return (
                    <label key={e.promotion_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: checked ? 'var(--color-accent-50)' : 'var(--color-surface-2)', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.5 : 1 }}>
                      <input type="checkbox" checked={checked} disabled={locked} onChange={() => togglePromo(e)} style={{ width: 22, height: 22, flexShrink: 0, accentColor: 'var(--color-accent)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {e.name}{e.is_exclusive && <span style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-danger)', fontWeight: 600 }}>{t.pos.exclusiveSuffix}</span>}
                        </div>
                      </div>
                      <div className="num" style={{ fontWeight: 700, color: 'var(--color-accent-600)' }}>-{baht(Number(e.discount_amount))}</div>
                    </label>
                  );
                })}
              </div>
            )}
        </ModalShell>
      )}
      {confirmVoid && (
        <ModalShell
          title={t.pos.voidConfirmTitle}
          onClose={() => setConfirmVoid(false)}
          width={400}
          footer={<>
            <button onClick={() => setConfirmVoid(false)} className="btn btn-ghost btn-lg" style={{ flex: 1, minHeight: 48 }}>
              {t.pos.voidKeep}
            </button>
            <button onClick={() => { clearCart(); setConfirmVoid(false); }} className="btn btn-danger btn-lg" style={{ flex: 1, minHeight: 48 }}>
              <Icon name="void" size={16}/> {t.pos.voidConfirm}
            </button>
          </>}
        >
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{t.pos.voidConfirmBody(cartCount, baht(total))}</p>
        </ModalShell>
      )}
      {payment && (
        <PaymentModal method={payment} total={total} billNo={billNo} onClose={() => setPayment(null)} onPaid={onPaid} />
      )}
      {/* Gap between payment success and the receipt being ready (order + payment
          round-trips). Without this the screen looks frozen — show the receipt
          modal's backdrop with a spinner so the receipt feels like it's loading in. */}
      {paying && !receiptData && !payment && (
        <div className="fade-in" style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(20, 12, 6, 0.75)', backdropFilter: 'blur(6px)',
          display: 'grid', placeItems: 'center', padding: 20,
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)',
            color: 'white', textAlign: 'center',
          }}>
            <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} aria-hidden />
            <div role="status" aria-live="polite">
              <div style={{ fontSize: 16, fontWeight: 700 }}>{t.pos.preparingReceipt}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>{t.pos.preparingReceiptSub}</div>
            </div>
          </div>
        </div>
      )}
      {receiptData && (
        <ReceiptModal
          data={receiptData}
          issuedAt={receiptIssuedAt ?? undefined}
          onClose={() => { setReceiptData(null); setReceiptIssuedAt(null); setReceiptOrderId(null); }}
          {...(receiptOrderId ? {
            onSaveDate: async (iso: string) => {
              try {
                const updated = await setOrderDate.mutateAsync({ orderId: receiptOrderId, businessDate: iso });
                setReceiptIssuedAt(new Date(updated.created_at));
                // Backdating re-sequences the order for the target day, so refresh
                // BOTH the running order number (daily_number) and the receipt no.
                // — not just the receipt no — so the slip shows the real number of
                // the day it moved to, not the day it was keyed in.
                setReceiptData(prev => prev ? {
                  ...prev,
                  orderNumber: String(displayOrderNo(updated)),
                  receiptNo: updated.receipt_no,
                } : prev);
                toast({ kind: 'success', title: t.touchPay.receiptDateSaved, msg: updated.receipt_no ? t.touchPay.receiptNo(String(updated.receipt_no)) : undefined });
              } catch (e: unknown) {
                toast({ kind: 'danger', title: t.touchPay.receiptDateFailed, msg: e instanceof Error ? e.message : t.pos.tryAgain });
                throw e;
              }
            },
          } : {})}
          onPrint={async () => {
            await printReceipt({
              orderNumber: receiptData.orderNumber,
              ...(receiptData.receiptNo ? { receiptNo: receiptData.receiptNo } : {}),
              items: receiptData.items,
              subtotal: receiptData.subtotal,
              total: receiptData.total,
              paymentMethod: receiptData.paymentMethod,
              cashGiven: receiptData.cashGiven,
              memberName: receiptData.memberName,
              salesName: receiptData.salesName,
              discount: receiptData.discount,
              discountLines: receiptData.discountLines,
              pointsEarned: receiptData.pointsEarned,
              pointsRedeemed: receiptData.pointsRedeemed,
              rewardLabel: receiptData.rewardLabel,
              pointsBalanceAfter: receiptData.pointsBalanceAfter,
              ...(receiptIssuedAt ? { issuedAt: receiptIssuedAt } : {}),
            });
          }}
        />
      )}
    </div>
  );
}

/* Product grid wrapper that staggers its cards in on mount. Remounted (via key)
   on category change so each category switch gets a quick, subtle reveal; the
   stagger is fast and one-shot, never replaying while the cashier works a bill.
   Columns come from the menu column's width (container queries in POS_CSS). */
const ProductGrid = ({ children }: { children: React.ReactNode }) => {
  const gridRef = useStagger({ each: 0.02, y: 6 });
  return <div ref={gridRef} className="pos-grid">{children}</div>;
};

/**
 * Instant controls (qty ±): act on pointerdown like a physical key (TOUCH-SPEC §4),
 * and swallow the click that follows so it does not fire twice. Keyboard and
 * assistive-tech clicks (detail 0) still act.
 */
function usePressAction(fn: () => void) {
  const handled = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault(); // keep focus where it is
      handled.current = true;
      fn();
    },
    onClick: (e: React.MouseEvent) => {
      const swallow = handled.current && e.detail > 0;
      handled.current = false;
      if (!swallow) fn();
    },
  };
}

const CategoryTab = ({ label, active, onClick, highlight }: { label: string; active: boolean; onClick: () => void; highlight?: boolean }) => (
  // `click`, not pointerdown: the chip row scrolls sideways on phones, and a swipe
  // that starts on a chip must not switch the category.
  <button type="button" onClick={onClick} className="chip tap pos-chip" aria-pressed={active} style={{
    background: active ? 'var(--color-primary)' : (highlight ? 'var(--color-accent-50)' : 'var(--color-surface)'),
    color: active ? 'var(--color-text-inverse)' : (highlight ? 'var(--color-primary-700)' : 'var(--color-text-secondary)'),
    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
  }}>{label}</button>
);

const MenuCard = ({ item, inCart, pending, onTap }: { item: MenuItem; inCart: number; pending: boolean; onTap: () => void }) => {
  const { t } = useI18n();
  // A finger that starts a scroll on a card and moves >10px must not add it.
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
  <button type="button" className={`menu-card pos-card${pending ? ' pending' : ''}`}
    aria-busy={pending || undefined}
    onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
    onClick={(e) => {
      const d = down.current;
      down.current = null;
      if (d && e.detail > 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
      onTap();
    }}
  >
    <div className="pos-card-media" style={{ background: item.imageUrl ? 'var(--color-surface-2)' : item.color }}>
      {item.imageUrl ? (
        // next/image optimizes the R2 original (resize to card size, AVIF/WebP) and
        // lazy-loads by default, so off-screen menu cards don't all fetch on open.
        <Image
          src={item.imageUrl}
          alt={item.name}
          fill
          sizes="(max-width: 768px) 50vw, 200px"
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <div className="pos-card-ph" aria-hidden>{item.nameEn}</div>
      )}
      {item.hot && (
        <div className="pos-card-hot">
          <Icon name="star" size={13} /> {t.pos.bestseller}
        </div>
      )}
      {inCart > 0 ? (
        <>
          <span className="num pos-card-qty" aria-hidden>{inCart}</span>
          <span className="sr-only">{t.touchPos.inCart(inCart)}</span>
        </>
      ) : (
        <div className="pos-card-tag" aria-hidden>{item.tag}</div>
      )}
    </div>
    <div className="pos-card-body">
      <div className="pos-card-name">{item.name}</div>
      <div className="num pos-card-price">
        {pending ? <span className="spinner" aria-hidden /> : `฿${item.price}`}
      </div>
    </div>
  </button>
  );
};

const CartLine = ({ line, lineId, flashN, onInc, onDec, onRemove }: {
  line: CartLine; lineId: string;
  /** Non-zero while this line is the last one touched; a new value replays the flash. */
  flashN: number;
  onInc: () => void; onDec: () => void; onRemove: () => void;
}) => {
  const { t } = useI18n();
  const inc = usePressAction(onInc);
  const dec = usePressAction(onDec);
  return (
  <div className="pos-line" data-line-key={lineId}>
    {flashN > 0 && <span key={flashN} className="pos-line-flash" aria-hidden />}
    <div className="pos-line-info">
      <div className="pos-line-name">{line.name}</div>
      {line.mods.length > 0 && <div className="pos-line-mods">{line.mods.join(' • ')}</div>}
    </div>
    <div className="pos-stepper" role="group" aria-label={line.name}>
      <button type="button" className="tap pos-qty-btn" aria-label={t.pos.decQty} {...dec}><Icon name="minus" size={18}/></button>
      <div className="num pos-qty">{line.qty}</div>
      <button type="button" className="tap pos-qty-btn" aria-label={t.pos.incQty} {...inc}><Icon name="plus" size={18}/></button>
    </div>
    <div className="num pos-line-amount">฿{(line.unitPrice * line.qty).toLocaleString()}</div>
    <button type="button" className="tap pos-line-remove" aria-label={t.touchPos.removeLine(line.name)} onClick={onRemove}>
      <Icon name="trash" size={20}/>
    </button>
  </div>
  );
};

const Row = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
  <div style={{display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 'var(--fs-sm)', color: muted ? 'var(--color-text-muted)' : 'var(--color-text-secondary)'}}>
    <span>{label}</span>
    <span className="num" style={{fontWeight: 500, color: muted ? 'var(--color-text-muted)' : 'var(--color-text)'}}>{value}</span>
  </div>
);

/** Promotions + void bill, under the pay methods (all tiers). */
const SecondaryActions = ({ offerCount, selectedCount, onPromos, onVoid }: {
  offerCount: number; selectedCount: number; onPromos: () => void; onVoid: () => void;
}) => {
  const { t } = useI18n();
  return (
    <div className="pos-secondary">
      <button type="button" className="btn btn-ghost" style={{ opacity: offerCount ? 1 : 0.5 }} onClick={onPromos} disabled={!offerCount}>
        <Icon name="discount" size={16}/> {t.pos.promotions}
        {offerCount > 0 && (
          <span className="num pos-badge">{selectedCount > 0 ? `${selectedCount}/${offerCount}` : offerCount}</span>
        )}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onVoid}>
        <Icon name="void" size={16}/> {t.pos.void}
      </button>
    </div>
  );
};

const PayButton = ({ icon, label, ariaLabel, onClick, disabled, primary, pending, compact }: {
  icon: string; label: string; onClick: () => void; disabled: boolean; primary?: boolean; pending?: boolean;
  /** Full name for assistive tech when `label` is shortened to fit (phones). */
  ariaLabel?: string;
  /** Phone checkout: a shorter button, so four methods share one row. */
  compact?: boolean;
}) => {
  const { t } = useI18n();
  const off = disabled || pending;
  return (
    <button type="button" onClick={onClick} disabled={off} aria-label={ariaLabel} aria-busy={pending || undefined}
      className={`tap ${compact ? 'pos-pay' : 'pos-paybtn'}${off ? ' off' : ''}${primary ? ' primary' : ''}`}>
      {pending ? <span className="spinner" style={{width: 18, height: 18}} aria-hidden /> : <Icon name={icon} size={compact ? 20 : 22}/>}
      <span>{pending ? t.common.saving : label}</span>
    </button>
  );
};

/**
 * POS layout + touch sizing (TOUCH-SPEC §3.2–3.4). All tiers live here; the phone
 * block at the end overrides with `!important` only where an inline style must lose.
 */
const POS_CSS = `
/* ── Columns: cart is clamp(340, 40%, 440); the menu takes the rest ── */
.pos-menu { flex: 1 1 0; min-width: 0; }
.pos-cart { width: 100%; flex-shrink: 0; container: poscart / inline-size; }
@media (min-width: 768px) { .pos-cart { width: clamp(340px, 40%, 440px); } }

/* ── Menu grid: columns follow the menu column's own width ── */
.pos-menu-scroll { padding: 16px; container: posmenu / inline-size; }
.pos-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@container posmenu (min-width: 420px) { .pos-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container posmenu (min-width: 500px) { .pos-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; } }
@container posmenu (min-width: 760px) { .pos-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
@container posmenu (min-width: 980px) { .pos-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

/* ── Category chips: 48px, 56px on the POS tier ── */
.pos-chip {
  min-height: var(--tap-std); padding: 0 18px; flex-shrink: 0; /* .tab-strip > .pos-chip below beats the coarse-pointer 48px rule */
  border-radius: var(--radius-pill); white-space: nowrap;
  font-size: var(--fs-body); font-weight: 600;
}
.pos-chip-skel { height: var(--tap-std); }
@media (min-width: 1280px) { .tab-strip > .pos-chip { min-height: var(--tap-lg); } .pos-chip-skel { height: var(--tap-lg); } }

/* ── Menu card: the whole card is the target ── */
.pos-card {
  position: relative; display: flex; flex-direction: column;
  border-radius: 12px; overflow: hidden; text-align: left;
  container: poscard / inline-size;
}
.pos-card.pending { opacity: 0.7; }
.pos-card-media { aspect-ratio: 4 / 3; position: relative; display: grid; place-items: center; overflow: hidden; }
.pos-card-ph {
  padding: 0 10px; text-align: center;
  color: rgba(255, 255, 255, 0.92); font-size: var(--fs-sm); font-weight: 600; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pos-card-hot {
  position: absolute; top: 8px; left: 8px;
  display: flex; align-items: center; gap: 4px; min-height: 24px; padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--color-accent); color: var(--color-on-accent);
  font-size: var(--fs-cap); font-weight: 700; line-height: 1;
}
.pos-card-tag {
  position: absolute; top: 8px; right: 8px; padding: 2px 6px; border-radius: 4px;
  background: rgba(0, 0, 0, 0.4); color: #fff; font-size: var(--fs-cap); font-weight: 600; line-height: 1.3;
}
@container poscard (max-width: 139px) { .pos-card-tag { display: none; } }
/* How many of this product are on the bill: state, not a flash. */
.pos-card-qty {
  position: absolute; top: 8px; right: 8px;
  min-width: 24px; height: 24px; padding: 0 7px;
  display: grid; place-items: center;
  border-radius: var(--radius-pill);
  background: var(--color-accent); color: var(--color-on-accent);
  box-shadow: var(--shadow-sm);
  font-size: var(--fs-cap); font-weight: 700; line-height: 1;
}
.pos-card-body { padding: 12px; display: flex; flex-direction: column; gap: 4px; }
.pos-card-name {
  font-size: var(--fs-body); font-weight: 600; color: var(--color-text); line-height: 1.3;
  min-height: 2.6em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pos-card-price {
  min-height: 1.4em; display: flex; align-items: center;
  font-size: var(--fs-lg); font-weight: 700; color: var(--color-primary);
}

/* ── Cart lines: no rules between them, space does the grouping ── */
/* One row per line: name + modifiers | − qty + | amount | trash. The amount sits
   between the stepper and the trash, so the destructive button never touches +. */
.pos-lines { display: flex; flex-direction: column; padding: 4px 0; }
.pos-line {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  min-height: 64px; padding: 8px 8px 8px 16px;
}
.pos-line > :not(.pos-line-flash) { position: relative; }
/* The touched line: accent tint that fades out (opacity only). */
.pos-line-flash {
  position: absolute; inset: 0; pointer-events: none;
  background: var(--color-accent-50);
  animation: pos-flash 600ms var(--ease-out) forwards;
}
@keyframes pos-flash { from { opacity: 1; } to { opacity: 0; } }
.pos-line-info { flex: 1; min-width: 0; }
.pos-line-name { font-size: var(--fs-body); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.pos-line-mods { margin-top: 2px; font-size: var(--fs-sm); color: var(--color-text-secondary); line-height: 1.35; overflow-wrap: anywhere; }
.pos-line-amount { min-width: 48px; font-size: var(--fs-lg); font-weight: 600; text-align: right; white-space: nowrap; }
/* Stepper: one surface-2 group (− qty +), not three boxes. */
.pos-stepper { display: flex; align-items: center; border-radius: var(--radius-md); background: var(--color-surface-2); }
.pos-qty-btn, .pos-line-remove {
  width: var(--tap-std); height: var(--tap-std); min-height: var(--tap-std); flex-shrink: 0;
  display: grid; place-items: center; border-radius: var(--radius-md);
}
.pos-qty-btn { color: var(--color-text); }
.pos-qty { min-width: 32px; text-align: center; font-size: var(--fs-lg); font-weight: 700; }
.pos-line-remove { color: var(--color-danger-fg); }

/* ── Checkout ── */
.pos-pay-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@container poscart (min-width: 400px) { .pos-pay-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.pos-paybtn {
  min-height: var(--tap-xl); padding: 10px 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  border-radius: var(--radius-md);
  background: var(--color-primary); color: var(--color-text-inverse);
  border: 1px solid var(--color-primary);
  font-size: var(--fs-body); font-weight: 600; line-height: 1.25; text-align: center; text-wrap: balance;
}
.pos-paybtn.primary { font-weight: 700; }
.pos-paybtn.off { background: var(--color-surface-2); color: var(--color-text-muted); border-color: var(--color-border); cursor: not-allowed; }
.pos-secondary { display: flex; gap: 8px; }
.pos-secondary > .btn { flex: 1; min-width: 0; min-height: var(--tap-std); padding: 0 8px; font-size: var(--fs-sm); }
.pos-member-text > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pos-badge {
  min-width: 22px; padding: 1px 7px; border-radius: var(--radius-pill);
  background: var(--color-accent); color: var(--color-on-accent);
  font-size: var(--fs-cap); font-weight: 700; line-height: 18px;
}

@media (max-width: 767px) {
  .pos-banner { padding: 6px 12px !important; gap: 8px !important; flex-wrap: nowrap !important; }
  .pos-banner-text { min-width: 0 !important; }
  .pos-banner-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .pos-menu-head { padding: 10px 12px 0 !important; gap: 10px !important; }
  .pos-menu-scroll { padding: 12px; }

  /* Cart bar under the menu */
  .pos-cartbar-wrap {
    flex-shrink: 0; padding: 8px 12px;
    background: var(--color-surface); border-top: 1px solid var(--color-border);
  }
  .pos-cartbar {
    display: flex; align-items: center; gap: 8px;
    width: 100%; min-height: 52px; padding: 0 12px 0 14px;
    border-radius: var(--radius-lg);
    background: var(--color-primary); color: var(--color-text-inverse);
    font-size: 15px; font-weight: 700; text-align: left;
  }
  .pos-cartbar-count {
    padding: 2px 8px; border-radius: var(--radius-pill);
    background: var(--color-accent); color: var(--color-on-accent);
    font-size: var(--fs-cap); font-weight: 700; white-space: nowrap;
    animation: pos-bump 180ms var(--ease-out);
  }
  .pos-cartbar-total { margin-left: auto; font-size: 18px; letter-spacing: -0.01em; white-space: nowrap; }

  /* Cart header: one compact row */
  .pos-cart-head { padding: 8px 12px !important; gap: 8px; }
  .pos-bill { flex-shrink: 0; }
  .pos-bill-label { line-height: 1.3; }
  .pos-bill-no { font-size: 18px !important; line-height: 1.2; }
  .pos-cart-actions { flex: 1; min-width: 0; justify-content: flex-end; }
  .pos-head-btn { padding: 0 10px !important; }
  .pos-member-chip { flex: 0 1 auto; min-width: 0; }
  .pos-member-text { min-width: 0; }

  .pos-empty { padding: 40px 20px !important; text-align: center; }

  .pos-line { padding: 8px 4px 8px 12px; gap: 6px; }

  /* Checkout */
  .pos-co { flex-shrink: 0; border-top: 1px solid var(--color-border); background: var(--color-surface); }
  .pos-co-rows { padding: 8px 14px 4px; background: var(--color-surface-2); border-bottom: 1px solid var(--color-border); }
  .pos-co-total {
    display: flex; align-items: center; gap: 8px;
    width: 100%; min-height: 56px; padding: 6px 12px 6px 14px;
    background: var(--color-surface-2); text-align: left;
  }
  .pos-co-total-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pos-co-total-label { font-size: 14px; font-weight: 600; }
  .pos-co-total-sub { font-size: var(--fs-cap); color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pos-co-amount { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-primary); white-space: nowrap; }
  .pos-co-actions { display: grid; gap: 8px; padding: 10px 12px; }
  .pos-co-pay { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .pos-pay {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    min-width: 0; min-height: 56px; padding: 6px 2px;
    border-radius: var(--radius-md);
    background: var(--color-primary); color: var(--color-text-inverse);
    border: 1px solid var(--color-primary);
    font-size: var(--fs-cap); font-weight: 600; line-height: 1.3;
  }
  .pos-pay.primary { font-weight: 700; }
  .pos-pay.off { background: var(--color-surface-2); color: var(--color-text-muted); border-color: var(--color-border); }
  .pos-pay > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
@keyframes pos-bump { from { transform: scale(0.9); opacity: 0.6; } to { transform: none; opacity: 1; } }
`;
const PosStyles = () => <style>{POS_CSS}</style>;
