'use client';

import { createContext, useContext, useMemo } from 'react';
import type { EditionConfig, OpenSessionBilling, ProductLike } from './types';

const EditionCtx = createContext<EditionConfig | null>(null);

/** Mounted once by `<PosApp>`; everything below can read the active edition. */
export function EditionProvider({ edition, children }: { edition: EditionConfig; children: React.ReactNode }) {
  return <EditionCtx.Provider value={edition}>{children}</EditionCtx.Provider>;
}

export function useEdition(): EditionConfig {
  const edition = useContext(EditionCtx);
  if (!edition) throw new Error('useEdition() outside <EditionProvider> — render screens through <PosApp>');
  return edition;
}

export interface ResolvedProductRules {
  isHiddenFromSale: (p: ProductLike) => boolean;
  isSystemManaged: (p: ProductLike) => boolean;
  isHiddenFromRecipes: (p: ProductLike) => boolean;
}

/** The edition's product rules folded into three predicates (all false when none). */
export function useProductRules(): ResolvedProductRules {
  const { productRules } = useEdition();
  return useMemo(() => {
    const rules = productRules ?? [];
    return {
      isHiddenFromSale: (p) => rules.some((r) => r.hiddenFromSale?.(p) ?? false),
      isSystemManaged: (p) => rules.some((r) => r.systemManaged?.(p) ?? false),
      isHiddenFromRecipes: (p) => rules.some((r) => r.hiddenFromRecipes?.(p) ?? false),
    };
  }, [productRules]);
}

const NO_BILLING: OpenSessionBilling = { ratePlanId: null, blocked: false };
const useNoBilling = (): OpenSessionBilling => NO_BILLING;

/**
 * The open-table dialog's billing slot. Picks the edition's hook once per render;
 * the edition is fixed for the life of the app, so the hook order never changes.
 */
export function useOpenSessionBilling(ctx: { onGoSetup?: () => void }): OpenSessionBilling {
  const useBilling = useEdition().tables?.useOpenSessionBilling ?? useNoBilling;
  return useBilling(ctx);
}
