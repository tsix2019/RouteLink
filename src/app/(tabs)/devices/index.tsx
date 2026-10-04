import { useT } from '@/i18n';
import { GlassCard } from '@/ui/GlassCard';
import { Screen } from '@/ui/Screen';

export default function Placeholder() {
  const t = useT();
  return (
    <Screen>
      <GlassCard title={t('tabs.devices')} subtitle="…" />
    </Screen>
  );
}
