import { useId } from 'react';

import { generateKeyPair, generatePsk } from '@/api/services/wireguard-config';
import { useRouterQuery } from '@/hooks/router-queries';

/**
 * Keys made by the router for one visit to a WireGuard form, so Save only has to stage uci changes. Never
 * refetched (a new pair would change the form under the user) and dropped when the page goes.
 */
export function useWgKeys(want: { pair: boolean; psk: boolean }) {
  const visit = useId();
  return useRouterQuery(
    ['wireguard-keys', visit, want.pair, want.psk],
    async (conn) => ({
      pair: want.pair ? await generateKeyPair(conn) : null,
      psk: want.psk ? await generatePsk(conn) : '',
    }),
    { staleTime: Infinity, gcTime: 0 },
  );
}
