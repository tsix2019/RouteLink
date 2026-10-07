import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import RouteLinkNative from 'routelink-native';

import { routerSpeedHistory, type RouterSpeedResult } from '@/api/services/agent-diag';
import { AGENT_PAGE } from '@/features/agent/AgentGate';
import { demoSpeedFetch } from '@/features/diagnostics/demo';
import { RouterSpeedError, runRouterSpeedtest } from '@/features/diagnostics/router-speed';
import { compareSpeeds, runPhoneSpeedtest, serverOf, type SpeedResult } from '@/features/diagnostics/speed';
import { isValidServerUrl, readSpeedServer, saveSpeedServer, serverHost } from '@/features/diagnostics/speed-server';
import { SpeedFigures, SpeedMeter, speedRow, type LivePhase } from '@/features/diagnostics/SpeedViews';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { AGENT_KEY, useAgentStatus } from '@/hooks/agent-queries';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { useSpeedtests } from '@/state/speedtest';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { PromptSheet } from '@/ui/PromptSheet';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDayTime } from '@/utils/dates';

type Mode = 'phone' | 'router' | 'compare';
const MODES: Mode[] = ['phone', 'router', 'compare'];
const PAGE = 5;
const NO_HISTORY: SpeedResult[] = [];

interface Live {
  stage: 'phone' | 'router';
  phase: LivePhase;
  progress: number;
  bps?: number;
}

interface Outcome {
  mode: Mode;
  phone?: SpeedResult;
  router?: RouterSpeedResult;
  phoneError?: string;
  routerError?: string;
}

