/**
 * Mirror of the backend's feature-key registry.
 *
 * The API validates `feature_keys` against ITS copy and 422s on anything unknown
 * (`Unknown feature keys: …`), so this list is only the picker's menu — never the
 * authority. Add a key here when the backend adds one.
 *
 * There is no "list registered keys" endpoint yet; we asked for one in
 * docs/handoffs/Backend/HANDOFF_BE_pilot-hardening-questions.md. Until it exists,
 * a key the backend knows and this file doesn't must still survive an edit — see
 * `featureOptionsFor()` below, which is what stops a save from silently stripping
 * a live entitlement off every tenant on a package.
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

export const FEATURE_KEYS: readonly string[] = FEATURE_REGISTRY.map((f) => f.key);

export interface FeatureOption {
  key: string;
  label: string;
  /** false = the backend has this key but this build doesn't know it. */
  known: boolean;
}

const KNOWN_OPTIONS: FeatureOption[] = FEATURE_REGISTRY.map((f) => ({
  key: f.key,
  label: f.labelTh,
  known: true,
}));

/**
 * The picker's options: everything we know, plus anything the package already
 * carries that we don't. Without the second half, a key added to the backend
 * registry after this build shipped would be invisible in the form — and the next
 * save of ANY field would submit feature_keys without it, revoking the feature
 * from every tenant on that package with no error shown.
 */
export function featureOptionsFor(currentKeys: readonly string[] = []): FeatureOption[] {
  const extra = currentKeys
    .filter((k) => !FEATURE_KEYS.includes(k))
    .map((k) => ({ key: k, label: k, known: false }));
  return [...KNOWN_OPTIONS, ...extra];
}
