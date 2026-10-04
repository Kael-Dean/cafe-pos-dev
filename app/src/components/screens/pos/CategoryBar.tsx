'use client';

import Icon from '../../icons';
import { Chip, Skeleton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { Category } from '@/hooks/use-products';

export const CAT_HOT = 'fav';
export const CAT_ALL = 'all';

interface CategoryBarProps {
  categories: Category[] | undefined;
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  /** Hide the ขายดี chip when there are no best sellers yet. */
  showHot: boolean;
}

export function CategoryBar({ categories, loading, value, onChange, showHot }: CategoryBarProps) {
  const { t } = useI18n();
  return (
    <div className="pos-cats tab-strip scroll" role="toolbar" aria-label={t.pos.categoriesAria}>
      {showHot && (
        <Chip kind="filter" size="lg" pressed={value === CAT_HOT} onClick={() => onChange(CAT_HOT)}
          icon={<Icon name="star" size={14} strokeWidth={2} />}>
          {t.pos.catHot}
        </Chip>
      )}
      <Chip kind="filter" size="lg" pressed={value === CAT_ALL} onClick={() => onChange(CAT_ALL)}>
        {t.pos.catAll}
      </Chip>
      {loading && !categories
        ? [72, 96, 80, 88].map((w, i) => <Skeleton key={i} width={w} height={44} radius="var(--radius-pill)" className="pos-cats__skel" />)
        : (categories ?? []).map((c) => (
          <Chip key={c.id} kind="filter" size="lg" pressed={value === c.id} onClick={() => onChange(c.id)}>
            {c.label}
          </Chip>
        ))}
    </div>
  );
}

/** Ordered chip ids, for `[` / `]` cycling. */
export function categoryOrder(categories: Category[] | undefined, showHot: boolean): string[] {
  return [...(showHot ? [CAT_HOT] : []), CAT_ALL, ...(categories ?? []).map((c) => c.id)];
}
