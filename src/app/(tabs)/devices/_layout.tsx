import { TabStack } from '@/features/navigation/TabStack';
import { useT } from '@/i18n';

export default function Layout() {
  const t = useT();
  return <TabStack title={t('tabs.devices')} />;
}
