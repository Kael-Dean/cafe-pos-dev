'use client';

import { createContext, useContext, useMemo, useState } from 'react';

/** An open table session the POS is currently ordering for. */
export interface TableTab {
  sessionId: string;
  tableName: string;
}

interface TableTabValue {
  /** The open table tab, or null when the POS sells at the counter. */
  tab: TableTab | null;
  /**
   * Point the POS at a table: while set, checkout creates every order with
   * `session_id` and takes NO payment — the table's food, drinks (and, in the
   * board-game edition, time charge) are settled together from the floor plan.
   */
  start: (tab: TableTab) => void;
  /** Back to counter sales. */
  clear: () => void;
}

const TableTabCtx = createContext<TableTabValue | null>(null);

/**
 * The single seam between the floor plan and the POS screen. Mounted by the shell
 * inside the logged-in tree, so logging out (which unmounts it) always drops the tab.
 */
export function TableTabProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<TableTab | null>(null);
  const value = useMemo<TableTabValue>(() => ({ tab, start: setTab, clear: () => setTab(null) }), [tab]);
  return <TableTabCtx.Provider value={value}>{children}</TableTabCtx.Provider>;
}

const NO_TAB: TableTabValue = { tab: null, start: () => {}, clear: () => {} };

/** Outside a provider (e.g. a screen rendered in isolation) the POS just sells at the counter. */
export function useTableTab(): TableTabValue {
  return useContext(TableTabCtx) ?? NO_TAB;
}
