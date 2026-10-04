import { QueryClient, focusManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { classifyError, isPermanentFailure } from '@/api/connection/types';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Wrong password, untrusted certificate or missing permission will not fix themselves. An
        // unreachable router gets one quick retry; polling tries again on its next tick anyway, and
        // the offline banner should not wait for a long retry chain.
        retry: (failures, error) => {
          const failure = classifyError(error);
          if (isPermanentFailure(failure)) return false;
          return failures < (failure.kind === 'offline' ? 1 : 2);
        },
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
        staleTime: 2_000,
        gcTime: 30 * 60_000,
      },
      mutations: { retry: false },
    },
  });
}

/** Pauses refetching while the app is in the background (React Query has no AppState hook of its own). */
export function useAppStateFocus(): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
}
