import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ddnsChanges, getDdns, saveDdns, type DdnsService } from '@/api/services/ddns';
import type { UbusCall } from '@/api/ubus/types';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT, type AppT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const editHref = (section?: string) =>
  `/network/edit/ddns${section ? `?section=${encodeURIComponent(section)}` : ''}` as const;

function statusLine(t: AppT, s: DdnsService): string {
  const parts: string[] = [];
  if (s.status.ip) parts.push(t('network:ddns.registered', { ip: s.status.ip }));
  if (s.status.lastUpdate) parts.push(t('network:ddns.lastUpdate', { time: s.status.lastUpdate }));
  const next = s.status.next;
  if (next === 'verify' || next === 'once' || next === 'disabled' || next === 'stopped') {
    parts.push(t(`network:ddns.next.${next}`));
  } else if (next && !s.status.lastUpdate) parts.push(t('network:ddns.nextAt', { time: next }));
  // One line: the row shows two (provider, then this).
  return parts.join(' · ');
}

/** NW-9: ddns-scripts services with their state (switched here, edited on their own page). */
export default function Ddns() {
  const t = useT();
  const toast = useToast();
  const state = useRouterQuery(['ddns'], getDdns, { refetchInterval: 15_000 });
  const nav = useRouter();
  const save = useRouterMutation((conn, changes: UbusCall[]) => saveDdns(conn, changes), [['ddns']]);
  const fail = (e: unknown) => toast(describeError(t, e).title, 'error');
  const commit = (changes: UbusCall[]) =>
    save.mutate(changes, { onSuccess: () => toast(t('network:ddns.saved')), onError: fail });

  const data = state.data;
  return (
    <Screen
      title={t('network:ddns.title')}
      onRefresh={() => state.refetch()}
      top={data ? <ConnectionBanner error={state.error} onRetry={() => void state.refetch()} /> : null}>
      <FeatureGate feature="network.ddns" icon="globe">
        <AppText variant="footnote" tone="secondary" style={styles.note}>
          {t('network:ddns.intro')}
        </AppText>
        {data ? (
          <>
            <ListSection>
              {data.services.length ? (
                data.services.map((s) => (
                  <ListRow
                    key={s.section}
                    title={s.domain || s.section}
                    subtitle={[s.provider || t('network:ddns.custom'), statusLine(t, s)].filter(Boolean).join('\n')}
                    left={<StatusDot status={s.status.running ? 'online' : 'offline'} />}
                    switchValue={s.enabled}
                    onSwitch={(enabled) =>
                      commit(
                        ddnsChanges(
                          {
                            provider: s.provider,
                            updateUrl: s.updateUrl ?? '',
                            domain: s.domain,
                            username: s.username,
                            password: s.password,
                            ipv6: s.ipv6,
                            source: s.source,
                            enabled,
                          },
                          data.sections,
                          s,
                        ),
                      )
                    }
                    onPress={() => nav.push(editHref(s.section))}
                    testID={`ddns-${s.section}`}
                  />
                ))
              ) : (
                <ListRow title={t('network:ddns.empty')} disabled />
              )}
            </ListSection>
            <GlassButton
              label={t('network:ddns.add')}
              icon="plus"
              variant="primary"
              disabled={save.isPending}
              loading={save.isPending}
              onPress={() => nav.push(editHref())}
              testID="ddns-add"
            />
          </>
        ) : state.isError ? (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} />
        ) : (
          <View style={styles.loading}>
            {[0, 1].map((i) => (
              <Skeleton key={i} height={64} radius={14} />
            ))}
          </View>
        )}
      </FeatureGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  note: { paddingHorizontal: spacing.l },
});
