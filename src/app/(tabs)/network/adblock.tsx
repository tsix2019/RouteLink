import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RouterConnection } from '@/api/connection/types';
import {
  adblockAction,
  enableAdblock,
  getAdblock,
  pickDefaultSource,
  saveSources,
  type AdblockState,
} from '@/api/services/adblock';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { StatusDot } from '@/ui/Status';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes } from '@/utils/format';

type Pending = { title: string; run(conn: RouterConnection): Promise<void>; done: string };

/** NW-11: DNS ad blocking — adblock-fast (preferred) or adblock: on/off, state, lists. */
export default function Adblock() {
  const t = useT();
  const toast = useToast();
  const query = useRouterQuery(['adblock'], getAdblock, { refetchInterval: 5_000 });
  const data = query.data;
  const state = data && data.package ? data : null;
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useRouterMutation((conn, p: Pending) => p.run(conn), [['adblock']]);
  const dirty = !!state && state.sources.some((s) => s.id in toggles && toggles[s.id] !== s.enabled);

  const switchTo = (s: AdblockState, on: boolean) => {
    const fallback = on ? pickDefaultSource(s) : null;
    setPending({
      title: on ? t('network:adblock.confirmOn') : t('network:adblock.confirmOff'),
      run: (conn) => (on ? enableAdblock(conn, s) : adblockAction(conn, s.package, 'off')),
      done: fallback ? t('network:adblock.defaultSource', { name: fallback.name }) : t('network:adblock.applied'),
    });
  };

  return (
    <>
      <Screen
        title={t('network:adblock.title')}
        onRefresh={() => query.refetch()}
        top={data ? <ConnectionBanner error={query.error} onRetry={() => void query.refetch()} /> : null}>
        <FeatureGate feature="network.adblock" icon="adblock">
          {state ? (
            <>
              <StatusCard state={state} />
              <ListSection footer={state.both ? t('network:adblock.both', { name: state.package }) : undefined}>
                <ListRow
                  title={t('network:adblock.enabled')}
                  subtitle={t('network:adblock.using', { name: state.package })}
                  switchValue={state.enabled}
                  onSwitch={(on) => switchTo(state, on)}
                  disabled={run.isPending}
                  testID="adblock-enabled"
                />
              </ListSection>
              {state.enabled ? (
                <GlassButton
                  label={t('network:adblock.refresh')}
                  icon="refresh"
                  disabled={run.isPending || state.status === 'working'}
                  onPress={() =>
                    run.mutate(
                      {
                        title: '',
                        run: (conn) => adblockAction(conn, state.package, 'refresh'),
                        done: t('network:adblock.applied'),
                      },
                      { onError: (e) => toast(describeError(t, e).title, 'error') },
                    )
                  }
                />
              ) : null}
              <ListSection title={t('network:adblock.sources')} footer={t('network:adblock.sourcesHint')}>
                {state.sources.map((s) => (
                  <ListRow
                    key={s.id}
                    title={s.name}
                    subtitle={[
                      s.description,
                      s.size ? formatBytes(s.size) : null,
                      s.action === 'allow' ? 'allow' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    switchValue={toggles[s.id] ?? s.enabled}
                    onSwitch={(on) => setToggles((v) => ({ ...v, [s.id]: on }))}
                  />
                ))}
              </ListSection>
              {dirty ? (
                <>
                  <AppText variant="footnote" tone="secondary" align="center">
                    {t('network:adblock.unsaved')}
                  </AppText>
                  <GlassButton
                    label={t('network:adblock.saveSources')}
                    variant="primary"
                    disabled={run.isPending}
                    loading={run.isPending}
                    onPress={() =>
                      run.mutate(
                        {
                          title: '',
                          run: (conn) => saveSources(conn, state, toggles),
                          done: t('network:adblock.applied'),
                        },
                        {
                          onSuccess: () => {
                            setToggles({});
                            toast(t('network:adblock.applied'));
                          },
                          onError: (e) => toast(describeError(t, e).title, 'error'),
                        },
                      )
                    }
                    testID="adblock-save"
                  />
                </>
              ) : null}
            </>
          ) : data ? (
            <EmptyState icon="adblock" title={t('feature.unavailable')} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
        </FeatureGate>
      </Screen>
      <RiskConfirm
        visible={!!pending}
        level="medium"
        disruptive
        title={pending?.title ?? ''}
        consequences={[t('network:adblock.consequence')]}
        confirmLabel={t('common:confirm')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) {
            run.mutate(p, {
              onSuccess: () => toast(p.done),
              onError: (e) => toast(describeError(t, e).title, 'error'),
            });
          }
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function StatusCard({ state }: { state: AdblockState }) {
  const t = useT();
  const lang = useLang();
  const dot =
    state.status === 'running'
      ? 'online'
      : state.status === 'error' || state.status === 'working' || state.status === 'paused'
        ? 'warning'
        : 'offline';
  return (
    <GlassCard contentStyle={styles.card}>
      <View style={styles.row}>
        <StatusDot status={dot} />
        <AppText variant="headline" style={styles.flex}>
          {t(`network:adblock.status.${state.status}`)}
        </AppText>
        {state.version ? (
          <AppText variant="footnote" tone="tertiary">
            {t('network:adblock.version', { version: state.version })}
          </AppText>
        ) : null}
      </View>
      {state.blocked ? (
        <AppText variant="title">{t('network:adblock.blocked', { n: state.blocked.toLocaleString(lang) })}</AppText>
      ) : null}
      {state.lastRun ? (
        <AppText variant="footnote" tone="secondary">
          {t('network:adblock.lastRun', { time: state.lastRun })}
        </AppText>
      ) : null}
      {state.message ? (
        <AppText variant="footnote" tone={state.status === 'error' ? 'danger' : 'secondary'}>
          {t('network:adblock.message', {
            code: [state.message.code, state.message.info].filter(Boolean).join(' '),
          })}
        </AppText>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  card: { gap: spacing.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  flex: { flex: 1 },
});
