import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { allowQuota, type QuotaUsage } from '@/api/services/agent-control';
import { deleteRule, quotaChanges, validateQuota, type QuotaPeriod, type QuotaRule } from '@/api/services/agent-rules';
import { AgentGate } from '@/features/agent/AgentGate';
import { useApplyRules, usePluginModule, useQuotaUsage, useRules } from '@/features/control/hooks';
import { useDeviceLabels } from '@/features/traffic/labels';
import { AGENT_KEY } from '@/hooks/agent-queries';
import { useRouterMutation } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Banner, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';
import { formatDayTime } from '@/utils/dates';
import { formatBytes } from '@/utils/format';
import { normalizeMac } from '@/utils/mac';

/** TR-7: one device's data quota, its use in the current period, and letting it through for a while. */
export default function QuotaScreen() {
  const t = useT();
  const { mac: raw } = useLocalSearchParams<{ mac: string }>();
  const mac = normalizeMac(decodeURIComponent(raw ?? '')) ?? '';
  const rules = useRules();
  const name = useDeviceLabels()(mac).name;
  return (
    <Screen title={t('control:quota.title')}>
      <AppText variant="subhead" tone="secondary">
        {[name, mac].filter(Boolean).join(' · ')}
      </AppText>
      <AgentGate>
        {() =>
          rules.data ? (
            <QuotaForm mac={mac} name={name} rule={rules.data.quotas.find((q) => q.mac === mac)} />
          ) : (
            <Skeleton height={240} radius={22} />
          )
        }
      </AgentGate>
    </Screen>
  );
}

