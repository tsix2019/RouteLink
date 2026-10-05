import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getLeds, ledChanges, type Led, type LedPatch } from '@/api/services/leds';
import { getDeviceCounters } from '@/api/services/network';
import { stageAndApply } from '@/api/uci';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

/** The behaviours offered first; anything else the kernel lists comes after them. */
const COMMON = ['off', 'on', 'heartbeat', 'timer', 'netdev'] as const;
type Choice = string;

const choiceOf = (led: Led): Choice => (led.trigger === 'none' ? (led.on ? 'on' : 'off') : led.trigger);

const patchFor = (choice: Choice, dev?: string): LedPatch =>
  choice === 'on' || choice === 'off'
    ? { trigger: 'none', on: choice === 'on' }
    : choice === 'netdev'
      ? { trigger: 'netdev', dev, mode: ['link', 'tx', 'rx'] }
      : { trigger: choice };

/** MO-7: what each LED shows. LED settings don't cut connections: applied directly. */
export default function Leds() {
  const t = useT();
  const toast = useToast();
  const leds = useRouterQuery(['leds'], getLeds);
  const devices = useRouterQuery(['device-counters'], getDeviceCounters);
  const [editing, setEditing] = useState<Led | null>(null);
  const [netdevFor, setNetdevFor] = useState<Led | null>(null);
  const apply = useRouterMutation(
    (conn, a: { led: Led; patch: LedPatch }) => stageAndApply(conn, ledChanges(a.led, a.patch), { mode: 'direct' }),
    [['leds']],
  );

  const label = (choice: Choice) =>
    (COMMON as readonly string[]).includes(choice) || choice === 'default-on'
      ? t(`more:ledsScreen.trigger.${choice as 'on'}`)
      : t('more:ledsScreen.trigger.other', { trigger: choice });

  const change = (led: Led, patch: LedPatch) =>
    apply.mutate(
      { led, patch },
      {
        onSuccess: () => toast(t('more:ledsScreen.saved')),
        onError: (error) => toast(describeError(t, error).title, 'error'),
      },
    );

  const choices = (led: Led): Choice[] => [
    ...COMMON.filter((c) => c === 'on' || c === 'off' || led.triggers.includes(c)),
    ...led.triggers.filter((x) => x !== 'none' && !(COMMON as readonly string[]).includes(x)),
  ];

  return (
    <>
      <Screen
        title={t('more:leds')}
        onRefresh={() => leds.refetch()}
        top={leds.data ? <ConnectionBanner error={leds.error} onRetry={() => void leds.refetch()} /> : null}>
        <FeatureGate feature="system.leds" icon="light">
          {leds.data ? (
            leds.data.length ? (
              <ListSection footer={t('more:ledsScreen.hint')}>
                {leds.data.map((led) => (
                  <ListRow
                    key={led.sysfs}
                    title={led.name ?? led.sysfs}
                    subtitle={[led.name ? led.sysfs : null, label(choiceOf(led)), led.dev].filter(Boolean).join(' · ')}
                    left={<StatusDot status={led.on ? 'online' : 'offline'} />}
                    chevron
                    onPress={() => setEditing(led)}
                    testID={`led-${led.sysfs}`}
                  />
                ))}
              </ListSection>
            ) : (
              <EmptyState icon="light" title={t('more:ledsScreen.empty')} />
            )
          ) : leds.isError ? (
            <ErrorState error={leds.error} onRetry={() => void leds.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>

      <SelectSheet
        visible={!!editing}
        title={editing ? `${t('more:ledsScreen.mode')} · ${editing.name ?? editing.sysfs}` : ''}
        options={(editing ? choices(editing) : []).map((c) => ({ value: c, label: label(c) }))}
        value={editing ? choiceOf(editing) : ''}
        onSelect={(choice) => {
          const led = editing;
          setEditing(null);
          if (!led) return;
          if (choice === 'netdev') setNetdevFor(led);
          else change(led, patchFor(choice));
        }}
        onCancel={() => setEditing(null)}
      />
      <SelectSheet
        visible={!!netdevFor}
        title={t('more:ledsScreen.chooseDevice')}
        options={Object.keys(devices.data ?? {})
          .filter((d) => d !== 'lo')
          .sort()
          .map((d) => ({ value: d, label: d }))}
        value={netdevFor?.dev ?? ''}
        onSelect={(dev) => {
          const led = netdevFor;
          setNetdevFor(null);
          if (led) change(led, patchFor('netdev', dev));
        }}
        onCancel={() => setNetdevFor(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
});
