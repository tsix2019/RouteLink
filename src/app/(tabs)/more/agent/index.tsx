import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { agentCommit, agentReset, type AgentInfo, type AgentStatus } from '@/api/services/agent';
import { detectPackageEnv, removePackages } from '@/api/services/packages';
import { AgentBanner } from '@/features/agent/AgentBanner';
import { useRestartAgent } from '@/features/agent/AgentGate';
import { useInstallSession } from '@/features/agent/installSession';
import { INSTALL_ORDER, MANIFEST_URL, applyMirror, parseManifest } from '@/features/agent/manifest';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useAgentStatus } from '@/hooks/agent-queries';
import { useRouterMutation } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { InfoGrid } from '@/ui/InfoGrid';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatBytes } from '@/utils/format';
import { formatDayTime } from '@/utils/dates';

/** README section with manual installation (download, or add the signed feed). */
export const MANUAL_URL = {
  'zh-CN': 'https://github.com/tsix2019/RouteLink/blob/main/README.md#路由器插件',
  en: 'https://github.com/tsix2019/RouteLink/blob/main/README.en.md#router-plugin',
} as const;

type Dialog = null | 'install' | 'uninstall' | 'clear';
type Update =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'latest'; version: string }
  | { state: 'newer'; version: string }
  | { state: 'failed'; reason: string };

const newer = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

/** More → Router plugin (design AG-8): status, install, upgrade, restart, flush, clear, remove. */
export default function AgentPage() {
  const t = useT();
  const status = useAgentStatus();
  return (
    <Screen title={t('agent:title')} onRefresh={() => status.refetch()}>
      {status.data ? (
        <AgentContent status={status.data} />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <View style={styles.loading}>
          <Skeleton height={140} radius={16} />
          <Skeleton height={200} radius={16} />
        </View>
      )}
    </Screen>
  );
}

