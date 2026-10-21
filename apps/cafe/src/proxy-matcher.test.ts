import { describe, expect, it } from 'vitest';
import { PROXY_CONFIG } from '@pos/core/lib/server/proxy';
import { config } from './proxy';

// Next reads `config` statically from this app's proxy.ts, so the matcher is a
// literal copy of core's. This keeps the copy honest.
describe('proxy matcher', () => {
  it('matches the core PROXY_CONFIG exactly', () => {
    expect(config).toEqual(PROXY_CONFIG);
  });
});
