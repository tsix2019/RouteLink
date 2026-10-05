import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RouterConnection } from '@/api/connection/types';
import { getConnections, groupBySource, ReverseDns, type Connection } from '@/api/services/conntrack';
import { pickWan, type NetInterface } from '@/api/services/network';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useClients, useInterfaces, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { formatBytes } from '@/utils/format';
import { prefixContains } from '@/utils/net';

/** One reverse-DNS cache per router for the app session (answers kept ten minutes). */
const resolvers = new Map<string, ReverseDns>();
const resolverFor = (routerId: string) => {
  let r = resolvers.get(routerId);
  if (!r) resolvers.set(routerId, (r = new ReverseDns()));
  return r;
};

async function loadConnections(conn: RouterConnection) {
  const list = await getConnections(conn);
  const remotes = [...new Set(list.map((c) => c.dst))];
  const names = await resolverFor(conn.routerId).resolve(conn, remotes);
  return { list, names };
}

const PER_GROUP = 12;

/** NW-5: connections the router tracks, by the device that opened them, with names for remote ends. */
export default function Connections() {
  const t = useT();
  const params = useLocalSearchParams<{ ip?: string }>();
  const data = useRouterQuery(['connections'], loadConnections, { refetchInterval: 5_000 });
  const clients = useClients();
  const interfaces = useInterfaces();
  const [query, setQuery] = useState(params.ip ?? '');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const routerAddresses = new Set(
    (interfaces.data ?? []).flatMap((i: NetInterface) => [...i.ipv4, ...i.ipv6].map((a) => a.address)),
  );
  const wan = pickWan(interfaces.data ?? []);
  const localNets = (interfaces.data ?? [])
    .filter((i) => i !== wan && i.name !== 'wan6' && i.name !== 'loopback')
    .flatMap((i) => [...i.ipv4, ...i.ipv6].map((a) => `${a.address}/${a.mask}`));
  const deviceName = (ip: string) => clients.data?.find((c) => c.ipv4 === ip)?.name;
  /** The router, a known device, another local address, or someone on the internet (port forwards). */
  const groupTitle = (ip: string) =>
    routerAddresses.has(ip)
      ? t('network:connections.router')
      : (deviceName(ip) ?? (localNets.some((n) => prefixContains(n, ip)) ? ip : t('network:connections.inbound')));

  const q = query.trim().toLowerCase();
  const names = data.data?.names ?? {};
  const matches = (c: Connection) =>
    !q ||
    c.src.includes(q) ||
    c.dst.includes(q) ||
    String(c.dport ?? '') === q ||
    (names[c.dst] ?? '').toLowerCase().includes(q) ||
    (deviceName(c.src) ?? '').toLowerCase().includes(q);
  const groups = groupBySource((data.data?.list ?? []).filter(matches));
  const total = groups.reduce((n, g) => n + g.connections.length, 0);
  const counted = (data.data?.list ?? []).some((c) => c.bytes > 0);

  return (
    <Screen
      title={t('network:connections.title')}
      onRefresh={() => data.refetch()}
      top={data.data ? <ConnectionBanner error={data.error} onRetry={() => void data.refetch()} /> : null}>
      <FeatureGate feature="network.connections" icon="connections">
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('network:connections.filter')}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {data.data ? (
          groups.length ? (
            <>
              <AppText variant="footnote" tone="secondary" style={styles.summary}>
                {t('network:connections.summary', { count: total })}
                {counted ? '' : `  ${t('network:connections.noAccounting')}`}
              </AppText>
              {groups.map((g) => {
                const open = expanded.has(g.address);
                const shown = open ? g.connections : g.connections.slice(0, PER_GROUP);
                return (
                  <ListSection
                    key={g.address}
                    title={`${groupTitle(g.address)} · ${g.address}${g.bytes ? ` · ${formatBytes(g.bytes)}` : ''}`}>
                    {shown.map((c, i) => (
                      <ListRow
                        key={`${c.protocol}-${c.dst}-${c.sport ?? i}-${c.dport ?? ''}`}
                        title={names[c.dst] ?? c.dst}
                        subtitle={[
                          c.protocol.toUpperCase(),
                          c.dport !== undefined ? String(c.dport) : null,
                          names[c.dst] ? c.dst : null,
                          c.bytes ? formatBytes(c.bytes) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    ))}
                    {g.connections.length > PER_GROUP && !open ? (
                      <ListRow
                        title={t('network:connections.more', { count: g.connections.length })}
                        chevron
                        onPress={() => setExpanded((s) => new Set(s).add(g.address))}
                      />
                    ) : null}
                  </ListSection>
                );
              })}
            </>
          ) : (
            <EmptyState icon="connections" title={t('network:connections.empty')} />
          )
        ) : data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        )}
      </FeatureGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  summary: { paddingHorizontal: spacing.l },
});
