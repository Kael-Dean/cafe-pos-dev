'use client';

import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';

/**
 * PromptPay (EMVCo merchant-presented) payload + QR matrix, built entirely on the
 * client so the code renders instantly and with the network down (D5: personal
 * PromptPay QR + manual confirm).
 *
 * Where the PromptPay ID comes from: the backend stores `store.promptpay_id`, but
 * no frontend endpoint exposes it yet (backend gap). Until it does, the ID is a
 * per-device setting in localStorage, seeded from `NEXT_PUBLIC_PROMPTPAY_ID`.
 */

const STORAGE_KEY = 'kafe:promptpay-id';
const ENV_ID = process.env.NEXT_PUBLIC_PROMPTPAY_ID ?? '';

/** Digits only. */
const digits = (v: string) => v.replace(/\D/g, '');

/** Phone (10 digits, leading 0), citizen / tax ID (13) or e-Wallet (15). */
export function isValidPromptPayId(raw: string): boolean {
  const d = digits(raw);
  return (d.length === 10 && d.startsWith('0')) || d.length === 13 || d.length === 15;
}

export function readPromptPayId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isValidPromptPayId(saved)) return digits(saved);
  } catch { /* storage blocked — fall through to the env default */ }
  return isValidPromptPayId(ENV_ID) ? digits(ENV_ID) : '';
}

export function savePromptPayId(raw: string): string {
  const d = digits(raw);
  try { localStorage.setItem(STORAGE_KEY, d); } catch { /* storage blocked */ }
  return d;
}

/** "0812345678" → "081-xxx-5678" · 13 digits → "1-2345-xxxxx-12-3"-ish tail mask. */
export function maskPromptPayId(id: string): string {
  if (id.length === 10) return `${id.slice(0, 3)}-xxx-${id.slice(6)}`;
  return `${'x'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

/** EMVCo payload with the exact amount (Tag 54) and CRC-16 (Tag 63) from the library. */
export function promptPayPayload(id: string, amount: number): string {
  // Two decimal places, no locale formatting (the library writes Tag 54 itself).
  return generatePayload(id, { amount: Math.round(amount * 100) / 100 });
}

/**
 * QR matrix → one SVG path ("M x y h1v1h-1z" per dark module). Synchronous, so the
 * panel renders in the same frame as the amount: no skeleton, no fake delay.
 */
export function qrPath(payload: string): { size: number; d: string } {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, d };
}
