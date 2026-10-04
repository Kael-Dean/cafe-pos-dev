'use client';

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

export function ProductGrid(p: ProductGridProps) {
  const { t } = useI18n();

  if (p.error) {
    return (
      <EmptyState
        tone="danger"
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
        tone="search"
        title={t.pos.noSearchResults}
        body={t.pos.noSearchHint}
        action={<Button variant="secondary" onClick={p.onClearSearch}>{t.pos.clearSearch}</Button>}
      />
    ) : (
      <EmptyState icon="coffee" title={t.pos.emptyCategory} body={t.pos.emptyCategoryHint} />
    );
  }

  const tiles = p.items.map((m, i) => (
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
