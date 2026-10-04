'use client';

import './pos.css';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../../icons';
import { baht } from '../../app-common';
import { Banner, Button, Modal, SegmentedControl, Snackbar, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { ApiError } from '@/lib/api-client';
import { useAllProducts, useCategories, type MenuItem } from '@/hooks/use-products';
import { useBestSellerNames } from '@/hooks/use-best-sellers';
import { useCreateOrder, usePayOrder, useSetOrderDate, displayOrderNo, type CreateOrderPayload } from '@/hooks/use-orders';
import { TABLE_TIME_PRODUCT_NAME } from '@/hooks/use-features';
import { useEvaluatePromotions, type EligiblePromotion } from '@/hooks/use-promotions';
import { useMembershipProgram } from '@/hooks/use-membership';
import { useCustomerDetail } from '@/hooks/use-customers';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { usePrinter } from '@/hooks/use-printer';
import { useIsPhone, useMediaQuery } from '@/hooks/use-media-query';
import { useHotkeys, DIGIT_CODES, type HotkeyBinding } from '@/hooks/use-hotkeys';
import { useOnlineStatus } from '../../pwa/offline-indicator';
import {
  useCartStore, useBill, useParkedBills, useLastOrderNo, rehydrateCart,
  type Bill, type CartLine, type NewCartLine,
} from '@/stores/cart-store';
import PaymentModal, { PaymentNotice, type PaymentDetails } from '../payment-modal';
import type { ReceiptData } from '../receipt-modal';
import { SearchBar } from './SearchBar';
import { CategoryBar, CAT_ALL, CAT_HOT, categoryOrder } from './CategoryBar';
import { ProductGrid } from './ProductGrid';
import { Cart } from './Cart';
import type { Totals } from './TotalBlock';
import { ModifierSheet, type ModifierTarget } from './ModifierSheet';
import { HotkeyCheatSheet } from './HotkeyCheatSheet';
import { ParkedBillsSheet } from './ParkedBillsSheet';
import { useDensity } from './use-density';
import { loadProductMods, peekProductMods, prefetchProductMods } from './use-product-mods';
import {
  MANUAL_DISCOUNT_ENABLED, PAY_METHOD_API, estimateMemberDiscount, isSellable,
  manualDiscountAmount, needsManagerPin, type Density, type PayMethod, type POSTableSession,
} from './model';

export type { POSTableSession } from './model';

// Rare-path overlays are split out of the initial POS chunk. They are prefetched on
// idle right after first paint (see the effect in POSTerminal), so opening one is
// still instant; payment stays static because it is the hot path.
const ReceiptModal = dynamic(() => import('../receipt-modal'), { ssr: false });
const MembershipModal = dynamic(() => import('../membership-modal'), { ssr: false });
const DiscountSheet = dynamic(() => import('./DiscountSheet').then((m) => m.DiscountSheet), { ssr: false });
const prefetchOverlays = () => {
  void import('../receipt-modal');
  void import('../membership-modal');
  void import('./DiscountSheet');
};

interface POSTerminalProps {
  /**
   * Board-game table tab. While set, checkout creates the order with `session_id`
   * and takes NO payment — the table's food, drinks and time charge are settled
   * together from the floor plan when the session closes.
   */
  session?: POSTableSession | null;
  onClearSession?: () => void;
}

type CreatedOrder = Awaited<ReturnType<ReturnType<typeof useCreateOrder>["mutateAsync"]>>;

/** One payment attempt: the idempotency key and, once created, the server order. */
interface Attempt {
  idem: string;
  order: CreatedOrder | null;
}

/** Success tick in the payment sheet before the receipt replaces it (spec §8). */
const TICK_MS = 240;

/** Imperative store access for handlers (always the latest state, no re-render). */
const cart = () => useCartStore.getState();

const uuid = () => {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};

function lineNoteSummary(lines: CartLine[]): string | undefined {
  const notes = lines.filter((l) => l.note).map((l) => `${l.name}: ${l.note}`);
  return notes.length ? notes.join(' · ') : undefined;
}

export default function POSTerminal({ session = null, onClearSession }: POSTerminalProps = {}) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const isPhone = useIsPhone();
  const wide = useMediaQuery('(min-width: 1024px)');
  const finePointer = useMediaQuery('(any-pointer: fine)');
  const online = useOnlineStatus();
  const [density, setDensity] = useDensity();

  // ── Device cart (persisted) ───────────────────────────────────────────────
  const { data: me } = useCurrentUser();
  const storeId = me?.store_id ?? null;
  useEffect(() => {
    rehydrateCart();
    if (storeId) useCartStore.getState().setScope(storeId);
  }, [storeId]);
  const bill = useBill();
  const parked = useParkedBills();
  const lastOrderNo = useLastOrderNo();


  // ── Catalog ───────────────────────────────────────────────────────────────
  const { data: categories, isLoading: catsLoading } = useCategories();
  const { data: rawProducts, isLoading: prodLoading, isError: prodError, refetch: refetchProducts } = useAllProducts();
  const { data: bestSellers } = useBestSellerNames();
  const products = useMemo(
    () => (rawProducts ?? [])
      .filter((m) => isSellable(m, TABLE_TIME_PRODUCT_NAME))
      .map((m) => ({ ...m, hot: bestSellers?.has(m.name) ?? false })),
    [rawProducts, bestSellers],
  );
  const hasHot = products.some((p) => p.hot);

  const [category, setCategory] = useState<string>(CAT_ALL);
  const activeCategory = category === CAT_HOT && !hasHot ? CAT_ALL : category;
  const [animateGrid, setAnimateGrid] = useState(true);
  const [search, setSearch] = useState('');
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  // The input stays on the urgent `search`; the grid follows `deferredSearch` so a
  // keystroke / clear never waits on re-rendering every tile (interruptible).
  const deferredSearch = useDeferredValue(search);
  const searching = deferredSearch.trim() !== '';
  const matchSearch = (q: string) => {
    const s = q.trim().toLowerCase();
    return products.filter((m) => m.name.toLowerCase().includes(s) || m.nameEn.toLowerCase().includes(s));
  };

  const visible = useMemo(() => {
    if (searching) {
      const s = deferredSearch.trim().toLowerCase();
      return products.filter((m) => m.name.toLowerCase().includes(s) || m.nameEn.toLowerCase().includes(s));
    }
    if (activeCategory === CAT_HOT) return products.filter((m) => m.hot);
    if (activeCategory === CAT_ALL) return products;
    return products.filter((m) => m.cat === activeCategory);
  }, [products, activeCategory, deferredSearch, searching]);
  const highlightedId = searching ? (visible[Math.min(hi, visible.length - 1)]?.id ?? null) : null;

  // Warm the modifier cache for what is on screen so taps add instantly.
  const visibleIds = useMemo(() => visible.slice(0, 24).map((m) => m.id).join(','), [visible]);
  useEffect(() => {
    if (!visibleIds) return;
    const signal = { cancelled: false };
    const id = window.setTimeout(() => { void prefetchProductMods(qc, visibleIds.split(','), signal); }, 250);
    return () => { signal.cancelled = true; window.clearTimeout(id); };
  }, [visibleIds, qc]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'menu' | 'cart'>('menu');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [modTarget, setModTarget] = useState<ModifierTarget | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [membership, setMembership] = useState<null | 'lookup' | 'register'>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [payment, setPayment] = useState<PayMethod | null>(null);
  const [receipt, setReceipt] = useState<{ data: ReceiptData; issuedAt: Date; orderId: string } | null>(null);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ line: CartLine; index: number; at: number } | null>(null);
  const [tabSaving, setTabSaving] = useState(false);
  const attempt = useRef<Attempt | null>(null);

  const createOrder = useCreateOrder();
  const payOrder = usePayOrder();
  const setOrderDate = useSetOrderDate();
  const evaluate = useEvaluatePromotions();
  const { printReceipt } = usePrinter();
  const { data: program } = useMembershipProgram();

  const focusSearch = useCallback((select = true) => {
    const el = searchRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (select) el.select();
  }, []);

  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(prefetchOverlays, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(h);
    }
    const h = window.setTimeout(prefetchOverlays, 2000);
    return () => window.clearTimeout(h);
  }, []);

  // Desktop: land in the search box, ready to type.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px) and (any-pointer: fine)').matches) searchRef.current?.focus({ preventScroll: true });
  }, []);

  // ── Promotions (re-evaluated whenever the cart changes, debounced) ─────────
  const [eligiblePromos, setEligiblePromos] = useState<EligiblePromotion[]>([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [evalNonce, setEvalNonce] = useState(0);
  const cartForEval = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of bill.lines) map.set(l.menuId, (map.get(l.menuId) ?? 0) + l.qty);
    return Array.from(map, ([product_id, quantity]) => ({ product_id, quantity }));
  }, [bill.lines]);
  const evalKey = JSON.stringify(cartForEval);

  useEffect(() => {
    let cancelled = false;
    const items = JSON.parse(evalKey) as { product_id: string; quantity: number }[];
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (items.length === 0) {
        setEligiblePromos([]);
        setPromosLoading(false);
        if (cart().byScope[cart().scope]?.bill.promoIds.length) cart().setPromoIds([]);
        return;
      }
      setPromosLoading(true);
      evaluate.mutateAsync(items)
        .then((res) => {
          if (cancelled) return;
          setEligiblePromos(res.eligible);
          cart().setPromoIds((prev) => prev.filter((id) => res.eligible.some((e) => e.promotion_id === id)));
        })
        .catch(() => { if (!cancelled) setEligiblePromos([]); })
        .finally(() => { if (!cancelled) setPromosLoading(false); });
    }, items.length === 0 ? 0 : 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evaluate/cart are stable; evalKey + nonce drive re-runs
  }, [evalKey, evalNonce]);

  const selectedPromoIds = bill.promoIds;
  const exclusiveSelected = eligiblePromos.find((e) => selectedPromoIds.includes(e.promotion_id) && e.is_exclusive) ?? null;
  const togglePromo = (e: EligiblePromotion) => cart().setPromoIds((prev) => {
    if (prev.includes(e.promotion_id)) return prev.filter((id) => id !== e.promotion_id);
    if (e.is_exclusive) return [e.promotion_id];
    if (exclusiveSelected) return prev;
    return [...prev, e.promotion_id];
  });

  // ── Member + reward ───────────────────────────────────────────────────────
  const member = bill.member;
  const { data: memberCustomer } = useCustomerDetail(member?.account.customer_id);
  const memberSalesName = memberCustomer?.sales_name ?? undefined;
  const rewardType = member?.program?.reward_type ?? null;
  const isFreeItemReward = rewardType === 'FREE_ITEM';

  const cartProducts = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; price: number }>();
    for (const l of bill.lines) if (!seen.has(l.menuId)) seen.set(l.menuId, { id: l.menuId, name: l.name, price: l.basePrice });
    return Array.from(seen.values());
  }, [bill.lines]);
  const redeemable = useMemo(() => {
    if (!member) return [] as { id: string; name: string; price: number }[];
    const ids = member.eligibleRewardProducts.map((p) => p.id);
    return ids.length ? cartProducts.filter((p) => ids.includes(p.id)) : cartProducts;
  }, [member, cartProducts]);
  const redeemAvailable = !!member?.rewardRedeemable && bill.lines.length > 0 && (!isFreeItemReward || redeemable.length > 0);

  // Keep the chosen free item valid as the cart changes.
  const redeemableKey = redeemable.map((p) => p.id).join(',');
  useEffect(() => {
    const m = cart().byScope[cart().scope]?.bill.member;
    if (!m?.redeemReward || m.program?.reward_type !== 'FREE_ITEM') return;
    if (m.rewardProduct && redeemable.some((p) => p.id === m.rewardProduct?.id)) return;
    const best = [...redeemable].sort((a, b) => b.price - a.price)[0];
    cart().setMember((cur) => cur ? {
      ...cur,
      rewardProduct: best ? { id: best.id, name: best.name, price: String(best.price) } : null,
      redeemReward: best ? cur.redeemReward : false,
    } : cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id list
  }, [redeemableKey]);

  const toggleRedeem = (on: boolean) => cart().setMember((m) => {
    if (!m) return m;
    if (!on) return { ...m, redeemReward: false, rewardProduct: null };
    let rp = m.rewardProduct;
    if (m.program?.reward_type === 'FREE_ITEM' && !rp) {
      const best = [...redeemable].sort((a, b) => b.price - a.price)[0];
      rp = best ? { id: best.id, name: best.name, price: String(best.price) } : null;
    }
    return { ...m, redeemReward: true, rewardProduct: rp };
  });
  const pickRewardProduct = (productId: string) => {
    const p = redeemable.find((x) => x.id === productId);
    if (p) cart().setMember((m) => m ? { ...m, rewardProduct: { id: p.id, name: p.name, price: String(p.price) } } : m);
  };

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal = bill.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const memberDiscount = estimateMemberDiscount(member, program, subtotal);
  const promoDiscount = eligiblePromos
    .filter((e) => selectedPromoIds.includes(e.promotion_id))
    .reduce((s, e) => s + Number(e.discount_amount), 0);
  const manualBase = Math.max(0, subtotal - memberDiscount - promoDiscount);
  const manualRaw = MANUAL_DISCOUNT_ENABLED ? manualDiscountAmount(bill.manualDiscount, manualBase) : 0;
  // An unapproved manual discount that grew past the limit (cart changed) stops counting.
  const manualValid = !!bill.manualDiscount && (bill.manualDiscount.approvedBy != null || !needsManagerPin(manualRaw, manualBase));
  const manualAmount = manualValid ? manualRaw : 0;
  const discount = Math.min(subtotal, memberDiscount + promoDiscount + manualAmount);
  const total = subtotal - discount;
  const count = bill.lines.reduce((s, l) => s + l.qty, 0);
  const totals: Totals = { subtotal, memberDiscount, promoDiscount, manualDiscount: manualAmount, discount, total, count };
  const discountCount = selectedPromoIds.length + (member?.redeemReward ? 1 : 0) + (manualAmount > 0 ? 1 : 0);

  const paying = createOrder.isPending || payOrder.isPending || tabSaving;

  // ── Selection (Alt+↑/↓, +/-, Delete, E) — default: the last-added line ─────
  const effectiveSelected = useMemo(() => {
    if (selectedKey && bill.lines.some((l) => l.key === selectedKey)) return selectedKey;
    let last: CartLine | null = null;
    for (const l of bill.lines) if (!last || l.touchedAt >= last.touchedAt) last = l;
    return last?.key ?? null;
  }, [selectedKey, bill.lines]);

  // ── Add to cart ───────────────────────────────────────────────────────────
  const addPlain = useCallback((item: MenuItem) => {
    const key = cart().addLine({
      menuId: item.id, name: item.name, basePrice: item.price, unitPrice: item.price,
      qty: 1, mods: [], modIds: [], modKey: '', note: '',
    });
    setSelectedKey(key);
  }, [setSelectedKey]);

  const onAdd = useCallback((item: MenuItem) => {
    const cached = peekProductMods(qc, item.id);
    if (cached) {
      if (cached.hasModifiers) setModTarget({ mode: 'add', item });
      else addPlain(item);
      return;
    }
    if (!online) {
      toast({ kind: 'warning', title: t.pos.addFailed, msg: t.pos.offlineNoOptions });
      return;
    }
    setPendingId(item.id);
    loadProductMods(qc, item.id)
      .then((mods) => {
        if (mods.hasModifiers) setModTarget({ mode: 'add', item });
        else addPlain(item);
      })
      .catch((err: unknown) => {
        toast({ kind: 'danger', title: t.pos.addFailed, msg: err instanceof Error ? err.message : t.pos.tryAgain });
      })
      .finally(() => setPendingId((cur) => (cur === item.id ? null : cur)));
  }, [qc, online, toast, t, addPlain, setModTarget, setPendingId]);

  const onCustomize = useCallback((item: MenuItem) => setModTarget({ mode: 'add', item }), [setModTarget]);

  const onModConfirm = (line: NewCartLine, target: ModifierTarget) => {
    const key = target.mode === 'add' ? cart().addLine(line) : cart().replaceLine(target.line.key, line);
    setSelectedKey(key);
    setModTarget(null);
  };

  const editLine = useCallback((key: string) => {
    const line = cart().byScope[cart().scope]?.bill.lines.find((l) => l.key === key);
    if (!line) return;
    setModTarget({ mode: 'edit', line, item: products.find((p) => p.id === line.menuId) ?? null });
  }, [products, setModTarget]);

  const removeLine = useCallback((key: string) => {
    const removed = cart().removeLine(key);
    if (removed) setUndo({ ...removed, at: Date.now() });
  }, [setUndo]);

  const setQty = useCallback((key: string, qty: number) => {
    if (qty <= 0) { removeLine(key); return; }
    cart().setQty(key, qty);
  }, [removeLine]);

  // ── Search ────────────────────────────────────────────────────────────────
  const onSearchChange = (v: string) => { setSearch(v); setHi(0); };
  const onSearchSubmit = () => {
    // Resolve against the live input, not the deferred grid, so a fast "type + Enter"
    // can never add a product from a stale result list.
    if (search.trim() === '') return;
    const live = deferredSearch === search ? visible : matchSearch(search);
    const target = live.length === 1 ? live[0] : live[Math.min(hi, live.length - 1)];
    if (!target) return;
    onAdd(target);
    setSearch('');
    setHi(0);
  };

  const chooseCategory = (id: string, viaKey = false) => {
    setAnimateGrid(!viaKey);
    setCategory(id);
    setSearch('');
  };

  // ── Bill actions ──────────────────────────────────────────────────────────
  const clearForNext = () => {
    cart().clearBill();
    setSelectedKey(null);
    setDiscountOpen(false);
    attempt.current = null;
  };

  const openPayment = (m: PayMethod) => {
    if (!bill.lines.length || paying || !online) return;
    attempt.current = null;
    setPayment(m);
  };

  const park = () => {
    if (cart().park()) {
      setSelectedKey(null);
      toast({ kind: 'info', title: t.pos.parkedDone, duration: 2500 });
    }
  };

  const orderPayload = (snap: Bill, idem: string): CreateOrderPayload => ({
    idempotency_key: idem,
    channel: 'DINE_IN',
    items: snap.lines.map((l) => ({ product_id: l.menuId, quantity: l.qty, modifier_ids: l.modIds })),
    ...(lineNoteSummary(snap.lines) ? { customer_note: lineNoteSummary(snap.lines) } : {}),
    ...(snap.member ? {
      // Attribute the sale to the member's customer so the salesperson KPI picks it up.
      customer_id: snap.member.account.customer_id,
      member_id: snap.member.account.id,
      redeem_reward: snap.member.redeemReward,
      reward_product_id: snap.member.rewardProduct?.id ?? null,
    } : {}),
    ...(snap.promoIds.length ? { promotion_ids: snap.promoIds } : {}),
  });

  /**
   * Maps a failed create to a cashier message; drops a member the server no
   * longer knows and refreshes promotions on a checkout re-validation reject.
   * `review` = nothing broke, the bill changed and the cashier must look again.
   */
  const createFailure = (err: unknown, snap: Bill): { msg: string; review: boolean } => {
    const msg = err instanceof Error ? err.message : t.pos.contactManager;
    if (err instanceof ApiError && err.status === 404 && snap.member) {
      cart().setMember(null);
      return { msg: t.pos.memberClearedMsg, review: true };
    }
    if (err instanceof ApiError && err.status === 422 && snap.promoIds.length) {
      setEvalNonce((n) => n + 1);
      return { msg: t.pos.promoRefreshedMsg(msg), review: true };
    }
    return { msg, review: false };
  };

  /**
   * Payment sheet confirm. Returns a promise: resolve → the sheet shows its tick
   * and the receipt replaces it; reject → the sheet shows the error inline with a
   * retry, and the cart is untouched. A retry after "order created, payment
   * failed" re-tries ONLY the payment on the same order (no duplicate order).
   */
  const onPaid = async (details: PaymentDetails): Promise<void> => {
    const snap = cart().byScope[cart().scope]?.bill;
    if (!snap || snap.lines.length === 0) throw new Error(t.pos.emptyCartTitle);
    const method: PayMethod = details.method;
    const snapTotals = { subtotal, total, discount, memberDiscount };
    const promoLines = eligiblePromos
      .filter((e) => snap.promoIds.includes(e.promotion_id))
      .map((e) => ({ name: e.name, amount: Number(e.discount_amount) }));
    const salesName = memberSalesName;

    const a = attempt.current ?? (attempt.current = { idem: uuid(), order: null });
    let order;
    if (a.order) {
      order = a.order;
    } else {
      try {
        order = await createOrder.mutateAsync(orderPayload(snap, a.idem));
        a.order = order;
      } catch (err) {
        const f = createFailure(err, snap);
        throw f.review ? new PaymentNotice(f.msg) : new Error(f.msg);
      }
    }

    let paid;
    try {
      paid = await payOrder.mutateAsync({
        orderId: order.id,
        payment_method: PAY_METHOD_API[method],
        ...(details.paymentRef ? { payment_ref: details.paymentRef } : {}),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : t.pos.tryAgain;
      throw new Error(t.pos.payRetryMsg(String(displayOrderNo(order)), reason));
    }

    // ── Success: build the receipt from the snapshot + server values ──
    const hasMember = !!snap.member;
    const serverAuthoritative = hasMember || snap.promoIds.length > 0;
    const finalTotal = serverAuthoritative && order.total != null ? Number(order.total) : snapTotals.total;
    const finalDiscount = serverAuthoritative && order.discount != null ? Number(order.discount) : 0;
    const earned = paid.points_earned ?? 0;
    const discountLines: { label: string; amount: number }[] = promoLines.filter((p) => p.amount > 0).map((p) => ({ label: p.name, amount: p.amount }));
    if (snap.member && snapTotals.memberDiscount > 0) {
      discountLines.push({
        label: snap.member.program?.reward_type === 'FREE_ITEM'
          ? t.pos.memberRewardLine(snap.member.rewardProduct?.name ?? t.pos.rewardFallback)
          : t.pos.memberDiscountLine,
        amount: snapTotals.memberDiscount,
      });
    }
    const didRedeem = paid.reward_redeemed ?? snap.member?.redeemReward ?? false;
    const redeemed = didRedeem ? (snap.member?.program?.points_to_redeem ?? program?.points_to_redeem ?? 0) : 0;
    const balanceBefore = snap.member?.account.points_balance ?? 0;
    const orderNo = String(displayOrderNo(order));

    const data: ReceiptData = {
      orderNumber: orderNo,
      ...(order.receipt_no ? { receiptNo: order.receipt_no } : {}),
      items: snap.lines.map((l) => {
        const mods = [...l.mods, ...(l.note ? [`${t.pos.notePrefix} ${l.note}`] : [])];
        return { name: l.name, qty: l.qty, unitPrice: l.unitPrice, mods: mods.length ? mods : undefined };
      }),
      subtotal: snapTotals.subtotal,
      total: finalTotal,
      paymentMethod: method,
      paymentLabel: (t.pos.payReceipt as Record<string, string>)[method] ?? method,
      ...(details.cashGiven ? { cashGiven: details.cashGiven } : {}),
      discount: finalDiscount > 0 ? finalDiscount : undefined,
      discountLines: finalDiscount > 0 && discountLines.length > 0 ? discountLines : undefined,
      memberName: snap.member?.account.customer_name,
      salesName: snap.member ? salesName : undefined,
      pointsEarned: hasMember ? earned : undefined,
      pointsRedeemed: redeemed > 0 ? redeemed : undefined,
      rewardLabel: didRedeem ? (snap.member?.rewardProduct?.name ?? undefined) : undefined,
      pointsBalanceAfter: hasMember ? balanceBefore + earned - redeemed : undefined,
      rewardRedeemed: didRedeem,
    };

    clearForNext();
    cart().setLastOrderNo(orderNo);
    setReceipt({ data, issuedAt: new Date(order.created_at), orderId: order.id });
    window.setTimeout(() => setPayment(null), TICK_MS);
  };

  const closePayment = () => {
    // An order was created but never paid: it is already in the kitchen, so the
    // cart must not be charged again as a new order. Clear it and say how to settle.
    const a = attempt.current;
    setPayment(null);
    if (a?.order) {
      const no = String(displayOrderNo(a.order));
      clearForNext();
      toast({ kind: 'warning', title: t.pos.paidFailedTitle, msg: t.pos.paidFailedMsg(no, t.pos.paymentCancelled), duration: 8000 });
    }
    attempt.current = null;
  };

  /** Table mode: put the order on the table's tab (no payment now). */
  const addToTab = async () => {
    if (!session || paying || !bill.lines.length) return;
    const snap = cart().byScope[cart().scope]?.bill;
    if (!snap) return;
    setTabSaving(true);
    try {
      await createOrder.mutateAsync({ ...orderPayload(snap, uuid()), session_id: session.sessionId });
      clearForNext();
      toast({ kind: 'success', title: t.pos.tableAdded(session.tableName), msg: t.pos.tableAddedMsg, duration: 3000 });
    } catch (err) {
      // The order was NOT created and the cart was never cleared — nothing to restore.
      toast({ kind: 'warning', title: t.pos.orderSaveFailed, msg: createFailure(err, snap).msg, duration: 5000 });
    } finally {
      setTabSaving(false);
    }
  };

  const charge = () => (session ? void addToTab() : openPayment('cash'));

  const nextOrder = () => {
    setReceipt(null);
    setActiveTab('menu');
    window.setTimeout(() => focusSearch(false), 0);
  };

  // ── Hotkeys (spec §4.1, scope "pos") ──────────────────────────────────────
  const order = categoryOrder(categories, hasHot);
  const moveSelection = (delta: 1 | -1) => {
    const lines = bill.lines;
    if (!lines.length) return;
    const at = lines.findIndex((l) => l.key === effectiveSelected);
    const next = lines[Math.min(lines.length - 1, Math.max(0, (at < 0 ? lines.length : at) + delta))];
    setSelectedKey(next.key);
  };
  const selectedLine = bill.lines.find((l) => l.key === effectiveSelected) ?? null;
  const hasLines = bill.lines.length > 0;

  const bindings: HotkeyBinding[] = [
    { code: 'Slash', shift: true, handler: () => setCheatOpen(true) },
    { code: ['Slash', 'F2'], handler: () => focusSearch() },
    ...DIGIT_CODES.map((codes, i): HotkeyBinding => ({
      code: codes,
      handler: () => { const item = visible[i]; if (item) onAdd(item); },
    })),
    { code: 'BracketLeft', handler: () => {
      const at = order.indexOf(activeCategory);
      chooseCategory(order[(at - 1 + order.length) % order.length], true);
    } },
    { code: 'BracketRight', handler: () => {
      const at = order.indexOf(activeCategory);
      chooseCategory(order[(at + 1) % order.length], true);
    } },
    { code: 'ArrowUp', alt: true, handler: () => moveSelection(-1) },
    { code: 'ArrowDown', alt: true, handler: () => moveSelection(1) },
    { code: ['Equal', 'NumpadAdd'], shift: 'any', repeat: true, enabled: !!selectedLine && !paying,
      handler: () => { if (selectedLine) setQty(selectedLine.key, selectedLine.qty + 1); } },
    { code: ['Minus', 'NumpadSubtract'], repeat: true, enabled: !!selectedLine && !paying,
      handler: () => { if (selectedLine) setQty(selectedLine.key, selectedLine.qty - 1); } },
    { code: 'Delete', enabled: !!selectedLine && !paying, handler: () => { if (selectedLine) removeLine(selectedLine.key); } },
    { code: 'KeyE', enabled: !!selectedLine && !paying, handler: () => { if (selectedLine) editLine(selectedLine.key); } },
    { code: 'F4', enabled: hasLines, handler: () => setDiscountOpen(true) },
    { code: 'F8', handler: () => { if (!member) setMembership('lookup'); } },
    { code: 'F9', handler: () => { if (hasLines) park(); else if (parked.length) setParkedOpen(true); } },
    { code: 'F12', enabled: hasLines, handler: charge },
    { code: ['Enter', 'NumpadEnter'], ctrl: true, enabled: hasLines, handler: charge },
    { code: 'Backspace', ctrl: true, blockInInput: true, enabled: hasLines && !paying, handler: () => setConfirmVoid(true) },
  ];
  useHotkeys(bindings, { scope: 'pos' });

  const showKbdHint = wide && finePointer;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="pos" data-density={density}>
      <h1 className="sr-only">{t.nav.pos}</h1>
      {session && (
        <Banner
          tone="accent"
          size="lg"
          title={t.pos.tableBanner(session.tableName)}
          detail={<span className="hide-phone">{t.pos.tableBannerHint}</span>}
          action={onClearSession ? <Button variant="secondary" size="md" onClick={onClearSession}>{t.pos.tableExit}</Button> : undefined}
          className="pos__banner"
        />
      )}

      {/* Phones: menu / cart tabs */}
      <div role="tablist" aria-label={t.pos.sectionsAria} className="pos__tabs">
        <button type="button" role="tab" aria-selected={activeTab === 'menu'} className="pos__tab"
          onClick={() => setActiveTab('menu')}>{t.pos.tabMenu}</button>
        <button type="button" role="tab" aria-selected={activeTab === 'cart'} className="pos__tab"
          onClick={() => setActiveTab('cart')}>
          {t.pos.tabCart}
          {count > 0 && <span className="pos__tab-count num" aria-label={t.pos.itemsAria(count)}>{count}</span>}
        </button>
      </div>

      <div className="pos__body">
        <section className="pos__menu" data-active={activeTab === 'menu' ? '' : undefined} aria-label={t.pos.menuTitle}>
          <div className="pos__menu-head">
            <div className="pos__menu-row">
              <SearchBar
                value={search}
                onChange={onSearchChange}
                onSubmit={onSearchSubmit}
                onMove={(d) => setHi((h) => Math.max(0, Math.min(visible.length - 1, h + d)))}
                resultCount={searching ? visible.length : null}
                inputRef={searchRef}
              />
              <SegmentedControl<Density>
                ariaLabel={t.pos.densityAria}
                value={density}
                onChange={setDensity}
                className="pos__density"
                options={[
                  { value: 'compact', label: <span className="pos__seg-label"><Icon name="list" size={16} /><span>{t.pos.densityCompact}</span></span> },
                  { value: 'photo', label: <span className="pos__seg-label"><Icon name="layers" size={16} /><span>{t.pos.densityPhoto}</span></span> },
                ]}
              />
              {showKbdHint && (
                <Button variant="ghost" size="md" kbd="?" onClick={() => setCheatOpen(true)} className="pos__cheat-btn">
                  {t.pos.hotkeys.button}
                </Button>
              )}
            </div>
            <CategoryBar
              categories={categories}
              loading={catsLoading}
              value={searching ? '' : activeCategory}
              onChange={(id) => chooseCategory(id)}
              showHot={hasHot}
            />
          </div>

          <div className="pos__grid-scroll scroll">
            <ProductGrid
              items={visible}
              density={density}
              loading={prodLoading}
              error={prodError && !rawProducts}
              onRetry={() => { void refetchProducts(); }}
              searching={searching}
              onClearSearch={() => { setSearch(''); focusSearch(false); }}
              showHotkeys={showKbdHint}
              highlightedId={highlightedId}
              pendingId={pendingId}
              onAdd={onAdd}
              onCustomize={onCustomize}
              animate={animateGrid && !searching}
              animateKey={activeCategory}
            />
          </div>

          {isPhone && count > 0 && (
            <div className="pos__cartbar-wrap">
              <button type="button" className="pos__cartbar" onClick={() => setActiveTab('cart')}>
                <Icon name="cart" size={20} />
                <span>{t.pos.tabCart}</span>
                <span key={count} className="pos__cartbar-count num">{t.pos.itemsAria(count)}</span>
                <span className="pos__cartbar-total num">{baht(total)}</span>
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
          )}
        </section>

        <div className="pos__cart" data-active={activeTab === 'cart' ? '' : undefined}>
          <Cart
            bill={bill}
            totals={totals}
            compact={isPhone}
            lastOrderNo={lastOrderNo}
            tableName={session?.tableName ?? null}
            selectedKey={effectiveSelected}
            parkedCount={parked.length}
            paying={paying}
            offline={!online}
            discountCount={discountCount}
            memberSalesName={memberSalesName}
            showKbdHint={showKbdHint}
            onSelect={setSelectedKey}
            onEdit={editLine}
            onQty={setQty}
            onRemove={removeLine}
            onCustomer={() => setMembership('lookup')}
            onRegister={() => setMembership('register')}
            onRemoveMember={() => cart().setMember(null)}
            onPark={park}
            onParkedList={() => setParkedOpen(true)}
            onDiscount={() => setDiscountOpen(true)}
            onVoid={() => setConfirmVoid(true)}
            onPay={openPayment}
            onAddToTab={() => { void addToTab(); }}
          />
        </div>
      </div>

      {/* ── Overlays ── */}
      <ModifierSheet target={modTarget} onClose={() => setModTarget(null)} onConfirm={onModConfirm} onRemove={removeLine} />

      <DiscountSheet
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        promos={eligiblePromos}
        promosLoading={promosLoading}
        selectedPromoIds={selectedPromoIds}
        onTogglePromo={togglePromo}
        reward={{
          available: redeemAvailable,
          member,
          isFreeItem: isFreeItemReward,
          descLabel: rewardType === 'FREE_ITEM' ? t.pos.rewardFreeItem
            : rewardType === 'DISCOUNT_FIXED' ? t.pos.rewardDiscountFixed
            : rewardType === 'DISCOUNT_PERCENT' ? t.pos.rewardDiscountPercent : '',
          pointsToRedeem: member?.program?.points_to_redeem ?? 0,
          pointsBalance: member?.account.points_balance ?? 0,
          estimate: memberDiscount,
          products: redeemable,
          onToggle: toggleRedeem,
          onPickProduct: pickRewardProduct,
        }}
        manualBase={manualBase}
        manual={bill.manualDiscount}
        onManual={(d) => cart().setManualDiscount(d)}
        selfApprover={me && isAdmin(me.role) ? { id: me.id, name: me.name } : null}
        totalDiscount={discount}
      />

      <ParkedBillsSheet
        open={parkedOpen}
        onClose={() => setParkedOpen(false)}
        parked={parked}
        currentHasItems={hasLines}
        onResume={(id) => { cart().resume(id); setSelectedKey(null); setParkedOpen(false); }}
        onDrop={(id) => cart().dropParked(id)}
      />

      <HotkeyCheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />

      <Modal
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        variant="alert"
        size="sm"
        title={t.pos.voidConfirmTitle}
        description={t.pos.voidConfirmBody(count, baht(total))}
        footer={<>
          <Button variant="secondary" size="lg" onClick={() => setConfirmVoid(false)}>{t.pos.voidKeep}</Button>
          <Button variant="danger" size="lg" icon={<Icon name="void" size={18} />}
            onClick={() => { clearForNext(); setConfirmVoid(false); setUndo(null); }}>
            {t.pos.voidConfirm}
          </Button>
        </>}
      />

      {membership && (
        <MembershipModal
          initialPhase={membership}
          onClose={() => setMembership(null)}
          onSelectMember={(info) => { cart().setMember(info); setMembership(null); }}
        />
      )}

      {payment && (
        <PaymentModal
          method={payment}
          total={total}
          onClose={closePayment}
          onPaid={onPaid}
          onMethodChange={(m) => setPayment(m)}
        />
      )}

      {receipt && !payment && (
        <ReceiptModal
          data={receipt.data}
          issuedAt={receipt.issuedAt}
          onClose={nextOrder}
          onSaveDate={async (iso: string) => {
            try {
              const updated = await setOrderDate.mutateAsync({ orderId: receipt.orderId, businessDate: iso });
              const no = String(displayOrderNo(updated));
              // Backdating re-sequences the order for the target day: refresh both numbers.
              setReceipt((prev) => prev ? {
                ...prev,
                issuedAt: new Date(updated.created_at),
                data: { ...prev.data, orderNumber: no, receiptNo: updated.receipt_no },
              } : prev);
              cart().setLastOrderNo(no);
              toast({ kind: 'success', title: t.pos.dateSaved, msg: t.pos.dateSavedMsg(updated.receipt_no ?? '') });
            } catch (e: unknown) {
              toast({ kind: 'danger', title: t.pos.dateSaveFailed, msg: e instanceof Error ? e.message : String(e) });
              throw e;
            }
          }}
          onPrint={async () => {
            const d = receipt.data;
            await printReceipt({
              orderNumber: d.orderNumber,
              ...(d.receiptNo ? { receiptNo: d.receiptNo } : {}),
              items: d.items,
              subtotal: d.subtotal,
              total: d.total,
              paymentMethod: d.paymentMethod,
              cashGiven: d.cashGiven,
              memberName: d.memberName,
              salesName: d.salesName,
              discount: d.discount,
              discountLines: d.discountLines,
              pointsEarned: d.pointsEarned,
              pointsRedeemed: d.pointsRedeemed,
              rewardLabel: d.rewardLabel,
              pointsBalanceAfter: d.pointsBalanceAfter,
              issuedAt: receipt.issuedAt,
            });
          }}
        />
      )}

      <Snackbar
        open={undo != null}
        message={undo ? t.pos.lineRemoved(undo.line.name) : ''}
        actionLabel={t.pos.undo}
        onAction={() => {
          if (undo) { cart().insertLine(undo.line, undo.index); setSelectedKey(undo.line.key); }
          setUndo(null);
        }}
        onClose={() => setUndo(null)}
        resetKey={undo?.at}
      />
    </div>
  );
}
