import { useQuery } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';
import { SessionExpiredError } from '@pos/core/lib/api-client';
import { FEATURE_BOARDGAME, FEATURE_SELF_ORDERING, TABLE_FEATURES, tablesEnabledFor } from '@pos/core/edition/nav';

// Feature keys are defined once, next to the nav rules that read them.
export { FEATURE_BOARDGAME, FEATURE_SELF_ORDERING, TABLE_FEATURES };

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

/**
 * The core table / session / bill system is on when the store has any table
 * entitlement (`vertical.boardgame` today, `self_ordering` once the backend issues
 * it). Same loading semantics as `useHasFeature`.
 */
export function useTablesEnabled() {
  const { data, isLoading } = useFeatures();
  return { enabled: tablesEnabledFor(data), isLoading };
}
