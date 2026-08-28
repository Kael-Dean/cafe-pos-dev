/**
 * Local half of the feature-key registry.
 *
 * As of Train B.1 the authority is `GET /api/v1/admin/feature-keys` (see
 * useFeatureKeys) — the exact set POST/PATCH /admin/packages accepts. This file
 * keeps the two things that endpoint cannot give us:
 *
 *  1. **Thai labels.** The API's `label` is English by design; display copy is ours.
 *  2. **A fallback list**, used when the fetch hasn't landed, failed, or is talking
 *     to a deploy that predates the endpoint. Without it the picker would render
 *     empty and an admin could save a package with its features silently wiped.
 */

export interface FeatureDef {
  key: string;
  labelTh: string;
  labelEn: string;
}

export const FEATURE_REGISTRY: readonly FeatureDef[] = [
  {
    key: 'vertical.boardgame',
    labelTh: 'บอร์ดเกมคาเฟ่',
    labelEn: 'Board game cafe',
  },
] as const;

const LABELS_TH = new Map(FEATURE_REGISTRY.map((f) => [f.key, f.labelTh]));

export interface FeatureOption {
  key: string;
  label: string;
  /** false = neither the API nor this build described this key; it came off the package. */
  known: boolean;
}

/** Thai first, then whatever English the API gave us, then the raw key. */
function labelFor(key: string, remoteLabel?: string): string {
  return LABELS_TH.get(key) ?? remoteLabel ?? key;
}

/**
 * The picker's options: every key the backend accepts, plus anything this package
 * already carries that isn't in that list.
 *
 * The second half is belt-and-braces the backend explicitly asked us to keep. If a
 * key is missing from the fetched list — a stale client build, a failed request, a
 * deploy without the endpoint — it must still render, checked, rather than drop out
 * of the next save and revoke the feature from every tenant on the package.
 */
export function featureOptionsFor(
  remote: readonly { key: string; label: string }[] | undefined,
  currentKeys: readonly string[] = [],
): FeatureOption[] {
  const source = remote?.length
    ? remote.map((f) => ({ key: f.key, label: labelFor(f.key, f.label), known: true }))
    : FEATURE_REGISTRY.map((f) => ({ key: f.key, label: f.labelTh, known: true }));

  const listed = new Set(source.map((o) => o.key));
  const extra = currentKeys
    .filter((k) => !listed.has(k))
    .map((k) => ({ key: k, label: labelFor(k), known: false }));

  return [...source, ...extra];
}
