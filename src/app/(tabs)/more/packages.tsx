import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  installPackages,
  listAvailable,
  listInstalled,
  removalCutsOffApp,
  searchPackages,
  type PackageInfo,
} from '@/api/services/package-list';
import { detectPackageEnv, removePackages, updateLists, type PackageEnv } from '@/api/services/packages';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Badge } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes } from '@/utils/format';

type Tab = 'installed' | 'available';
const MAX_ROWS = 200;

/** MO-5: installed and available packages through LuCI's own package helper. */
export default function Packages() {
  const t = useT();
  const toast = useToast();
  const env = useRouterQuery(['packages', 'env'], detectPackageEnv, { staleTime: 60_000 });
  const ready = env.data && !('unsupported' in env.data) ? env.data : undefined;
  const installed = useRouterQuery(['packages', 'installed'], (conn) => listInstalled(conn, ready!), {
    enabled: !!ready,
  });
  const available = useRouterQuery(['packages', 'available'], (conn) => listAvailable(conn, ready!), {
    enabled: !!ready,
    staleTime: 10 * 60_000,
  });
  const [tab, setTab] = useState<Tab>('installed');
  const [query, setQuery] = useState('');
  const [userOnly, setUserOnly] = useState(false);
  const [selected, setSelected] = useState<PackageInfo | null>(null);
  const [pending, setPending] = useState<{ kind: 'install' | 'remove'; pkg: PackageInfo } | null>(null);

  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');
  const refresh = [['packages']] as const;
  const update = useRouterMutation((conn, e: PackageEnv) => updateLists(conn, e), refresh);
  const install = useRouterMutation(
    (conn, a: { env: PackageEnv; name: string }) => installPackages(conn, a.env, [a.name]),
    refresh,
  );
  const remove = useRouterMutation(
    (conn, a: { env: PackageEnv; name: string }) => removePackages(conn, a.env, [a.name]),
    refresh,
  );
  const busy = update.isPending || install.isPending || remove.isPending;

  const installedNames = new Set((installed.data ?? []).map((p) => p.name));
  const q = query.trim();
  const shown =
    tab === 'installed'
      ? searchPackages(installed.data ?? [], q, Infinity).filter((p) => !userOnly || p.auto === false)
      : q.length >= 2
        ? searchPackages(available.data ?? [], q, MAX_ROWS)
        : [];
  const listQuery = tab === 'installed' ? installed : available;

  const run = (kind: 'install' | 'remove', pkg: PackageInfo) => {
    if (!ready) return;
    const done = (r: { ok: boolean; output: string }) =>
      r.ok
        ? toast(
            t(kind === 'install' ? 'more:packagesScreen.installed_ok' : 'more:packagesScreen.removed_ok', {
              name: pkg.name,
            }),
          )
        : toast(`${t('more:packagesScreen.failed')}: ${r.output.split('\n').pop() ?? ''}`, 'error');
    (kind === 'install' ? install : remove).mutate({ env: ready, name: pkg.name }, { onSuccess: done, onError: fail });
  };

  const unsupported = env.data && 'unsupported' in env.data ? env.data.unsupported : null;
  const cutsOff = pending?.kind === 'remove' ? removalCutsOffApp([pending.pkg.name]) : [];

  return (
    <>
      <Screen
        title={t('more:packages')}
        onRefresh={() => Promise.all([env.refetch(), installed.refetch()])}
        top={ready ? <ConnectionBanner error={listQuery.error} onRetry={() => void listQuery.refetch()} /> : null}>
        {unsupported ? (
          <EmptyState icon="package" title={t(`more:packagesScreen.unsupported.${unsupported}`)} />
        ) : env.isError ? (
          <ErrorState error={env.error} onRetry={() => void env.refetch()} />
        ) : !ready ? (
          <View style={styles.loading}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={52} radius={14} />
            ))}
          </View>
        ) : (
          <>
            <Segmented
              values={[t('more:packagesScreen.installed'), t('more:packagesScreen.available')]}
              selectedIndex={tab === 'installed' ? 0 : 1}
              onChange={(e) => setTab(e.nativeEvent.selectedSegmentIndex === 0 ? 'installed' : 'available')}
            />
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder={t('more:packagesScreen.search')}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {tab === 'installed' && ready.manager === 'opkg' ? (
              <ListSection>
                <ListRow title={t('more:packagesScreen.userOnly')} switchValue={userOnly} onSwitch={setUserOnly} />
              </ListSection>
            ) : null}
            {tab === 'available' && (!ready.hasLists || !available.data?.length) ? (
              <ListSection footer={t('more:packagesScreen.noLists')}>
                <ListRow
                  title={update.isPending ? t('more:packagesScreen.updating') : t('more:packagesScreen.update')}
                  icon="refresh"
                  disabled={busy}
                  onPress={() =>
                    update.mutate(ready, {
                      onSuccess: () => toast(t('more:packagesScreen.updated')),
                      onError: fail,
                    })
                  }
                  testID="packages-update"
                />
              </ListSection>
            ) : null}
            {listQuery.data ? (
              tab === 'available' && q.length < 2 ? (
                <AppText variant="footnote" tone="secondary" style={styles.note}>
                  {`${t('more:packagesScreen.typeToSearch')} · ${t('more:packagesScreen.count', { count: listQuery.data.length })}`}
                </AppText>
              ) : shown.length ? (
                <ListSection
                  footer={tab === 'installed' ? t('more:packagesScreen.count', { count: shown.length }) : undefined}>
                  {shown.map((p) => (
                    <ListRow
                      key={p.name}
                      title={p.name}
                      subtitle={[p.version, p.size ? formatBytes(p.size) : null, p.description]
                        .filter(Boolean)
                        .join(' · ')}
                      right={
                        tab === 'installed' && p.auto ? (
                          <Badge label={t('more:packagesScreen.dependency')} />
                        ) : tab === 'available' && installedNames.has(p.name) ? (
                          <Badge label={t('more:packagesScreen.installed')} tone="success" />
                        ) : undefined
                      }
                      chevron
                      onPress={() => setSelected(p)}
                      testID={`package-${p.name}`}
                    />
                  ))}
                </ListSection>
              ) : (
                <EmptyState icon="package" title={t('more:packagesScreen.empty')} />
              )
            ) : listQuery.isError ? (
              <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
            ) : (
              <View style={styles.loading}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} height={52} radius={14} />
                ))}
              </View>
            )}
            {tab === 'available' && available.data?.length ? (
              <GlassButton
                label={t('more:packagesScreen.update')}
                icon="refresh"
                disabled={busy}
                onPress={() =>
                  update.mutate(ready, { onSuccess: () => toast(t('more:packagesScreen.updated')), onError: fail })
                }
              />
            ) : null}
          </>
        )}
      </Screen>

      <ActionSheet
        visible={!!selected}
        title={selected?.name}
        message={selected?.description}
        actions={
          selected
            ? installedNames.has(selected.name)
              ? [
                  {
                    label: t('more:packagesScreen.remove'),
                    icon: 'trash' as const,
                    destructive: true,
                    onPress: () => {
                      setPending({ kind: 'remove', pkg: selected });
                      setSelected(null);
                    },
                  },
                ]
              : [
                  {
                    label: t('more:packagesScreen.install'),
                    icon: 'download' as const,
                    onPress: () => {
                      setPending({ kind: 'install', pkg: selected });
                      setSelected(null);
                    },
                  },
                ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      <RiskConfirm
        visible={!!pending}
        level={cutsOff.length ? 'high' : 'medium'}
        title={
          pending
            ? t(pending.kind === 'install' ? 'more:packagesScreen.installTitle' : 'more:packagesScreen.removeTitle', {
                name: pending.pkg.name,
              })
            : ''
        }
        consequences={
          pending?.kind === 'install'
            ? [t('more:packagesScreen.installConsequence')]
            : [
                t('more:packagesScreen.removeConsequence'),
                ...(cutsOff.length ? [t('more:packagesScreen.cutsOff', { names: cutsOff.join(', ') })] : []),
              ]
        }
        confirmLabel={pending?.kind === 'install' ? t('more:packagesScreen.install') : t('more:packagesScreen.remove')}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) run(p.kind, p.pkg);
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
