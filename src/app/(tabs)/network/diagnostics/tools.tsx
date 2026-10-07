import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { runTool, type ToolResult } from '@/api/services/diag';
import { isValidTarget, PING_COUNTS, type Tool } from '@/features/diagnostics/tools';
import { round1 } from '@/features/diagnostics/present';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useT } from '@/i18n';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { Icon } from '@/ui/Icon';
import { InfoGrid } from '@/ui/InfoGrid';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const TOOLS: Tool[] = ['ping', 'traceroute', 'nslookup'];
const FAMILIES = ['ipv4', 'ipv6'] as const;
const DNS_ERRORS = ['NXDOMAIN', 'SERVFAIL', 'REFUSED', 'TIMEOUT', 'NO_ANSWER'] as const;

type Outcome = { result: ToolResult; router: string } | { error: unknown };

/** Diagnostic tools (design §18.2, DG-2): ping, traceroute and nslookup on the gateway or any AP. */
export default function DiagnosticTools() {
  const t = useT();
  const params = useLocalSearchParams<{ tool?: string; target?: string }>();
  const { router, connection, group } = useActiveRouter();
  const [tool, setTool] = useState<Tool>(TOOLS.find((x) => x === params.tool) ?? 'ping');
  const [target, setTarget] = useState(params.target ?? '');
  const [server, setServer] = useState('');
  const [count, setCount] = useState<number>(PING_COUNTS[0]);
  const [family, setFamily] = useState<(typeof FAMILIES)[number]>('ipv4');
  const [routerId, setRouterId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const routers = [
    ...(router
      ? [
          {
            id: router.id,
            name: router.isDemo ? t('demoRouter') : router.name,
            detail: group.gateway ? t('diagnostics:tools.gateway') : undefined,
            connection,
          },
        ]
      : []),
    ...group.members.map((m) => ({
      id: m.id,
      name: m.name,
      detail: m.connection ? t('diagnostics:tools.ap') : t('diagnostics:tools.needsPassword'),
      connection: m.connection,
    })),
  ];
  const selected = routers.find((r) => r.id === routerId && r.connection) ?? routers[0];

  const targetError = checked && !isValidTarget(target) ? t('diagnostics:tools.targetInvalid') : undefined;
  const serverError =
    checked && tool === 'nslookup' && server.trim() && !isValidTarget(server)
      ? t('diagnostics:tools.targetInvalid')
      : undefined;

  const run = async () => {
    setChecked(true);
    const conn = selected?.connection;
    if (!conn || running || !isValidTarget(target)) return;
    if (tool === 'nslookup' && server.trim() && !isValidTarget(server)) return;
    setRunning(true);
    try {
      const result = await runTool(conn, tool, target.trim(), {
        count,
        ipv6: tool !== 'nslookup' && family === 'ipv6',
        server: tool === 'nslookup' ? server.trim() || undefined : undefined,
      });
      setOutcome({ result, router: selected.name });
    } catch (error) {
      setOutcome({ error });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Screen title={t('diagnostics:tools.title')}>
      <Segmented
        values={TOOLS.map((x) => t(`diagnostics:tools.tool.${x}`))}
        selectedIndex={TOOLS.indexOf(tool)}
        onChange={(e) => setTool(TOOLS[e.nativeEvent.selectedSegmentIndex])}
      />
      <GlassCard contentStyle={styles.form}>
        <TextField
          label={t('diagnostics:tools.target')}
          value={target}
          onChangeText={setTarget}
          placeholder={t('diagnostics:tools.targetPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void run()}
          error={targetError}
          testID="tools-target"
        />
        {tool === 'nslookup' ? (
          <TextField
            label={t('diagnostics:tools.server')}
            value={server}
            onChangeText={setServer}
            placeholder={t('diagnostics:tools.serverPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={serverError}
          />
        ) : (
          <View style={styles.options}>
            {tool === 'ping' ? (
              <Option label={t('diagnostics:tools.count')}>
                <Segmented
                  values={PING_COUNTS.map((n) => t('diagnostics:tools.countValue', { n }))}
                  selectedIndex={Math.max(0, PING_COUNTS.indexOf(count as (typeof PING_COUNTS)[number]))}
                  onChange={(e) => setCount(PING_COUNTS[e.nativeEvent.selectedSegmentIndex])}
                />
              </Option>
            ) : null}
            <Option label={t('diagnostics:tools.family')}>
              <Segmented
                values={FAMILIES.map((f) => t(`diagnostics:tools.${f}`))}
                selectedIndex={FAMILIES.indexOf(family)}
                onChange={(e) => setFamily(FAMILIES[e.nativeEvent.selectedSegmentIndex])}
              />
            </Option>
          </View>
        )}
        <GlassButton
          label={running ? t('diagnostics:tools.running') : t('diagnostics:tools.run')}
          icon="terminal"
          loading={running}
          disabled={running || !selected?.connection}
          onPress={() => void run()}
          testID="tools-run"
        />
      </GlassCard>

      {routers.length > 1 ? (
        <ListSection>
          <ListRow
            title={t('diagnostics:tools.router')}
            icon="router"
            value={selected?.name}
            chevron
            onPress={() => setPicking(true)}
            testID="tools-router"
          />
        </ListSection>
      ) : null}

      {outcome ? (
        'error' in outcome ? (
          <Banner
            tone="error"
            text={t('diagnostics:tools.failed', { reason: describeError(t, outcome.error).title })}
          />
        ) : (
          <Result result={outcome.result} router={outcome.router} />
        )
      ) : (
        <AppText variant="footnote" tone="tertiary" style={styles.footer}>
          {t('diagnostics:tools.footer')}
        </AppText>
      )}

      <SelectSheet
        visible={picking}
        title={t('diagnostics:tools.routerTitle')}
        value={selected?.id ?? ''}
        options={routers.map((r) => ({
          value: r.id,
          label: r.name,
          detail: r.detail,
          disabled: !r.connection,
        }))}
        onSelect={(id) => {
          setRouterId(id);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
    </Screen>
  );
}

function Option({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.option}>
      <AppText variant="footnote" tone="secondary">
        {label}
      </AppText>
      {children}
    </View>
  );
}

const ms = (v: number | undefined) => (v === undefined ? undefined : `${round1(v)} ms`);

function Result({ result, router }: { result: ToolResult; router: string }) {
  const t = useT();
  const toast = useToast();
  const { colors } = useTheme();
  const elapsed = t('diagnostics:tools.elapsed', { router, seconds: Math.max(1, Math.round(result.ms / 1000)) });

  return (
    <>
      {result.tool === 'ping' ? (
        <GlassCard title={t('diagnostics:tools.tool.ping')} subtitle={elapsed} icon="pulse" testID="tools-summary">
          {result.summary.received === 0 ? (
            <AppText variant="subhead" tone="danger">
              {result.summary.error ?? t('diagnostics:tools.ping.noReply')}
            </AppText>
          ) : null}
          <InfoGrid
            items={[
              { label: t('diagnostics:tools.ping.sent'), value: String(result.summary.transmitted) },
              { label: t('diagnostics:tools.ping.received'), value: String(result.summary.received) },
              { label: t('diagnostics:tools.ping.loss'), value: `${round1(result.summary.lossPct)}%` },
              { label: t('diagnostics:tools.ping.avg'), value: ms(result.summary.avg) },
              { label: t('diagnostics:tools.ping.min'), value: ms(result.summary.min) },
              { label: t('diagnostics:tools.ping.max'), value: ms(result.summary.max) },
              { label: t('diagnostics:tools.ping.jitter'), value: ms(result.summary.jitter) },
            ]}
          />
        </GlassCard>
      ) : result.tool === 'traceroute' ? (
        <ListSection title={`${t('diagnostics:tools.trace.hops')} · ${elapsed}`}>
          {result.summary.length ? (
            result.summary.map((h) => (
              <ListRow
                key={h.hop}
                left={
                  <AppText variant="subhead" weight="600" tone="secondary" style={styles.hop}>
                    {h.hop}
                  </AppText>
                }
                title={h.ip ?? t('diagnostics:tools.trace.noReply')}
                subtitle={h.host}
                value={h.times.length ? ms(h.times.reduce((a, b) => a + b, 0) / h.times.length) : '*'}
              />
            ))
          ) : (
            <ListRow title={t('diagnostics:tools.trace.empty')} icon="info" />
          )}
        </ListSection>
      ) : (
        <ListSection title={`${t('diagnostics:tools.dns.answers')} · ${elapsed}`}>
          {result.summary.answers.map((a, i) => (
            <ListRow
              key={`${a.name}-${i}`}
              title={a.address ?? t('diagnostics:tools.dns.cname', { cname: a.cname ?? '' })}
              subtitle={a.name}
            />
          ))}
          {result.summary.error ? (
            <ListRow
              title={
                (DNS_ERRORS as readonly string[]).includes(result.summary.error)
                  ? t(`diagnostics:tools.dns.error.${result.summary.error as (typeof DNS_ERRORS)[number]}`)
                  : t('diagnostics:tools.dns.error.other', { code: result.summary.error })
              }
              icon="warning"
              iconColor={colors.danger}
            />
          ) : null}
          {result.summary.server ? (
            <ListRow title={t('diagnostics:tools.dns.server')} value={result.summary.server} icon="server" />
          ) : null}
        </ListSection>
      )}

      <GlassCard
        title={t('diagnostics:tools.raw')}
        icon="logs"
        accessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('copy')}
            hitSlop={8}
            onPress={() => void Clipboard.setStringAsync(result.output).then(() => toast(t('copied')))}>
            <Icon name="copy" size={18} color={colors.accent} />
          </Pressable>
        }>
        <ScrollView horizontal>
          <AppText variant="mono" selectable testID="tools-raw">
            {result.output.trim() || '—'}
          </AppText>
        </ScrollView>
      </GlassCard>
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.m },
  options: { gap: spacing.m },
  option: { gap: spacing.xs },
  footer: { marginHorizontal: spacing.l },
  hop: { width: 24, textAlign: 'center' },
});
