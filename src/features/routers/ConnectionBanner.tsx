import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { dropLiveConnection } from '@/api/connection/manager';
import { classifyError } from '@/api/connection/types';
import { useT } from '@/i18n';
import { useRouters } from '@/state/routers';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';
import { PromptSheet } from '@/ui/PromptSheet';
import { formatClock } from '@/utils/dates';

import { useActiveRouter } from './ActiveRouterProvider';

/** Routers whose changed certificate already opened the trust screen this session. */
const mismatchShown = new Set<string>();

/**
 * Shown above a screen's content when its main query fails. The screen keeps its last data
 * underneath. Offline: name and last update; wrong or missing password: re-enter it here; changed
 * certificate: the trust screen opens once by itself (it may be an impostor).
 */
export function ConnectionBanner({
  error,
  onRetry,
  updatedAt,
}: {
  error: unknown;
  onRetry?: () => void;
  updatedAt?: number;
}) {
  const t = useT();
  const nav = useRouter();
  const queryClient = useQueryClient();
  const { status, router } = useActiveRouter();
  const update = useRouters((s) => s.update);
  const [asking, setAsking] = useState(false);
  const live = !!router && !router.isDemo;
  const kind = error ? classifyError(error).kind : null;

  useEffect(() => {
    if (kind !== 'tls-mismatch' || !router || router.isDemo || mismatchShown.has(router.id)) return;
    mismatchShown.add(router.id);
    nav.push('/trust-certificate');
  }, [kind, router, nav]);

  if (live && (status === 'needs-password' || kind === 'auth')) {
    return (
      <>
        <Banner
          tone="warning"
          text={t('errors:relogin.title', { name: router.name })}
          action={{ label: t('errors:relogin.action'), onPress: () => setAsking(true) }}
        />
        <PromptSheet
          visible={asking}
          title={t('errors:relogin.prompt', { name: router.name })}
          confirmLabel={t('errors:relogin.submit')}
          inputProps={{ secret: true, testID: 'relogin-password' }}
          onSubmit={(password) => {
            setAsking(false);
            void update(router.id, {}, password).then(() => {
              dropLiveConnection(router.id);
              return queryClient.invalidateQueries({ queryKey: [router.id] });
            });
          }}
          onCancel={() => setAsking(false)}
        />
      </>
    );
  }
  if (!error) return null;

  if (live && (kind === 'tls-untrusted' || kind === 'tls-mismatch')) {
    return (
      <Banner
        tone="error"
        text={describeError(t, error).title}
        action={{ label: t('routers:trust.view'), onPress: () => nav.push('/trust-certificate') }}
      />
    );
  }
  const title =
    kind === 'offline' && router ? t('errors:offlineNamed', { name: router.name }) : describeError(t, error).title;
  const stale = updatedAt
    ? ` · ${t('lastUpdated', { time: formatClock(Math.floor(updatedAt / 1000), { seconds: true }) })}`
    : '';
  return (
    <Banner
      tone="error"
      text={`${title}${stale}`}
      action={onRetry ? { label: t('retry'), onPress: onRetry } : undefined}
    />
  );
}