const PERIODS: QuotaPeriod[] = ['day', 'week', 'month'];
const WEEKDAY_LABELS = {
  'zh-CN': ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const num = (s: string) => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

function QuotaForm({ mac, name, rule }: { mac: string; name: string; rule?: QuotaRule }) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const { supported } = usePluginModule('quotas');
  const apply = useApplyRules();
  const usage = useQuotaUsage(supported && !!rule?.section).data?.find((u) => u.section === rule?.section);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [period, setPeriod] = useState<QuotaPeriod>(rule?.period ?? 'month');
  const [resetDay, setResetDay] = useState(rule?.resetDay ?? 1);
  const [gb, setGb] = useState(rule ? String(Number((rule.limitMb / 1024).toFixed(1))) : '');
  const [direction, setDirection] = useState(rule?.direction ?? 'total');
  const [action, setAction] = useState(rule?.action ?? 'block');
  const [limitDown, setLimitDown] = useState(rule?.limitDownload ? String(rule.limitDownload / 1000) : '1');
  const [limitUp, setLimitUp] = useState(rule?.limitUpload ? String(rule.limitUpload / 1000) : '0.5');
  const [picking, setPicking] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!supported) return <Banner tone="warning" text={t('control:needsUpgrade')} />;

  const draft: QuotaRule = {
    section: rule?.section,
    mac,
    enabled,
    period,
    resetDay: period === 'day' ? 1 : resetDay,
    limitMb: Math.round(num(gb) * 1024),
    direction,
    action,
    limitDownload: action === 'limit' ? Math.round(num(limitDown) * 1000) : undefined,
    limitUpload: action === 'limit' ? Math.round(num(limitUp) * 1000) : undefined,
  };
  const issues = validateQuota(draft);
  const issue = (k: (typeof issues)[number]) =>
    showIssues && issues.includes(k) ? t(`control:quota.issues.${k}` as 'control:quota.issues.mac') : undefined;

  const run = (changes: Parameters<typeof apply.mutate>[0], done: string) =>
    apply.mutate(changes, {
      onSuccess: () => {
        toast(done);
        nav.back();
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });

  const resetLabel =
    period === 'week'
      ? WEEKDAY_LABELS[lang][Math.min(7, Math.max(1, resetDay)) - 1]
      : t('control:quota.monthDay', { day: resetDay });
  const resetOptions =
    period === 'week'
      ? WEEKDAY_LABELS[lang].map((label, i) => ({ value: String(i + 1), label }))
      : Array.from({ length: 28 }, (_, i) => ({
          value: String(i + 1),
          label: t('control:quota.monthDay', { day: i + 1 }),
        }));

  return (
    <>
      {usage ? <UsageCard usage={usage} /> : null}
      <ListSection>
        <ListRow title={t('control:quota.enabled')} icon="chart" switchValue={enabled} onSwitch={setEnabled} />
      </ListSection>
      <GlassCard contentStyle={styles.card}>
        <AppText variant="footnote" tone="secondary">
          {t('control:quota.period')}
        </AppText>
        <Segmented
          values={PERIODS.map((p) => t(`control:quota.periods.${p}`))}
          selectedIndex={PERIODS.indexOf(period)}
          onChange={(e) => {
            const next = PERIODS[e.nativeEvent.selectedSegmentIndex];
            setPeriod(next);
            if (next === 'week' && resetDay > 7) setResetDay(1);
          }}
        />
        <TextField
          label={t('control:quota.limit')}
          value={gb}
          onChangeText={setGb}
          keyboardType="decimal-pad"
          placeholder="100"
          error={issue('limit-mb')}
          testID="quota-gb"
        />
        <AppText variant="footnote" tone="secondary">
          {t('control:quota.direction')}
        </AppText>
        <Segmented
          values={[t('control:quota.directions.total'), t('control:quota.directions.download')]}
          selectedIndex={direction === 'total' ? 0 : 1}
          onChange={(e) => setDirection(e.nativeEvent.selectedSegmentIndex === 0 ? 'total' : 'download')}
        />
      </GlassCard>
      {period !== 'day' ? (
        <ListSection>
          <ListRow
            title={t('control:quota.resetDay')}
            value={resetLabel}
            chevron
            onPress={() => setPicking(true)}
            testID="quota-reset"
          />
        </ListSection>
      ) : null}
      <GlassCard contentStyle={styles.card}>
        <AppText variant="footnote" tone="secondary">
          {t('control:quota.action')}
        </AppText>
        <Segmented
          values={[t('control:quota.actions.block'), t('control:quota.actions.limit')]}
          selectedIndex={action === 'block' ? 0 : 1}
          onChange={(e) => setAction(e.nativeEvent.selectedSegmentIndex === 0 ? 'block' : 'limit')}
        />
        {action === 'limit' ? (
          <>
            <TextField
              label={t('control:quota.limitDownload')}
              value={limitDown}
              onChangeText={setLimitDown}
              keyboardType="decimal-pad"
            />
            <TextField
              label={t('control:quota.limitUpload')}
              value={limitUp}
              onChangeText={setLimitUp}
              keyboardType="decimal-pad"
              error={issue('limit-rate')}
            />
          </>
        ) : null}
        <AppText variant="footnote" tone="secondary">
          {t('control:quota.hint')}
        </AppText>
      </GlassCard>
      <GlassButton
        label={t('save')}
        variant="primary"
        loading={apply.isPending}
        disabled={apply.isPending}
        onPress={() => (issues.length ? setShowIssues(true) : run(quotaChanges(draft), t('control:quota.saved')))}
        testID="quota-save"
      />
      {rule?.section ? (
        <GlassButton
          label={t('control:quota.delete')}
          icon="trash"
          variant="destructive"
          disabled={apply.isPending}
          onPress={() => setConfirmDelete(true)}
        />
      ) : null}
      <SelectSheet
        visible={picking}
        title={t('control:quota.resetDay')}
        options={resetOptions}
        value={String(resetDay)}
        onSelect={(v) => {
          setResetDay(Number(v));
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
      <ActionSheet
        visible={confirmDelete}
        title={t('control:quota.deleteTitle', { name })}
        actions={[
          {
            label: t('control:quota.delete'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              setConfirmDelete(false);
              run(deleteRule(rule!.section!), t('control:quota.deleted'));
            },
          },
        ]}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/** Use in the current period; a device over its allowance can be let through for a while. */
export function UsageCard({ usage }: { usage: QuotaUsage }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const allow = useRouterMutation(
    (conn, until: 'hour' | 'period') => allowQuota(conn, usage.section, until),
    [[AGENT_KEY, 'quotas']],
  );
  const state =
    usage.state === 'allowed'
      ? t('control:quota.states.allowed', { time: formatDayTime(usage.allowUntil, lang) })
      : t(`control:quota.states.${usage.state}`);
  const tone = usage.state === 'exceeded' ? 'danger' : usage.state === 'warned' ? 'warning' : 'secondary';
  const run = (until: 'hour' | 'period') =>
    allow.mutate(until, {
      onSuccess: () => toast(t('control:quota.allowed')),
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  return (
    <GlassCard title={state} icon="chart" contentStyle={styles.card}>
      <AppText variant="body" tone={tone}>
        {t('control:quota.usage', {
          used: formatBytes(usage.used),
          limit: formatBytes(usage.limit),
          pct: Math.round(usage.pct),
        })}
      </AppText>
      <AppText variant="footnote" tone="secondary">
        {t('control:quota.periodRange', {
          start: formatDayTime(usage.periodStart, lang),
          end: formatDayTime(usage.periodEnd, lang),
        })}
      </AppText>
      {usage.state === 'exceeded' ? (
        <>
          <GlassButton
            label={t('control:quota.allowHour')}
            compact
            loading={allow.isPending}
            onPress={() => run('hour')}
          />
          <GlassButton
            label={t('control:quota.allowPeriod')}
            compact
            disabled={allow.isPending}
            onPress={() => run('period')}
          />
        </>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.s },
});
