import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AgentGate } from '@/features/agent/AgentGate';
import { DestinationList, NeedsDns } from '@/features/control/Destinations';
import { useDeviceLabels } from '@/features/traffic/labels';
import { TimeRangePicker } from '@/features/traffic/TimeRangePicker';
import { DEFAULT_RANGE, resolveRange, type TimeRange } from '@/features/traffic/timeRange';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { Screen } from '@/ui/Screen';
import { normalizeMac } from '@/utils/mac';

/** TR-8: where one device's internet traffic went, by host name when DNS logging knows it. */
export default function DestinationsScreen() {
  const t = useT();
  const { mac: raw } = useLocalSearchParams<{ mac: string }>();
  const mac = normalizeMac(decodeURIComponent(raw ?? '')) ?? '';
  const name = useDeviceLabels()(mac).name;
  const [range, setRange] = useState<TimeRange>(DEFAULT_RANGE);
  const [now, setNow] = useState(() => new Date());
  return (
    <Screen title={t('control:dest.title')} onRefresh={() => setNow(new Date())}>
      <AppText variant="subhead" tone="secondary">
        {name}
      </AppText>
      <AgentGate>
        {(info) => (
          <>
            <TimeRangePicker
              value={range}
              onChange={(r) => {
                setNow(new Date());
                setRange(r);
              }}
            />
            {info.dnsEnabled ? <DestinationList mac={mac} {...resolveRange(range, now)} /> : <NeedsDns />}
          </>
        )}
      </AgentGate>
    </Screen>
  );
}
