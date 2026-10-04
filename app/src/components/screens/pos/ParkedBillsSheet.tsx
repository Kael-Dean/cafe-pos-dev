'use client';

import { useState } from 'react';
import Icon from '../../icons';
import { baht } from '../../app-common';
import { Button, EmptyState, IconButton, Sheet } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { ParkedBill } from '@/stores/cart-store';

interface ParkedBillsSheetProps {
  open: boolean;
  onClose: () => void;
  parked: ParkedBill[];
  /** Current cart has items (resuming parks it in its place). */
  currentHasItems: boolean;
  onResume: (id: string) => void;
  onDrop: (id: string) => void;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export function ParkedBillsSheet({ open, onClose, parked, currentHasItems, onResume, onDrop }: ParkedBillsSheetProps) {
  const { t } = useI18n();
  // Dropping a parked bill is destructive: the first tap arms, the second drops.
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title={t.pos.parkedTitle}
      description={currentHasItems ? t.pos.parkedSwapHint : undefined}>
      {parked.length === 0 ? (
        <EmptyState icon="park" title={t.pos.parkedEmpty} />
      ) : (
        <ul className="pos-parked">
          {[...parked].reverse().map((p) => {
            const count = p.bill.lines.reduce((s, l) => s + l.qty, 0);
            const sum = p.bill.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
            const names = p.bill.lines.map((l) => l.name).join(', ');
            return (
              <li key={p.id} className="pos-parked__item">
                <div className="pos-parked__info">
                  <span className="pos-parked__title">
                    <span className="num">{time(p.parkedAt)}</span>
                    {p.bill.member ? ` · ${p.bill.member.account.customer_name}` : ''}
                  </span>
                  <span className="pos-parked__names">{names}</span>
                  <span className="pos-parked__meta num">{t.pos.itemsAria(count)} · {baht(sum)}</span>
                </div>
                {armed === p.id ? (
                  <Button variant="danger" size="lg" onClick={() => { setArmed(null); onDrop(p.id); }}>
                    {t.pos.parkedDropConfirm}
                  </Button>
                ) : (
                  <IconButton variant="danger" size="lg" icon={<Icon name="trash" size={18} />} label={t.pos.parkedDrop}
                    onClick={() => setArmed(p.id)} />
                )}
                <Button variant="primary" size="lg" onClick={() => onResume(p.id)}>{t.pos.parkedResume}</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
