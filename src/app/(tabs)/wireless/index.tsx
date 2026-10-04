import { RouterSwitcherCapsule } from '@/features/routers/RouterSwitcherCapsule';
import { useT } from '@/i18n';
import { GlassCard } from '@/ui/GlassCard';
import { Screen } from '@/ui/Screen';

export default function Placeholder() {
  const t = useT();
  return (
    <Screen title={t('tabs.wireless')} headerLeft={<RouterSwitcherCapsule />}>
      <GlassCard title={t('tabs.wireless')} subtitle="…" />
    </Screen>
  );
}
