import { useRouter } from 'expo-router';

import { classifyError } from '@/api/connection/types';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';

import { useActiveRouter } from './ActiveRouterProvider';

/**
 * Shown above a screen's content when its main query fails (or the password is missing). The screen
 * keeps rendering its last data underneath.
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
  const { status, router } = useActiveRouter();
  if (status === 'needs-password') return <Banner tone="warning" text={t('errors:connection.auth')} />;
  if (!error) return null;
  const { title } = describeError(t, error);
  const kind = classifyError(error).kind;
  if ((kind === 'tls-untrusted' || kind === 'tls-mismatch') && router && !router.isDemo) {
    return (
      <Banner
        tone="error"
        text={title}
        action={{ label: t('routers:trust.view'), onPress: () => nav.push('/trust-certificate') }}
      />
    );
  }
  const stale = updatedAt ? ` · ${t('lastUpdated', { time: new Date(updatedAt).toLocaleTimeString() })}` : '';
  return (
    <Banner
      tone="error"
      text={`${title}${stale}`}
      action={onRetry ? { label: t('retry'), onPress: onRetry } : undefined}
    />
  );
}
