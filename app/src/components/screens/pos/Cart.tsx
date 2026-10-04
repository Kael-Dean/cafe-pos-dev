'use client';

import { useEffect, useRef } from 'react';
import Icon from '../../icons';
import { baht } from '../../app-common';
import { Badge, Button, Chip, EmptyState, IconButton, PayAction } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { Bill } from '@/stores/cart-store';
import { CartLineRow } from './CartLine';
import { TotalBlock, type Totals } from './TotalBlock';
import type { PayMethod } from './model';

export interface CartProps {
  bill: Bill;
  totals: Totals;
  compact: boolean;
  /** Server number of the last completed sale on this device. */
  lastOrderNo: string | null;
  tableName: string | null;
  selectedKey: string | null;
  parkedCount: number;
  paying: boolean;
  offline: boolean;
  discountCount: number;
  memberSalesName?: string;
  showKbdHint: boolean;

  onSelect: (key: string) => void;
  onEdit: (key: string) => void;
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onCustomer: () => void;
  onRegister: () => void;
  onRemoveMember: () => void;
  onPark: () => void;
  onParkedList: () => void;
  onDiscount: () => void;
  onVoid: () => void;
  onPay: (m: PayMethod) => void;
  onAddToTab: () => void;
}

export function Cart(p: CartProps) {
  const { t } = useI18n();
  const { bill, totals } = p;
  const empty = bill.lines.length === 0;
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected line in view (Alt+↑/↓, newly added line).
  useEffect(() => {
    if (!p.selectedKey || !listRef.current) return;
    const idx = bill.lines.findIndex((l) => l.key === p.selectedKey);
    const el = listRef.current.querySelectorAll<HTMLElement>('.pos-line')[idx];
    el?.scrollIntoView({ block: 'nearest' });
  }, [p.selectedKey, bill.lines]);

  const offlineReason = p.offline ? t.pos.offlineNoCharge : undefined;
  const member = bill.member;

  return (
    <section className="pos-cart" aria-label={t.pos.cartAria}>
      <header className="pos-cart__head">
        <div className="pos-cart__bill">
          <h2 className="pos-cart__title">{p.tableName ? t.pos.tableBill(p.tableName) : t.pos.newBill}</h2>
          {p.lastOrderNo && <span className="pos-cart__last num">{t.pos.lastOrder(p.lastOrderNo)}</span>}
        </div>
        <div className="pos-cart__actions">
          {p.parkedCount > 0 && (
            <Button variant="secondary" size="md" onClick={p.onParkedList} icon={<Icon name="park" size={16} />}
              aria-label={t.pos.parkedListAria(p.parkedCount)}>
              {t.pos.parkedChip(p.parkedCount)}
            </Button>
          )}
          <IconButton
            variant="ghost"
            icon={<Icon name="park" size={18} />}
            label={`${t.pos.parkBill} (F9)`}
            aria-keyshortcuts="F9"
            disabled={empty}
            onClick={p.onPark}
          />
        </div>
      </header>

      <div className="pos-cart__member">
        {member ? (
          <Chip kind="removable" tone="accent" onRemove={p.onRemoveMember} removeLabel={t.pos.removeMember}
            icon={<Icon name="user" size={14} />} className="pos-cart__member-chip">
            <span className="pos-cart__member-name">{member.account.customer_name}</span>
            <span className="pos-cart__member-pts num">
              {t.pos.pointsUnit(member.account.points_balance.toLocaleString())}{member.redeemReward ? t.pos.redeemSuffix : ''}
              {p.memberSalesName ? ` · ${t.pos.salesLabel} ${p.memberSalesName}` : ''}
            </span>
          </Chip>
        ) : (
          <>
            <Button variant="ghost" size="md" icon={<Icon name="user" size={16} />} kbd="F8" onClick={p.onCustomer}>
              {t.pos.customer}
            </Button>
            <Button variant="ghost" size="md" icon={<Icon name="plus" size={16} />} onClick={p.onRegister}>
              {t.pos.register}
            </Button>
          </>
        )}
      </div>

      <div ref={listRef} className="pos-cart__lines scroll" {...(empty ? {} : { role: "list", "aria-label": t.pos.linesAria(totals.count) })}>
        {empty ? (
          <EmptyState
            icon="cart"
            title={t.pos.emptyCartTitle}
            body={p.showKbdHint ? t.pos.emptyCartHintKbd : t.pos.emptyCartHintTouch}
            headingLevel={3}
          />
        ) : bill.lines.map((l) => (
          <CartLineRow
            key={l.key}
            line={l}
            selected={p.selectedKey === l.key}
            disabled={p.paying}
            onSelect={p.onSelect}
            onEdit={p.onEdit}
            onQty={p.onQty}
            onRemove={p.onRemove}
          />
        ))}
      </div>

      <div className="pos-cart__tools">
        <Button variant="secondary" size="md" icon={<Icon name="discount" size={16} />} kbd="F4"
          onClick={p.onDiscount} disabled={empty}
          trailing={p.discountCount > 0 ? <Badge kind="count" tone="accent">{p.discountCount}</Badge> : undefined}>
          {t.pos.discountBtn}
        </Button>
        <Button variant="ghost" size="md" icon={<Icon name="void" size={16} />} onClick={p.onVoid} disabled={empty}
          className="pos-cart__void">
          {t.pos.void}
        </Button>
      </div>

      <TotalBlock totals={totals} compact={p.compact} />

      <div className="pos-pay">
        {p.tableName ? (
          <PayAction kind="charge" amount={baht(totals.total)} kbd="F12" keyShortcuts="F12 Control+Enter"
            icon={<Icon name="park" size={20} />}
            pending={p.paying} disabled={empty} disabledReason={!empty ? offlineReason : undefined}
            onClick={p.onAddToTab}>
            {t.pos.tableAddToTab}
          </PayAction>
        ) : (
          <>
            <div className="pos-pay__methods">
              <PayAction kind="method" icon={<Icon name="qr" size={20} />} onClick={() => p.onPay('qr')}
                disabled={empty || p.paying} disabledReason={!empty ? offlineReason : undefined}>
                {p.compact ? t.pos.payShort.qr : t.pos.pay.qr}
              </PayAction>
              <PayAction kind="method" icon={<Icon name="card" size={20} />} onClick={() => p.onPay('card')}
                disabled={empty || p.paying} disabledReason={!empty ? offlineReason : undefined}>
                {t.pos.pay.card}
              </PayAction>
              <PayAction kind="method" icon={<Icon name="line" size={20} />} onClick={() => p.onPay('line')}
                disabled={empty || p.paying} disabledReason={!empty ? offlineReason : undefined}>
                {p.compact ? t.pos.payShort.line : t.pos.pay.line}
              </PayAction>
            </div>
            <PayAction kind="charge" amount={baht(totals.total)} kbd="F12" keyShortcuts="F12 Control+Enter"
              icon={<Icon name="cash" size={20} />}
              pending={p.paying} disabled={empty} disabledReason={!empty ? offlineReason : undefined}
              onClick={() => p.onPay('cash')}>
              {t.pos.chargeCash}
            </PayAction>
          </>
        )}
      </div>
    </section>
  );
}
