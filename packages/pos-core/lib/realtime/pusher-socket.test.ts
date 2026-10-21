import { describe, expect, it } from 'vitest';
import { parsePusherFrame, pusherConfig, pusherUrl, reconnectDelay } from './pusher-socket';
import { buildCsp, realtimeOrigins } from '../server/csp';

describe('pusher config', () => {
  it('is off without a key', () => {
    expect(pusherConfig({ key: '', cluster: 'ap1' })).toBeNull();
    expect(pusherConfig({})).toBeNull();
  });
  it('defaults the cluster and rejects unsafe values', () => {
    expect(pusherConfig({ key: 'abc123' })).toEqual({ key: 'abc123', cluster: 'ap1' });
    expect(pusherConfig({ key: 'abc', cluster: 'evil.com/x' })).toBeNull();
    expect(pusherConfig({ key: 'a b', cluster: 'ap1' })).toBeNull();
  });
  it('builds the socket URL for protocol 7', () => {
    expect(pusherUrl({ key: 'k1', cluster: 'ap1' })).toMatch(/^wss:\/\/ws-ap1\.pusher\.com\/app\/k1\?protocol=7/);
  });
});

describe('pusher frames', () => {
  it('parses the double-encoded data field', () => {
    const raw = JSON.stringify({ event: 'order.created', channel: 'kds-store-s1', data: JSON.stringify({ order_id: 'o1' }) });
    expect(parsePusherFrame(raw)).toEqual({ event: 'order.created', channel: 'kds-store-s1', data: { order_id: 'o1' } });
  });
  it('ignores junk', () => {
    expect(parsePusherFrame('not json')).toBeNull();
    expect(parsePusherFrame(JSON.stringify({ nope: 1 }))).toBeNull();
    expect(parsePusherFrame(42)).toBeNull();
  });
  it('backs off up to 30 s', () => {
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(3)).toBe(8000);
    expect(reconnectDelay(20)).toBe(30_000);
  });
});

describe('CSP connect-src for the Pusher socket', () => {
  it('adds the cluster host only when a key is configured', () => {
    expect(realtimeOrigins({})).toEqual([]);
    expect(realtimeOrigins({ NEXT_PUBLIC_PUSHER_KEY: 'k', NEXT_PUBLIC_PUSHER_CLUSTER: 'AP1' })).toEqual(['wss://ws-ap1.pusher.com']);
    expect(realtimeOrigins({ NEXT_PUBLIC_PUSHER_KEY: 'k', NEXT_PUBLIC_PUSHER_CLUSTER: "ap1 'unsafe-inline'" })).toEqual([]);
  });
  it('lands in connect-src', () => {
    const csp = buildCsp({ nonce: 'n', isDev: false, connectOrigins: ['wss://ws-ap1.pusher.com'] });
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:8080 wss://ws-ap1.pusher.com");
  });
});
