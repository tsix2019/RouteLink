import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { agentDnsLog, type DnsRecord } from '@/api/services/agent-control';
import { dnsChanges, DEFAULT_DNS } from '@/api/services/agent-rules';
import { uci } from '@/api/uci';
import { AgentGate } from '@/features/agent/AgentGate';
import { useApplyRules, usePluginModule, useRules } from '@/features/control/hooks';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useDeviceLabels } from '@/features/traffic/labels';
import { TimeRangePicker } from '@/features/traffic/TimeRangePicker';
import { DEFAULT_RANGE, resolveRange, type TimeRange } from '@/features/traffic/timeRange';
import { AGENT_KEY } from '@/hooks/agent-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDayTime } from '@/utils/dates';
import { normalizeMac } from '@/utils/mac';

const PAGE = 100;
const LAST_DAY: TimeRange = DEFAULT_RANGE;

/** TR-8: DNS lookups of one device (or all), searchable; turning logging on explains what it records. */
export default function DnsScreen() {
  const t = useT();
  const { mac: raw } = useLocalSearchParams<{ mac?: string }>();
  const mac = raw ? (normalizeMac(decodeURIComponent(raw)) ?? undefined) : undefined;
  const name = useDeviceLabels()(mac ?? '').name;
  return (
    <Screen title={t('control:dns.title')}>
      {mac ? (
        <AppText variant="subhead" tone="secondary">
          {name}
        </AppText>
      ) : null}
      <AgentGate>{(info) => (info.dnsEnabled ? <DnsLog mac={mac} /> : <EnableDns />)}</AgentGate>
    </Screen>
  );
}

function useSetDns() {
  const t = useT();
  const toast = useToast();
  const { connection } = useActiveRouter();
  const rules = useRules();
  const apply = useApplyRules();
  return {
    busy: apply.isPending,
    set: async (enabled: boolean) => {
      if (!connection) return;
      const current = await uci.get(connection, 'routelink');
      apply.mutate(dnsChanges(current, { ...(rules.data?.dns ?? DEFAULT_DNS), enabled }), {
        onSuccess: () => toast(t(enabled ? 'control:dns.turnedOn' : 'control:dns.turnedOff')),
        onError: (e) => toast(describeError(t, e).title, 'error'),
      });
    },
  };
}

function EnableDns() {
  const t = useT();
  const { supported } = usePluginModule('dns');
  const rules = useRules();
  const dns = useSetDns();
  if (!supported) return <Banner tone="warning" text={t('control:needsUpgrade')} />;
  const d = rules.data?.dns ?? DEFAULT_DNS;
  return (
    <GlassCard title={t('control:dns.enableTitle')} icon="eye" contentStyle={styles.card}>
      <AppText variant="body" tone="secondary">
        {t('control:dns.privacy', { days: d.keepDays, count: d.maxRecords })}
      </AppText>
      <GlassButton
        label={t('control:dns.enable')}
        variant="primary"
        loading={dns.busy}
        onPress={() => void dns.set(true)}
        testID="dns-enable"
      />
    </GlassCard>
  );
}

function DnsLog({ mac }: { mac?: string }) {
  const t = useT();
  const lang = useLang();
  const { router, connection } = useActiveRouter();
  const label = useDeviceLabels();
  const dns = useSetDns();
  const [range, setRange] = useState<TimeRange>(LAST_DAY);
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const { start, end } = resolveRange(range, now);
  const q = query.trim().toLowerCase();
  const log = useInfiniteQuery({
    queryKey: [router?.id ?? 'none', AGENT_KEY, 'dns', mac, start, end, q],
    queryFn: ({ pageParam }) => agentDnsLog(connection!, { mac, start, end, q, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + p.records.length, 0);
      return loaded < last.count ? loaded : undefined;
    },
    enabled: !!connection,
  });
  const records: DnsRecord[] = log.data?.pages.flatMap((p) => p.records) ?? [];
  const count = log.data?.pages[0]?.count;

  return (
    <>
      <TimeRangePicker
        value={range}
        onChange={(r) => {
          setNow(new Date());
          setRange(r);
        }}
      />
      <TextField placeholder={t('control:dns.search')} value={query} onChangeText={setQuery} autoCapitalize="none" />
      {log.data ? (
        records.length ? (
          <ListSection title={count !== undefined ? t('control:dns.count', { count }) : undefined}>
            {records.map((r, i) => (
              <ListRow
                key={`${r.ts}-${r.mac}-${i}`}
                title={r.name}
                subtitle={[
                  formatDayTime(r.ts, lang),
                  mac ? null : label(r.mac).name,
                  `${r.type}${r.rcode !== 'NOERROR' ? ` ${r.rcode}` : ''}`,
                  r.answers.slice(0, 2).join(', ') || null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </ListSection>
        ) : (
          <EmptyState icon="search" title={t('control:dns.empty')} />
        )
      ) : (
        <Skeleton height={240} radius={16} />
      )}
      {log.hasNextPage ? (
        <GlassButton
          label={t('control:dns.loadMore')}
          loading={log.isFetchingNextPage}
          onPress={() => void log.fetchNextPage()}
        />
      ) : null}
      <GlassButton
        label={t('control:dns.disable')}
        variant="destructive"
        loading={dns.busy}
        onPress={() => void dns.set(false)}
        testID="dns-disable"
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
});
