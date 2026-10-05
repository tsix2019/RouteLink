import type { ReactNode } from 'react';

import type { Feature } from '@/api/capabilities';
import { useCapabilities } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/Feedback';
import type { IconName } from '@/ui/Icon';

/**
 * Shows `children` when the router offers `feature`; otherwise names the LuCI package that would add it.
 * While the capabilities load, the children show (they have their own loading state).
 */
export function FeatureGate({ feature, icon, children }: { feature: Feature; icon: IconName; children: ReactNode }) {
  const t = useT();
  const state = useCapabilities().data?.[feature];
  if (!state || state.status === 'ok') return children;
  return (
    <EmptyState
      icon={icon}
      title={t('feature.unavailable')}
      message={
        state.status === 'missing-package'
          ? t('feature.needsPackages', { packages: state.packages.join(', ') })
          : t('feature.unsupported')
      }
    />
  );
}
