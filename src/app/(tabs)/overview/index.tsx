import { GlassCard } from '@/ui/GlassCard';
import { Screen } from '@/ui/Screen';

export default function Placeholder() {
  return (
    <Screen inTabs={false}>
      <GlassCard title="…" />
    </Screen>
  );
}
