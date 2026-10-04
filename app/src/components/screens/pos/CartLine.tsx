'use client';

import { memo, useEffect, useId, useRef, useState } from 'react';
import Icon from '../../icons';
import { useI18n } from '@/lib/i18n';
import type { CartLine as Line } from '@/stores/cart-store';

const REVEAL_PX = 72;
const SWIPE_SLOP = 10;
/** A line touched this recently (ms) plays the "added" highlight when it renders. */
const FRESH_MS = 600;

interface CartLineProps {
  line: Line;
  selected: boolean;
  disabled?: boolean;
  onSelect: (key: string) => void;
  onEdit: (key: string) => void;
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
}

const fmt = (n: number) => `฿${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function CartLineImpl({ line, selected, disabled, onSelect, onEdit, onQty, onRemove }: CartLineProps) {
  const { t } = useI18n();
  const rowRef = useRef<HTMLDivElement>(null);
  const modsId = useId();
  const [revealed, setRevealed] = useState(false);
  const drag = useRef<{ x: number; y: number; dx: number; active: boolean; id: number } | null>(null);
  const swallowClick = useRef(false);

  // 160ms highlight when the line is added or bumped (spec §8). Restarted by
  // re-setting the attribute; old lines skip it on remount (screen switch).
  useEffect(() => {
    const el = rowRef.current;
    if (!el || Date.now() - line.touchedAt > FRESH_MS) return;
    el.removeAttribute('data-fresh');
    void el.offsetWidth;
    el.setAttribute('data-fresh', '');
    const id = window.setTimeout(() => el.removeAttribute('data-fresh'), 400);
    return () => window.clearTimeout(id);
  }, [line.touchedAt]);

  const setX = (px: number) => rowRef.current?.style.setProperty('--pos-swipe-x', `${px}px`);

  // ── Swipe left to reveal "ลบ" (touch only; mouse users have the stepper/sheet) ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (Math.abs(dx) < SWIPE_SLOP) return;
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      rowRef.current?.setAttribute('data-dragging', '');
    }
    const base = revealed ? -REVEAL_PX : 0;
    d.dx = Math.min(0, base + dx);
    setX(d.dx);
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    swallowClick.current = true;
    rowRef.current?.removeAttribute('data-dragging');
    const width = rowRef.current?.offsetWidth ?? 320;
    if (-d.dx > width * 0.6) { onRemove(line.key); return; }
    const open = -d.dx > REVEAL_PX / 2;
    setRevealed(open);
    setX(open ? -REVEAL_PX : 0);
  };

  const close = () => { setRevealed(false); setX(0); };
  const amount = line.unitPrice * line.qty;
  const atOne = line.qty <= 1;

  return (
    <div
      ref={rowRef}
      className="pos-line"
      data-selected={selected ? '' : undefined}
      data-revealed={revealed ? '' : undefined}
      role="listitem"
      aria-current={selected || undefined}
    >
      <button
        type="button"
        className="pos-line__swipe-del"
        tabIndex={revealed ? 0 : -1}
        aria-hidden={!revealed}
        onClick={() => onRemove(line.key)}
      >
        <Icon name="trash" size={18} />
        {t.pos.remove}
      </button>

      <div
        className="pos-line__row"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <button
          type="button"
          className="pos-line__main"
          disabled={disabled}
          aria-label={t.pos.lineAria(line.name, line.qty, fmt(amount))}
          aria-describedby={line.mods.length || line.note ? modsId : undefined}
          onFocus={() => onSelect(line.key)}
          onClick={() => {
            if (swallowClick.current) { swallowClick.current = false; return; }
            if (revealed) { close(); return; }
            onSelect(line.key);
            onEdit(line.key);
          }}
        >
          <span className="pos-line__name">{line.name}</span>
          {(line.mods.length > 0 || line.note) && (
            <span id={modsId} className="pos-line__mods">
              {[...line.mods, ...(line.note ? [`${t.pos.notePrefix} ${line.note}`] : [])].join(' · ')}
            </span>
          )}
        </button>

        <div className="pos-line__qty" role="group" aria-label={t.pos.qtyGroup(line.name)}>
          <button
            type="button"
            className="pos-step"
            disabled={disabled}
            aria-label={atOne ? t.pos.removeItem(line.name) : t.pos.decQty}
            onClick={() => (atOne ? onRemove(line.key) : onQty(line.key, line.qty - 1))}
          >
            <Icon name={atOne ? 'trash' : 'minus'} size={16} strokeWidth={2} />
          </button>
          <span key={line.qty} className="pos-line__count num" aria-live="off">{line.qty}</span>
          <button
            type="button"
            className="pos-step"
            disabled={disabled}
            aria-label={t.pos.incQty}
            onClick={() => onQty(line.key, line.qty + 1)}
          >
            <Icon name="plus" size={16} strokeWidth={2} />
          </button>
        </div>

        <span className="pos-line__amount num">{fmt(amount)}</span>
      </div>
    </div>
  );
}

export const CartLineRow = memo(CartLineImpl);
