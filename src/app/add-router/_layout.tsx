import { AppStack } from '@/features/navigation/AppStack';

export { RouteErrorBoundary as ErrorBoundary } from '@/ui/RouteErrorBoundary';

export default function Layout() {
  return <AppStack />;
}
