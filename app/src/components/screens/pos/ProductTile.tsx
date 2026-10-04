'use client';

import { memo, useRef } from 'react';
import Image from 'next/image';
import Icon from '../../icons';
import { Card, Kbd } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MenuItem } from '@/hooks/use-products';
import type { Density } from './model';

const LONG_PRESS_MS = 450;
/** Thai vowels written before their consonant — skipped when picking a tile initial. */
const THAI_LEADING_VOWELS = 'เแโใไ';

export interface ProductTileProps {
  item: MenuItem;
  density: Density;
  /** 1–9 hotkey shown on the tile (desktop only), or null. */
  hotkey: number | null;
  /** Keyboard highlight from search ↑/↓. */
  highlighted: boolean;
  /** Detail lookup in flight for this tile. */
  pending: boolean;
  onAdd: (item: MenuItem) => void;
  /** Long-press: open the line sheet (modifiers + qty + note) before adding. */
  onCustomize: (item: MenuItem) => void;
}

const priceFmt = (n: number) => `฿${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function ProductTileImpl({ item, density, hotkey, highlighted, pending, onAdd, onCustomize }: ProductTileProps) {
  const { t } = useI18n();
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const clear = () => { if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; } };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    longPressed.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      timer.current = null;
      onCustomize(item);
    }, LONG_PRESS_MS);
  };

  const label = `${item.name} ${priceFmt(item.price)}${item.hot ? ` · ${t.pos.bestseller}` : ''}`;
  const tileColor = { '--pos-tile-c': item.color } as React.CSSProperties;

  return (
    <Card
      padding="none"
      className={`pos-tile pos-tile--${density}`}
      selected={highlighted}
      pending={pending}
      aria-label={label}
      aria-keyshortcuts={hotkey ? String(hotkey) : undefined}
      data-product-id={item.id}
      onPointerDown={onPointerDown}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
      onClick={() => {
        if (longPressed.current) { longPressed.current = false; return; }
        onAdd(item);
      }}
    >
      {density === 'photo' && (
        <span className="pos-tile__media" style={tileColor} aria-hidden="true">
          {item.imageUrl ? (
            <Image src={item.imageUrl} alt="" fill sizes="(max-width: 768px) 50vw, 200px" className="pos-tile__img" />
          ) : (
            <span className="pos-tile__initial">{Array.from(item.name).find((c) => !THAI_LEADING_VOWELS.includes(c)) ?? ''}</span>
          )}
        </span>
      )}
      <span className="pos-tile__body" aria-hidden="true">
        <span className="pos-tile__name">
          {density === 'compact' && <span className="pos-tile__dot" style={tileColor} />}
          {item.name}
        </span>
        <span className="pos-tile__foot">
          <span className="pos-tile__price num">{priceFmt(item.price)}</span>
          {item.hot && (
            <span className="pos-tile__hot">
              <Icon name="star" size={12} strokeWidth={2} />
              {t.pos.bestseller}
            </span>
          )}
        </span>
      </span>
      {hotkey != null && (
        <span className="pos-tile__kbd" aria-hidden="true"><Kbd>{hotkey}</Kbd></span>
      )}
    </Card>
  );
}

export const ProductTile = memo(ProductTileImpl);
