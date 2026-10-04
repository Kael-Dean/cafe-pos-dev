'use client';

import { useState } from 'react';
import Icon from '../../icons';
import { baht } from '../../app-common';
import { useI18n } from '@/lib/i18n';

export interface Totals {
  subtotal: number;
  memberDiscount: number;
  promoDiscount: number;
  manualDiscount: number;
  discount: number;
  total: number;
  count: number;
}

interface TotalBlockProps {
  totals: Totals;
  /** Phone: the breakdown folds behind the total row. */
  compact: boolean;
}

function Rows({ totals }: { totals: Totals }) {
  const { t } = useI18n();
  return (
    <dl className="pos-totals__rows">
      <div className="pos-totals__row">
        <dt>{t.pos.subtotal}</dt>
        <dd className="num">{baht(totals.subtotal)}</dd>
      </div>
      {totals.promoDiscount > 0 && (
        <div className="pos-totals__row pos-totals__row--disc">
          <dt>{t.pos.promoDiscount}</dt>
          <dd className="num">-{baht(totals.promoDiscount)}</dd>
        </div>
      )}
      {totals.memberDiscount > 0 && (
        <div className="pos-totals__row pos-totals__row--disc">
          <dt>{t.pos.memberDiscount}</dt>
          <dd className="num">-{baht(totals.memberDiscount)}</dd>
        </div>
      )}
      {totals.manualDiscount > 0 && (
        <div className="pos-totals__row pos-totals__row--disc">
          <dt>{t.pos.manualDiscount}</dt>
          <dd className="num">-{baht(totals.manualDiscount)}</dd>
        </div>
      )}
    </dl>
  );
}

export function TotalBlock({ totals, compact }: TotalBlockProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // One polite announcement of the total (no second live region elsewhere).
  const live = <span className="sr-only" aria-live="polite" aria-atomic="true">{`${t.pos.grandTotal} ${baht(totals.total)}`}</span>;

  if (compact) {
    return (
      <div className="pos-totals pos-totals--compact">
        {open && <div id="pos-totals-rows"><Rows totals={totals} /></div>}
        <button
          type="button"
          className="pos-totals__toggle"
          aria-expanded={open}
          aria-controls="pos-totals-rows"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="pos-totals__label">
            {t.pos.grandTotal}
            <span className="pos-totals__sub num">
              {t.pos.itemsAria(totals.count)}{totals.discount > 0 ? ` · ${t.pos.discount} -${baht(totals.discount)}` : ''}
            </span>
          </span>
          <span className="pos-totals__amount num">{baht(totals.total)}</span>
          <Icon name="chevronDown" size={16} className="pos-totals__chev" />
        </button>
        {live}
      </div>
    );
  }

  return (
    <div className="pos-totals">
      <Rows totals={totals} />
      <div className="pos-totals__grand">
        <span className="pos-totals__label">{t.pos.grandTotal}</span>
        <span className="pos-totals__amount num">{baht(totals.total)}</span>
      </div>
      {live}
    </div>
  );
}
