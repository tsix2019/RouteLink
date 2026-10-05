import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { canSignal, signalProcess, type Process, type Signal } from '@/api/services/processes';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useProcesses, useRouterMutation } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes } from '@/utils/format';

type Sort = 'cpu' | 'memory';

/** MO-4: what runs on the router, busiest first; stop or reload a process. */
export default function Processes() {
  const t = useT();
  const toast = useToast();
  const processes = useProcesses();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('cpu');
  const [kernel, setKernel] = useState(false);
  const [selected, setSelected] = useState<Process | null>(null);
  const [pending, setPending] = useState<{ process: Process; signal: Signal } | null>(null);
  const send = useRouterMutation(
    (conn, a: { pid: number; signal: Signal }) => signalProcess(conn, a.pid, a.signal),
    [['processes']],
  );

  const label = (signal: Signal) =>
    t(
      signal === 'TERM'
        ? 'more:processesScreen.term'
        : signal === 'KILL'
          ? 'more:processesScreen.kill'
          : 'more:processesScreen.hup',
    );
  const execute = (process: Process, signal: Signal) =>
    send.mutate(
      { pid: process.pid, signal },
      {
        onSuccess: () => toast(t('more:processesScreen.done', { name: process.name })),
        onError: (error) => toast(describeError(t, error).title, 'error'),
      },
    );
  /** Reloading is harmless; stopping is confirmed first. */
  const choose = (process: Process, signal: Signal) => {
    setSelected(null);
    if (signal === 'HUP') execute(process, signal);
    else setPending({ process, signal });
  };

  const q = query.trim().toLowerCase();
  const list = (processes.data ?? [])
    .filter((p) => kernel || !p.kernel)
    .filter((p) => !q || p.command.toLowerCase().includes(q) || String(p.pid) === q)
    .sort((a, b) => (sort === 'memory' ? b.memoryKb - a.memoryKb || a.pid - b.pid : 0));

  return (
    <>
      <Screen
        title={t('more:processes')}
        onRefresh={() => processes.refetch()}
        top={
          processes.data ? <ConnectionBanner error={processes.error} onRetry={() => void processes.refetch()} /> : null
        }>
        <FeatureGate feature="system.processes" icon="process">
          <SegmentedControl
            values={[t('more:processesScreen.cpu'), t('more:processesScreen.memory')]}
            selectedIndex={sort === 'cpu' ? 0 : 1}
            onChange={(e) => setSort(e.nativeEvent.selectedSegmentIndex === 0 ? 'cpu' : 'memory')}
          />
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder={t('more:processesScreen.search')}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          <ListSection>
            <ListRow title={t('more:processesScreen.kernel')} switchValue={kernel} onSwitch={setKernel} />
          </ListSection>
          {processes.data ? (
            list.length ? (
              <ListSection>
                {list.map((p) => (
                  <ListRow
                    key={p.pid}
                    title={p.name}
                    subtitle={t('more:processesScreen.detail', {
                      pid: p.pid,
                      user: p.user,
                      memory: formatBytes(p.memoryKb * 1024),
                    })}
                    right={
                      <AppText variant="subhead" tone={p.cpuPercent >= 20 ? 'warning' : 'secondary'}>
                        {sort === 'cpu' ? `${p.cpuPercent}%` : `${p.memPercent}%`}
                      </AppText>
                    }
                    chevron={canSignal(p)}
                    onPress={canSignal(p) ? () => setSelected(p) : undefined}
                    testID={`process-${p.pid}`}
                  />
                ))}
              </ListSection>
            ) : (
              <EmptyState icon="process" title={t('more:processesScreen.empty')} />
            )
          ) : processes.isError ? (
            <ErrorState error={processes.error} onRetry={() => void processes.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
          <AppText variant="footnote" tone="tertiary" style={styles.note}>
            {t('more:processesScreen.protected')}
          </AppText>
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!selected}
        title={selected?.name}
        message={selected?.command}
        actions={
          selected
            ? [
                { label: label('HUP'), icon: 'refresh' as const, onPress: () => choose(selected, 'HUP') },
                {
                  label: label('TERM'),
                  icon: 'stop' as const,
                  destructive: true,
                  onPress: () => choose(selected, 'TERM'),
                },
                {
                  label: label('KILL'),
                  icon: 'block' as const,
                  destructive: true,
                  onPress: () => choose(selected, 'KILL'),
                },
              ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={
          pending
            ? t('more:processesScreen.confirmTitle', { action: label(pending.signal), name: pending.process.name })
            : ''
        }
        consequences={[
          pending?.signal === 'KILL'
            ? t('more:processesScreen.killConsequence')
            : t('more:processesScreen.termConsequence'),
        ]}
        confirmLabel={pending ? label(pending.signal) : ''}
        onConfirm={() => {
          if (pending) execute(pending.process, pending.signal);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
});
