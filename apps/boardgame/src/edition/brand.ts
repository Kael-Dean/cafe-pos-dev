import type { EditionBrand } from '@pos/core/edition/types';

/**
 * Server-safe part of the board-game edition (layout metadata, PWA manifest).
 * Product naming is a business call — change it here only.
 */
export const brand: EditionBrand = {
  id: 'boardgame',
  displayName: 'Kafé OS Board Game',
  shortName: 'Kafé BG',
  description: 'ระบบขายหน้าร้าน (POS) สำหรับบอร์ดเกมคาเฟ่ — เปิดโต๊ะ คิดค่าเวลา สั่งอาหาร และรายงานในแอปเดียว',
};
