import { CORE_NAV, FEATURE_BOARDGAME, insertNav, type NavItem } from '@pos/core/edition/nav';

/**
 * Board-game-only screens, appended to the core table section. All gated by the
 * `vertical.boardgame` entitlement on top of being shipped in this edition.
 *
 * Planned slots: the screens are reserved (nav + placeholder screen) but not built
 * yet — `soft: true` renders the existing "P1" marker. To ship one, build the
 * screen under src/screens/, point its registry entry in ./index.tsx at it and drop
 * `soft`.
 */
export const BOARDGAME_NAV: readonly NavItem[] = [
  { id: 'bg-lending',      icon: 'dice',     feature: FEATURE_BOARDGAME, soft: true,
    label: { th: 'ยืม–คืนเกม', en: 'Game lending' } },
  { id: 'bg-reservations', icon: 'calendar', feature: FEATURE_BOARDGAME, soft: true,
    label: { th: 'จองโต๊ะ', en: 'Reservations' } },
  { id: 'bg-library',      icon: 'layers',   feature: FEATURE_BOARDGAME, soft: true,
    label: { th: 'คลังเกม', en: 'Game library' } },
  { id: 'bg-report',       icon: 'chart',    feature: FEATURE_BOARDGAME, soft: true, adminOnly: true,
    label: { th: 'รายงานบอร์ดเกม', en: 'Board-game report' } },
];

/** Core nav with the board-game items at the end of the table section. */
export const nav: readonly NavItem[] = insertNav(CORE_NAV, 'sec-boardgame', BOARDGAME_NAV);
