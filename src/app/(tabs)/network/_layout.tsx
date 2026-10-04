import { AppStack } from '@/features/navigation/AppStack';

export { RouteErrorBoundary as ErrorBoundary } from '@/ui/RouteErrorBoundary';

/** Deep links into a nested screen still get the tab's root screen underneath (back button). */
export const unstable_settings = { initialRouteName: 'index' };

export default function Layout() {
  return <AppStack />;
}
