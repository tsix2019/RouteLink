import { Redirect } from 'expo-router';

import { useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';

/** First screen: the dashboard when there is something to show, otherwise onboarding. */
export default function Index() {
  const demoMode = useSettings((s) => s.demoMode);
  const hasRouters = useRouters((s) => s.routers.length > 0);
  return <Redirect href={demoMode || hasRouters ? '/overview' : '/welcome'} />;
}