function AgentContent({ status }: { status: AgentStatus }) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const { router, connection } = useActiveRouter();
  const mirror = useSettings((s) => s.agentMirror);
  const setSettings = useSettings((s) => s.set);
  const startInstall = useInstallSession((s) => s.start);
  const { restart } = useRestartAgent();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [update, setUpdate] = useState<Update>({ state: 'idle' });
  const [mirrorDraft, setMirrorDraft] = useState(mirror);
  const info: AgentInfo | null = 'info' in status ? status.info : null;
  const installed = status.state !== 'not-installed';
  const invalidate = () => client.invalidateQueries({ queryKey: [router?.id ?? 'none'] });
  const routerName = router ? (router.isDemo ? t('demoRouter') : router.name) : '';

  const commit = useRouterMutation((conn) => agentCommit(conn), [['agent']]);
  const clear = useRouterMutation((conn) => agentReset(conn, 'traffic'), [['agent']]);
  const remove = useRouterMutation(
    async (conn, withData: boolean) => {
      if (withData) await agentReset(conn, 'all').catch(() => undefined);
      const env = await detectPackageEnv(conn);
      if ('unsupported' in env) throw new Error(env.unsupported);
      const result = await removePackages(conn, env, [...INSTALL_ORDER].reverse());
      if (!result.ok) throw new Error(result.output || 'remove failed');
    },
    [['agent'], ['capabilities']],
  );

  const checkUpdate = async () => {
    setUpdate({ state: 'checking' });
    try {
      const { networkInstallDeps } = await import('@/features/agent/download');
      const manifest = parseManifest(
        connection?.kind === 'demo'
          ? { version: info?.version ?? '0.1.0', api: 1, targets: {} }
          : await networkInstallDeps.fetchManifest(applyMirror(MANIFEST_URL, mirror)),
      );
      setUpdate(
        info && newer(manifest.version, info.version)
          ? { state: 'newer', version: manifest.version }
          : { state: 'latest', version: info?.version ?? manifest.version },
      );
    } catch (error) {
      setUpdate({ state: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  };

  const install = () => {
    setDialog(null);
    if (!connection) return;
    void startInstall(connection, mirror).then(invalidate);
    nav.push('/more/agent/install');
  };

  const fmt = (sec: number) => formatDayTime(sec, lang);

  return (
    <>
      {info ? <AgentBanner info={info} /> : null}

      <GlassCard contentStyle={styles.card}>
        <AppText variant="subhead" tone="secondary">
          {t('agent:page.about')}
        </AppText>
        {!installed ? (
          <>
            <AppText variant="footnote" tone="tertiary">
              {t('agent:page.requirements', { size: '1 MB' })}
            </AppText>
            <GlassButton
              label={t('agent:page.install')}
              icon="download"
              variant="primary"
              onPress={() => setDialog('install')}
              testID="agent-install"
            />
          </>
        ) : null}
      </GlassCard>

      {info ? (
        <GlassCard title={t('agent:page.status')} icon="plugin">
          <InfoGrid
            items={[
              { label: t('agent:page.version'), value: info.version },
              {
                label: t('agent:page.role'),
                value: info.roles.includes('gateway') ? t('agent:page.roleGateway') : t('agent:page.roleOther'),
              },
              { label: t('agent:page.offload'), value: t(`agent:page.offloadNames.${info.offload}`) },
              {
                label: t('agent:page.clock'),
                value: info.timeSynced ? t('agent:page.synced') : t('agent:page.notSynced'),
              },
              {
                label: t('agent:page.storage'),
                value: `${formatBytes(info.storage.usedBytes)} / ${formatBytes(info.storage.limitBytes)}`,
              },
              {
                label: t('agent:page.lastCommit'),
                value: info.lastCommit ? fmt(info.lastCommit) : t('agent:page.never'),
              },
            ]}
          />
        </GlassCard>
      ) : null}

      {installed ? (
        <ListSection title={t('agent:page.actions')}>
          {update.state === 'newer' ? (
            <ListRow
              icon="download"
              title={t('agent:page.upgrade', { version: update.version })}
              chevron
              onPress={() => setDialog('install')}
            />
          ) : (
            <ListRow
              icon="refresh"
              title={t('agent:page.checkUpdate')}
              subtitle={
                update.state === 'checking'
                  ? t('agent:page.checking')
                  : update.state === 'latest'
                    ? t('agent:page.upToDate', { version: update.version })
                    : update.state === 'failed'
                      ? t('agent:page.updateFailed', { reason: update.reason })
                      : undefined
              }
              disabled={update.state === 'checking'}
              onPress={() => void checkUpdate()}
            />
          )}
          {status.state === 'too-old' ? (
            <ListRow
              icon="download"
              title={t('agent:gate.tooOld.action')}
              chevron
              onPress={() => setDialog('install')}
            />
          ) : null}
          <ListRow icon="power" title={t('agent:page.restart')} onPress={restart} testID="agent-restart" />
          {info ? (
            <ListRow
              icon="storage"
              title={t('agent:page.commit')}
              onPress={() =>
                commit.mutate(undefined, {
                  onSuccess: () => toast(t('agent:page.committed')),
                  onError: (error) => toast(describeError(t, error).title, 'error'),
                })
              }
            />
          ) : null}
          {info ? <ListRow icon="trash" title={t('agent:page.clear')} onPress={() => setDialog('clear')} /> : null}
          {connection?.kind === 'live' && router ? (
            <ListRow
              icon="globe"
              title={t('agent:page.openLuci')}
              chevron
              onPress={() =>
                void WebBrowser.openBrowserAsync(`${router.baseUrl}/cgi-bin/luci/admin/services/routelink`)
              }
            />
          ) : null}
          <ListRow
            icon="trash"
            title={t('agent:page.uninstall')}
            destructive
            disabled={remove.isPending}
            onPress={() => setDialog('uninstall')}
            testID="agent-uninstall"
          />
        </ListSection>
      ) : null}

      <ListSection footer={t('agent:page.mirrorHint')}>
        <View style={styles.mirror}>
          <TextField
            label={t('agent:page.mirror')}
            value={mirrorDraft}
            onChangeText={setMirrorDraft}
            onEndEditing={() => setSettings({ agentMirror: mirrorDraft.trim() })}
            placeholder="https://ghproxy.example/"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>
        <ListRow
          icon="link"
          title={t('agent:page.manual')}
          chevron
          onPress={() => void WebBrowser.openBrowserAsync(MANUAL_URL[lang])}
        />
      </ListSection>

      <RiskConfirm
        visible={dialog === 'install'}
        level="medium"
        title={t('agent:install.title', { name: routerName })}
        consequences={[
          t('agent:install.consequences.packages'),
          t('agent:install.consequences.dependencies'),
          t('agent:install.consequences.rpcd'),
        ]}
        confirmLabel={t('agent:install.confirm')}
        onCancel={() => setDialog(null)}
        onConfirm={install}
      />
      <RiskConfirm
        visible={dialog === 'clear'}
        level="medium"
        disruptive
        title={t('agent:clear.title')}
        consequences={[t('agent:clear.consequences.deleted'), t('agent:clear.consequences.permanent')]}
        confirmLabel={t('agent:clear.confirm')}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          clear.mutate(undefined, { onError: (error) => toast(describeError(t, error).title, 'error') });
        }}
      />
      <RiskConfirm
        visible={dialog === 'uninstall'}
        level="medium"
        disruptive
        title={t('agent:uninstall.title', { name: routerName })}
        consequences={[t('agent:uninstall.consequences.packages'), t('agent:uninstall.consequences.luci')]}
        confirmLabel={t('agent:uninstall.confirm')}
        option={{ label: t('agent:uninstall.deleteData'), value: deleteData, onChange: setDeleteData }}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          remove.mutate(deleteData, {
            onSuccess: () => {
              toast(t('agent:uninstall.done'));
              void invalidate();
            },
            onError: (error) => toast(t('agent:uninstall.failed', { reason: describeError(t, error).title }), 'error'),
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.m },
  card: { gap: spacing.m },
  mirror: { padding: spacing.m },
});
