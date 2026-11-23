import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { SessionExpiredError } from '@/lib/api-client';
import { FEATURE_SELF_ORDERING } from '@/lib/self-ordering';

/** Store entitlement that switches on the board-game add-on (floor, rate plans, sessions). */
export const FEATURE_BOARDGAME = 'vertical.boardgame';

/**
 * System-managed catalog product the backend creates the first time a session bills
 * table time, and re-looks-up BY EXACT NAME on every close. Renaming or retiring it
 * silently breaks time billing, and giving it a recipe would deduct stock on every
 * settle — so the UI hides it from ordering and locks it in product admin.
 */
export const TABLE_TIME_PRODUCT_NAME = 'ค่าโต๊ะ (Table time)';

interface FeaturesRead {
  features: string[];
}

/**
 * The store's enabled feature keys. Drives menu visibility — gated endpoints answer
 * 404 (not 403) when the add-on isn't sold to this store, so we ask once here rather
 * than inferring entitlement from failed requests.
 */
export function useFeatures() {
  return useQuery<string[]>({
    queryKey: ['features'],
    queryFn: async () => {
      try {
        const data = await api.get<FeaturesRead>('/api/v1/me/features');
        return data?.features ?? [];
      } catch (err) {
        // A dead session must still bubble up so the app can bounce to login.
        if (err instanceof SessionExpiredError) throw err;
        // Anything else (backend without the endpoint yet, transient failure) means
        // "no add-ons" — hide the extra UI instead of blocking the whole shell.
        return [];
      }
    },
    staleTime: Infinity,
    retry: false,
  });
}

/** `enabled` is false while loading too, so gated UI never flashes in and out. */
export function useHasFeature(key: string) {
  const { data, isLoading } = useFeatures();
  return { enabled: !!data?.includes(key), isLoading };
}

export function useBoardgameEnabled() {
  return useHasFeature(FEATURE_BOARDGAME);
}

/** Table-QR ordering (mr.bar): customers scan a sticker and order from their phone. */
export function useSelfOrderingEnabled() {
  return useHasFeature(FEATURE_SELF_ORDERING);
}

/**
 * Floor / sessions / rate plans exist for either add-on (both answer 404 otherwise).
 * Self-ordering stores get the tables but never the board-game extras.
 */
export function useTableSystemEnabled() {
  const { data, isLoading } = useFeatures();
  return { enabled: !!data && (data.includes(FEATURE_BOARDGAME) || data.includes(FEATURE_SELF_ORDERING)), isLoading };
}
