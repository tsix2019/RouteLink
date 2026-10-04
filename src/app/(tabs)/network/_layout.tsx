import { AppStack } from '@/features/navigation/AppStack';

/** Deep links into a nested screen still get the tab's root screen underneath (back button). */
export const unstable_settings = { initialRouteName: 'index' };

export default function Layout() {
  return <AppStack />;
}
