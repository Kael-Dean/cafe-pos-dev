'use client';

import { useEffect, useState } from 'react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useStagger } from '@/lib/motion';
import type { MenuItem } from '@/hooks/use-products';
import { ProductTile } from './ProductTile';
import type { Density } from './model';

interface ProductGridProps {
  items: MenuItem[];
  density: Density;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  searching: boolean;
  onClearSearch: () => void;
  /** Show 1–9 badges on the first nine tiles. */
  showHotkeys: boolean;
  highlightedId: string | null;
  pendingId: string | null;
  onAdd: (item: MenuItem) => void;
  onCustomize: (item: MenuItem) => void;
  /** Play the short entrance stagger (category tap). False for hotkey switches and search. */
  animate: boolean;
  /** Changes when the category changes, so the stagger replays only then. */
  animateKey: string;
}

/**
 * Progressive mount: the first screenful of tiles renders at once, the rest follow in
 * small slices between frames. Mounting 150+ tiles in one commit froze low-end
 * tablets (~1.1s on a 4x-throttled CPU when clearing a search); this keeps the
 * first paint + input responsive and finishes in a few frames.
 */
const FIRST_SLICE = 30;
const NEXT_SLICE = 40;

export function ProductGrid(p: ProductGridProps) {
  const { t } = useI18n();
  const total = p.items.length;
  const [shown, setShown] = useState(FIRST_SLICE);
  const [seenItems, setSeenItems] = useState(p.items);
  if (seenItems !== p.items) { setSeenItems(p.items); setShown(FIRST_SLICE); }
  useEffect(() => {
    if (shown >= total) return;
    const id = window.setTimeout(() => setShown((n) => n + NEXT_SLICE), 16);
    return () => window.clearTimeout(id);
  }, [shown, total]);

  if (p.error) {
    return (
      <EmptyState
        tone="danger" headingLevel={2}
        title={t.pos.loadMenuErrorTitle}
        body={t.pos.loadMenuError}
        action={<Button variant="secondary" size="lg" onClick={p.onRetry}>{t.pos.retry}</Button>}
      />
    );
  }

  if (p.loading) {
    return (
      <div className={`pos-grid pos-grid--${p.density}`} aria-busy="true">
        <span className="sr-only" role="status">{t.pos.loadingMenu}</span>
        {Array.from({ length: p.density === 'compact' ? 16 : 8 }).map((_, i) => (
          <div key={i} className={`pos-tile-skel pos-tile-skel--${p.density}`} aria-hidden="true">
            {p.density === 'photo' && <Skeleton className="pos-tile-skel__media" height="auto" radius={0} />}
            <div className="pos-tile-skel__body">
              <Skeleton height={14} width="80%" />
              <Skeleton height={16} width="40%" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (p.items.length === 0) {
    return p.searching ? (
      <EmptyState
        tone="search" headingLevel={2}
        title={t.pos.noSearchResults}
        body={t.pos.noSearchHint}
        action={<Button variant="secondary" onClick={p.onClearSearch}>{t.pos.clearSearch}</Button>}
      />
    ) : (
      <EmptyState headingLevel={2} icon="coffee" title={t.pos.emptyCategory} body={t.pos.emptyCategoryHint} />
    );
  }

  const tiles = p.items.slice(0, shown).map((m, i) => (
    <ProductTile
      key={m.id}
      item={m}
      density={p.density}
      hotkey={p.showHotkeys && i < 9 ? i + 1 : null}
      highlighted={p.highlightedId === m.id}
      pending={p.pendingId === m.id}
      onAdd={p.onAdd}
      onCustomize={p.onCustomize}
    />
  ));

  return p.animate
    ? <StaggerGrid key={p.animateKey} density={p.density}>{tiles}</StaggerGrid>
    : <div className={`pos-grid pos-grid--${p.density}`}>{tiles}</div>;
}

/** One-shot entrance (≤120ms total, first 12 tiles only) — spec §8. */
function StaggerGrid({ density, children }: { density: Density; children: React.ReactNode }) {
  const ref = useStagger({ selector: ':scope > :nth-child(-n+12)', each: 0.01, y: 4, duration: 0.12 });
  return <div ref={ref} className={`pos-grid pos-grid--${density}`}>{children}</div>;
}
