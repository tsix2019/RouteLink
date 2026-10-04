import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';

import { useActiveRouter } from './ActiveRouterProvider';

/**
 * Shown above a screen's content when its main query fails (or the password is missing). The screen
 * keeps rendering its last data underneath.
 */
export function ConnectionBanner({ error, onRetry, updatedAt }: { error: unknown; onRetry?: () => void; updatedAt?: number }) {
  const t = useT();
  const { status } = useActiveRouter();
  if (status === 'needs-password') return <Banner tone="warning" text={t('errors:connection.auth')} />;
  if (!error) return null;
  const { title } = describeError(t, error);
  const stale = updatedAt ? ` · ${t('lastUpdated', { time: new Date(updatedAt).toLocaleTimeString() })}` : '';
  return <Banner tone="error" text={`${title}${stale}`} action={onRetry ? { label: t('retry'), onPress: onRetry } : undefined} />;
}
