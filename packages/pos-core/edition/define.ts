import type { EditionConfig } from './types';
import { navScreenIds } from './nav';

/**
 * Identity + validation for an edition config. Fails fast (at module load, so in
 * `next build` and in the edition's unit test) when the nav points at a screen the
 * registry does not provide, when ids repeat, or when the default screen is missing.
 */
export function defineEdition<T extends EditionConfig>(config: T): T {
  const ids = navScreenIds(config.nav);
  const seen = new Set<string>();
  for (const id of config.nav.map((n) => n.id)) {
    if (seen.has(id)) throw new Error(`[edition ${config.id}] duplicate nav id "${id}"`);
    seen.add(id);
  }
  const missing = ids.filter((id) => !(id in config.screens));
  if (missing.length) {
    throw new Error(`[edition ${config.id}] nav items without a screen: ${missing.join(', ')}`);
  }
  const first = config.defaultScreen ?? 'pos';
  if (!(first in config.screens)) {
    throw new Error(`[edition ${config.id}] defaultScreen "${first}" is not registered`);
  }
  return config;
}