/** Speed test (design §18.4, DG-4): the phone, the router's plugin, or both compared. */
export default function SpeedTest() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const { colors } = useTheme();
  const { router, connection } = useActiveRouter();
  const routerId = router?.id ?? 'none';
  const demo = connection?.kind === 'demo';

  const status = useAgentStatus();
  const plugin = status.data?.state === 'ok';
  const routerTest = status.data?.state === 'ok' && status.data.info.capabilities.includes('speedtest');
  const server = useRouterQuery([AGENT_KEY, 'speedtest-server'], readSpeedServer, { enabled: plugin });
  const routerHistory = useRouterQuery([AGENT_KEY, 'speedtest-history'], routerSpeedHistory, {
    enabled: routerTest,
  });
  const phoneHistory = useSpeedtests((s) => s.history[routerId] ?? NO_HISTORY);
  const contract = useSpeedtests((s) => s.contract[routerId]);
  const addResult = useSpeedtests((s) => s.add);
  const setContract = useSpeedtests((s) => s.setContract);
  const network = useQuery({
    queryKey: ['phone-network'],
    queryFn: () => RouteLinkNative.getNetworkInfo(),
    staleTime: 0,
    enabled: !demo,
  });
  const saveServer = useRouterMutation(
    (conn, value: string) => saveSpeedServer(conn, value),
    [[AGENT_KEY, 'speedtest-server']],
  );

  const [mode, setMode] = useState<Mode>('phone');
  const [live, setLive] = useState<Live | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [editing, setEditing] = useState<'server' | 'down' | 'up' | null>(null);
  const [phonePages, setPhonePages] = useState(1);
  const [routerPages, setRouterPages] = useState(1);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const running = live !== null;
  const needsPlugin = mode !== 'phone' && !routerTest;

  const start = async () => {
    if (!connection || running || needsPlugin) return;
    const controller = new AbortController();
    abort.current = controller;
    const result: Outcome = { mode };
    let stage: 'phone' | 'router' = mode === 'router' ? 'router' : 'phone';
    setOutcome(result);
    try {
      if (mode !== 'router') {
        setLive({ stage: 'phone', phase: 'starting', progress: 0 });
        const phone = await runPhoneSpeedtest(
          {
            server: serverOf(server.data ?? ''),
            signal: controller.signal,
            onProgress: (phase, progress, bps) => setLive({ stage: 'phone', phase, progress, bps }),
          },
          // Demo mode never touches the internet.
          { fetch: demo ? demoSpeedFetch() : fetch, now: Date.now },
        );
        if (controller.signal.aborted) throw new RouterSpeedError('aborted');
        addResult(routerId, phone);
        result.phone = phone;
        if (phone.error) result.phoneError = phone.error;
        setOutcome({ ...result });
      }
      if (mode !== 'phone') {
        stage = 'router';
        setLive({ stage: 'router', phase: 'starting', progress: 0 });
        try {
          result.router = await runRouterSpeedtest(connection, {
            signal: controller.signal,
            onStart: ({ already }) => already && toast(t('diagnostics:speed.already'), 'info'),
            onProgress: (run) => setLive({ stage: 'router', phase: run.phase, progress: run.progress }),
          });
        } finally {
          void client.invalidateQueries({ queryKey: [routerId, AGENT_KEY, 'speedtest-history'] });
        }
        setOutcome({ ...result });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        toast(t('diagnostics:speed.stopped'), 'info');
      } else {
        const reason =
          error instanceof RouterSpeedError
            ? error.message !== error.code
              ? error.message
              : t(error.code === 'timeout' ? 'diagnostics:speed.error.timeout' : 'diagnostics:speed.error.failed')
            : describeError(t, error).title;
        if (stage === 'phone') result.phoneError = reason;
        else result.routerError = reason;
        setOutcome({ ...result });
        toast(t('diagnostics:speed.failed', { reason }), 'error');
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setLive(null);
    }
  };

  const contractBps = contract?.downMbps ? contract.downMbps * 1e6 : undefined;
  const verdict =
    outcome?.mode === 'compare' && !running
      ? outcome.phone?.downBps && outcome.router?.downBps
        ? compareSpeeds(outcome.phone.downBps, outcome.router.downBps, contractBps)
        : 'incomplete'
      : null;

  // Some keyboards type a decimal comma.
  const mbpsOf = (v: string) => Number(v.trim().replace(',', '.'));
  const numberPrompt = (dir: 'down' | 'up') => ({
    title: t(dir === 'down' ? 'diagnostics:speed.contract.promptDown' : 'diagnostics:speed.contract.promptUp'),
    initialValue: contract?.[dir === 'down' ? 'downMbps' : 'upMbps']?.toString() ?? '',
    validate: (v: string) =>
      !v.trim() || (Number.isFinite(mbpsOf(v)) && mbpsOf(v) > 0) ? undefined : t('diagnostics:speed.contract.invalid'),
    onSubmit: (v: string) => {
      const value = v.trim() ? mbpsOf(v) : undefined;
      const next = { ...contract, [dir === 'down' ? 'downMbps' : 'upMbps']: value };
      setContract(routerId, next.downMbps || next.upMbps ? next : null);
      setEditing(null);
    },
  });
  const prompt =
    editing === 'server'
      ? {
          title: t('diagnostics:speed.server.prompt'),
          initialValue: server.data ?? '',
          placeholder: 'https://speed.example.com/backend/',
          hint: t('diagnostics:speed.server.hint'),
          validate: (v: string) => (isValidServerUrl(v) ? undefined : t('diagnostics:speed.server.invalid')),
          onSubmit: (v: string) => {
            setEditing(null);
            saveServer.mutate(v.trim(), {
              onSuccess: () => toast(t('diagnostics:speed.server.saved')),
              onError: (error) =>
                toast(t('diagnostics:speed.server.saveFailed', { reason: describeError(t, error).title }), 'error'),
            });
          },
        }
      : editing
        ? numberPrompt(editing)
        : null;

  return (
    <Screen
      title={t('diagnostics:speed.title')}
      onRefresh={() => Promise.all([status.refetch(), routerTest ? routerHistory.refetch() : undefined])}>
      <Segmented
        values={MODES.map((m) => t(`diagnostics:speed.mode.${m}`))}
        selectedIndex={MODES.indexOf(mode)}
        enabled={!running}
        onChange={(e) => {
          setMode(MODES[e.nativeEvent.selectedSegmentIndex]);
          setOutcome(null);
        }}
      />
      <AppText variant="footnote" tone="secondary" style={styles.note}>
        {t(`diagnostics:speed.modeHint.${mode}`)}
      </AppText>
      {demo && mode !== 'router' ? <Banner tone="info" text={t('diagnostics:speed.demoNote')} /> : null}
      {!demo && mode !== 'router' && network.data && !network.data.isWifi ? (
        <Banner tone="warning" text={t('diagnostics:speed.notWifi')} />
      ) : null}
      {needsPlugin && status.data ? (
        <Banner
          tone="info"
          text={t('diagnostics:speed.needsPlugin')}
          action={{
            label: t('agent:gate.notInstalled.action'),
            onPress: () => nav.push(AGENT_PAGE, { withAnchor: true }),
          }}
        />
      ) : null}

      <GlassCard contentStyle={styles.card} testID="speed-card">
        {live ? (
          <SpeedMeter
            stage={live.stage}
            phase={live.phase}
            progress={live.progress}
            bps={live.bps}
            showStage={mode === 'compare'}
          />
        ) : null}
        {outcome?.phone && (!live || live.stage === 'router') ? (
          <Side
            label={mode === 'compare' || outcome.mode === 'compare' ? t('diagnostics:speed.stage.phone') : undefined}>
            <SpeedFigures result={outcome.phone} contract={contract} testID="speed-phone-result" />
          </Side>
        ) : null}
        {outcome?.router && !live ? (
          <Side label={outcome.mode === 'compare' ? t('diagnostics:speed.stage.router') : undefined}>
            <SpeedFigures result={outcome.router} contract={contract} testID="speed-router-result" />
          </Side>
        ) : null}
        {!live && (outcome?.phoneError || outcome?.routerError) ? (
          <AppText variant="footnote" tone="danger">
            {t('diagnostics:speed.failed', { reason: outcome.phoneError ?? outcome.routerError })}
          </AppText>
        ) : null}
        {running ? (
          <GlassButton
            label={t('diagnostics:speed.stop')}
            icon="stop"
            variant="glass"
            onPress={() => abort.current?.abort()}
            testID="speed-stop"
          />
        ) : (
          <GlassButton
            label={outcome ? t('diagnostics:speed.again') : t('diagnostics:speed.start')}
            icon="speed"
            disabled={!connection || needsPlugin}
            onPress={() => void start()}
            testID="speed-start"
          />
        )}
      </GlassCard>

      {verdict ? (
        <GlassCard title={t('diagnostics:speed.compare.title')} icon="speed" testID="speed-verdict">
          <AppText variant="body">
            {verdict === 'wifi-bottleneck'
              ? t('diagnostics:speed.compare.wifi-bottleneck', {
                  pct: Math.round((outcome!.phone!.downBps! / outcome!.router!.downBps!) * 100),
                })
              : t(`diagnostics:speed.compare.${verdict}`)}
          </AppText>
          {verdict !== 'incomplete' && !contractBps ? (
            <AppText variant="footnote" tone="secondary">
              {t('diagnostics:speed.compare.noContract')}
            </AppText>
          ) : null}
          {verdict === 'wifi-bottleneck' ? (
            <View style={styles.links}>
              <GlassButton
                label={t('diagnostics:speed.compare.signal')}
                icon="wifi"
                variant="glass"
                compact
                onPress={() => nav.push('/wireless/tools/signal', { withAnchor: true })}
              />
              <GlassButton
                label={t('diagnostics:speed.compare.channels')}
                icon="antenna"
                variant="glass"
                compact
                onPress={() => nav.push('/wireless/tools/channels', { withAnchor: true })}
              />
            </View>
          ) : null}
        </GlassCard>
      ) : null}

      {mode !== 'phone' ? (
        <AppText variant="footnote" tone="tertiary" style={styles.note}>
          {t('diagnostics:speed.wanNote')}
        </AppText>
      ) : null}

      <ListSection
        title={t('diagnostics:speed.server.title')}
        footer={plugin ? t('diagnostics:speed.server.footerPlugin') : t('diagnostics:speed.server.footerNoPlugin')}>
        <ListRow
          title={t('diagnostics:speed.server.title')}
          icon="server"
          value={server.data ? serverHost(server.data) : t('diagnostics:speed.server.cloudflare')}
          chevron={plugin}
          onPress={plugin && !running ? () => setEditing('server') : undefined}
          testID="speed-server"
        />
      </ListSection>

      <ListSection title={t('diagnostics:speed.contract.title')} footer={t('diagnostics:speed.contract.footer')}>
        {(['down', 'up'] as const).map((dir) => {
          const v = contract?.[dir === 'down' ? 'downMbps' : 'upMbps'];
          return (
            <ListRow
              key={dir}
              title={t(`diagnostics:speed.contract.${dir}`)}
              icon={dir}
              iconColor={dir === 'down' ? colors.chartDown : colors.chartUp}
              value={v ? t('diagnostics:speed.contract.value', { value: v }) : t('diagnostics:speed.contract.unset')}
              chevron
              onPress={() => setEditing(dir)}
              testID={`speed-contract-${dir}`}
            />
          );
        })}
      </ListSection>

      <ListSection title={t('diagnostics:speed.history.phone')}>
        {phoneHistory.length ? (
          [
            ...phoneHistory
              .slice(0, PAGE * phonePages)
              .map((r, i) => (
                <ListRow
                  key={`${r.ts}-${i}`}
                  title={
                    r.error && r.downBps === null
                      ? t('diagnostics:speed.history.error', { error: r.error })
                      : speedRow(t, r)
                  }
                  subtitle={formatDayTime(r.ts, lang)}
                  value={
                    r.latencyMs === null ? undefined : t('diagnostics:speed.ms', { value: Math.round(r.latencyMs) })
                  }
                />
              )),
            ...(phoneHistory.length > PAGE * phonePages
              ? [
                  <ListRow
                    key="more"
                    title={t('diagnostics:speed.history.more')}
                    icon="chevronDown"
                    onPress={() => setPhonePages((p) => p + 1)}
                  />,
                ]
              : []),
          ]
        ) : (
          <ListRow title={t('diagnostics:speed.history.empty')} icon="info" iconColor={colors.textTertiary} />
        )}
      </ListSection>

      {routerTest ? (
        <ListSection title={t('diagnostics:speed.history.router')}>
          {routerHistory.data?.results.length ? (
            [
              ...routerHistory.data.results
                .slice(0, PAGE * routerPages)
                .map((r) => (
                  <ListRow
                    key={r.id}
                    title={
                      r.error && r.downBps === null
                        ? t('diagnostics:speed.history.error', { error: r.error })
                        : speedRow(t, r)
                    }
                    subtitle={formatDayTime(r.ts, lang)}
                    value={
                      r.latencyMs === null ? undefined : t('diagnostics:speed.ms', { value: Math.round(r.latencyMs) })
                    }
                  />
                )),
              ...(routerHistory.data.results.length > PAGE * routerPages
                ? [
                    <ListRow
                      key="more"
                      title={t('diagnostics:speed.history.more')}
                      icon="chevronDown"
                      onPress={() => setRouterPages((p) => p + 1)}
                    />,
                  ]
                : []),
            ]
          ) : (
            <ListRow title={t('diagnostics:speed.history.empty')} icon="info" iconColor={colors.textTertiary} />
          )}
        </ListSection>
      ) : null}

      <PromptSheet
        visible={!!prompt}
        title={prompt?.title ?? ''}
        initialValue={prompt?.initialValue}
        placeholder={prompt && 'placeholder' in prompt ? prompt.placeholder : undefined}
        hint={prompt && 'hint' in prompt ? prompt.hint : t('diagnostics:speed.contract.hint')}
        confirmLabel={t('save')}
        validate={prompt?.validate}
        onSubmit={(v) => prompt?.onSubmit(v)}
        onCancel={() => setEditing(null)}
        inputProps={
          editing === 'server'
            ? { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'url' }
            : { keyboardType: 'decimal-pad' }
        }
      />
    </Screen>
  );
}

function Side({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={styles.side}>
      {label ? (
        <AppText variant="footnote" weight="600" tone="secondary">
          {label}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { marginHorizontal: spacing.l },
  card: { gap: spacing.l },
  side: { gap: spacing.s },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
});
