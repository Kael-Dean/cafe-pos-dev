// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isValidPromptPayId, maskPromptPayId, promptPayPayload, qrPath, readPromptPayId, savePromptPayId } from './promptpay';

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), the EMVCo checksum. */
function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Minimal TLV walk: top-level tag -> value. */
function tlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < payload.length;) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    out[tag] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe('isValidPromptPayId', () => {
  it.each([
    ['0812345678', true],
    ['081-234-5678', true],
    ['1234567890123', true], // citizen / tax id
    ['123456789012345', true], // e-wallet
    ['1812345678', false], // 10 digits but not a 0-leading phone
    ['08123456', false],
    ['', false],
    ['abc', false],
  ])('%s -> %s', (id, ok) => expect(isValidPromptPayId(id)).toBe(ok));
});

describe('promptPayPayload', () => {
  const payload = promptPayPayload('0812345678', 125.5);
  const f = tlv(payload);

  it('is an EMVCo dynamic payload for Thailand', () => {
    expect(payload.startsWith('000201')).toBe(true);
    expect(f['01']).toBe('12'); // dynamic (amount present)
    expect(f['53']).toBe('764'); // THB
    expect(f['58']).toBe('TH');
  });

  it('carries the exact amount with two decimals in tag 54', () => {
    expect(f['54']).toBe('125.50');
    expect(tlv(promptPayPayload('0812345678', 100))['54']).toBe('100.00');
    expect(tlv(promptPayPayload('0812345678', 0.5))['54']).toBe('0.50');
  });

  it('rounds float noise to satang (0.1 + 0.2)', () => {
    expect(tlv(promptPayPayload('0812345678', 0.1 + 0.2))['54']).toBe('0.30');
  });

  it('encodes the phone number as 0066 + national number in the merchant account tag', () => {
    expect(f['29']).toContain('A000000677010111');
    expect(f['29']).toContain('0066812345678');
  });

  it('ends with a valid CRC-16 (tag 63)', () => {
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it('checksum changes when the amount changes', () => {
    expect(promptPayPayload('0812345678', 125.5).slice(-4)).not.toBe(promptPayPayload('0812345678', 126).slice(-4));
  });

  it('citizen id is carried and the checksum is still valid', () => {
    const p = promptPayPayload('1234567890123', 10);
    expect(tlv(p)['29']).toContain('1234567890123');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
});

describe('maskPromptPayId', () => {
  it('masks the middle of a phone number', () => expect(maskPromptPayId('0812345678')).toBe('081-xxx-5678'));
  it('keeps only the last 4 of longer ids', () => expect(maskPromptPayId('1234567890123')).toBe('xxxxxxxxx0123'));
});

describe('per-device PromptPay id storage', () => {
  beforeEach(() => localStorage.clear());

  it('save strips non-digits and read returns it', () => {
    expect(savePromptPayId('081-234-5678')).toBe('0812345678');
    expect(readPromptPayId()).toBe('0812345678');
  });

  it('an invalid stored value is ignored', () => {
    localStorage.setItem('kafe:promptpay-id', '123');
    expect(readPromptPayId()).toBe('');
  });
});

describe('qrPath', () => {
  it('builds a square module path for a payload', () => {
    const { size, d } = qrPath(promptPayPayload('0812345678', 50));
    expect(size).toBeGreaterThan(20);
    expect(d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});
