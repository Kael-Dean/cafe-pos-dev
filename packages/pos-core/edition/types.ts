/**
 * The edition contract. An edition (apps/cafe, apps/boardgame, …) is a Next app
 * that hands one `EditionConfig` to the core shell (`<PosApp edition={…} />`).
 * Core never imports an edition; editions only add to core through these slots.
 *
 *   build time  — which screens / nav items / plugins the app ships (this file)
 *   runtime     — which of those a store + role may see (`/me/features`, role),
 *                 decided in `visibleNavSections()` and inside each screen
 */
import type { ComponentType, ReactNode } from 'react';
import type { NavItem } from './nav';

/** Props every registered screen receives from the shell. */
export interface ScreenProps {
  /** Go to another screen (runs the unsaved-changes guard first). */
  navigate: (screen: string) => void;
}

export type ScreenComponent = ComponentType<ScreenProps>;
/** Screen id → component. Every non-header id in `nav` must have an entry. */
export type ScreenRegistry = Readonly<Record<string, ScreenComponent>>;

/** The product fields a rule may look at (catalog rows and POS menu items both have these). */
export interface ProductLike { name: string }

/**
 * Edition-level rules for system-managed catalog products (e.g. the board-game
 * "table time" line the backend bills by exact name). Any rule returning true wins.
 */
export interface ProductRule {
  /** Never offered on the POS sale grid (the backend adds it itself). */
  hiddenFromSale?: (p: ProductLike) => boolean;
  /** Shown in catalog admin but locked: no rename / retire. */
  systemManaged?: (p: ProductLike) => boolean;
  /** Left out of the recipe (BOM) builder — must never get a recipe. */
  hiddenFromRecipes?: (p: ProductLike) => boolean;
}

/** What an edition's billing plugin contributes to the "open table" dialog. */
export interface OpenSessionBilling {
  /** Sent as `rate_plan_id`; `null` lets the backend pick (or reject) the plan. */
  ratePlanId: string | null;
  /** True while the session must not be opened (e.g. the store has no plan yet). */
  blocked: boolean;
  /** Rendered at the top of the dialog body (e.g. "create a plan first"). */
  notice?: ReactNode;
  /** Rendered right after the party-size field (e.g. the plan picker). */
  field?: ReactNode;
}

/**
 * Billing on top of the core table / session / bill system. Core tables work
 * without it (bar-style tabs); the board-game edition plugs time billing in here.
 */
export interface TableBillingExtension {
  /** Extra section at the top of the table setup screen (e.g. rate plans). */
  SetupSection?: ComponentType;
  /**
   * Hook called unconditionally by the open-table dialog. Must follow the rules of
   * hooks; the edition never changes at runtime, so the call order is stable.
   */
  useOpenSessionBilling?: (ctx: { onGoSetup?: () => void }) => OpenSessionBilling;
}

export interface EditionConfig {
  /** Stable machine id: 'cafe' | 'boardgame' | … */
  id: string;
  /** Product name: login screen, <title>, PWA name. */
  displayName: string;
  /** PWA short_name (home-screen label). */
  shortName: string;
  /** PWA / meta description (Thai). */
  description: string;
  /** Composed navigation (headers + items). Usually CORE_NAV plus edition items. */
  nav: readonly NavItem[];
  /** Screen id → component for every screen in `nav`. */
  screens: ScreenRegistry;
  /** First screen after login. Default 'pos'. */
  defaultScreen?: string;
  /**
   * Store feature keys this edition ships UI for. Informational (docs, tests,
   * provisioning); runtime gating still reads the store's `/me/features`.
   */
  features: readonly string[];
  productRules?: readonly ProductRule[];
  tables?: TableBillingExtension;
}

/** The serialisable part of an edition (safe to import from server files: layout, manifest). */
export type EditionBrand = Pick<EditionConfig, 'id' | 'displayName' | 'shortName' | 'description'>;
