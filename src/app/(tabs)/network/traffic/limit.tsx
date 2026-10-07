import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { deleteRule, limitChanges, validateLimit, WEEKDAYS, type LimitRule } from '@/api/services/agent-rules';
import { AgentGate } from '@/features/agent/AgentGate';
import { fromWeekdays, toWeekdays } from '@/features/control/format';
import { useApplyRules, usePluginModule, useRules } from '@/features/control/hooks';
import { useDeviceLabels } from '@/features/traffic/labels';
import { useLang, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { DayPicker } from '@/ui/DayPicker';
import { describeError } from '@/ui/errorText';
import { Banner, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { TimeField } from '@/ui/TimeField';
import { useToast } from '@/ui/Toast';
import { normalizeMac } from '@/utils/mac';

/** TR-7: one device's speed limit (download/upload caps, optionally on some days and hours). */
export default function LimitScreen() {
  const t = useT();
  const { mac: raw } = useLocalSearchParams<{ mac: string }>();
  const mac = normalizeMac(decodeURIComponent(raw ?? '')) ?? '';
  const rules = useRules();
  const name = useDeviceLabels()(mac).name;
  return (
    <Screen title={t('control:limit.title')}>
      <AppText variant="subhead" tone="secondary">
        {[name, mac].filter(Boolean).join(' · ')}
      </AppText>
      <AgentGate>
        {() =>
          rules.data ? (
            <LimitForm mac={mac} name={name} rule={rules.data.limits.find((r) => r.mac === mac)} />
          ) : (
            <Skeleton height={240} radius={22} />
          )
        }
      </AgentGate>
    </Screen>
  );
}

const toMbps = (kbps: number) => (kbps > 0 ? String(Number((kbps / 1000).toFixed(3))) : '');
const toKbps = (s: string) => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : 0;
};

function LimitForm({ mac, name, rule }: { mac: string; name: string; rule?: LimitRule }) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const { info, supported } = usePluginModule('limits');
  const apply = useApplyRules();
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [down, setDown] = useState(toMbps(rule?.download ?? 0));
  const [up, setUp] = useState(toMbps(rule?.upload ?? 0));
  const [scheduled, setScheduled] = useState(!!(rule?.start || (rule?.weekdays.length ?? 0) > 0));
  // No weekdays stored means every day: show all seven ticked.
  const [days, setDays] = useState(toWeekdays(rule?.weekdays.length ? rule.weekdays : [...WEEKDAYS]));
  const [from, setFrom] = useState(rule?.start ?? '20:00');
  const [to, setTo] = useState(rule?.stop ?? '23:00');
  const [showIssues, setShowIssues] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!supported) return <Banner tone="warning" text={t('control:needsUpgrade')} />;

  const draft: LimitRule = {
    section: rule?.section,
    mac,
    enabled,
    download: toKbps(down),
    upload: toKbps(up),
    weekdays: scheduled && days.length < 7 ? fromWeekdays(days) : [],
    start: scheduled ? from : undefined,
    stop: scheduled ? to : undefined,
  };
  const issues = validateLimit(draft, { pickedDays: scheduled ? days.length : undefined });
  const scheduleIssue = showIssues ? (['weekdays', 'time'] as const).find((i) => issues.includes(i)) : undefined;

  const run = (changes: Parameters<typeof apply.mutate>[0], done: string) =>
    apply.mutate(changes, {
      onSuccess: () => {
        toast(done);
        nav.back();
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });

  const save = () => {
    if (issues.length) {
      setShowIssues(true);
      return;
    }
    run(limitChanges(draft), t('control:limit.saved'));
  };

  return (
    <>
      {info?.limitsError ? <Banner tone="error" text={t('control:limit.error', { error: info.limitsError })} /> : null}
      {info?.offload === 'hardware' ? <Banner tone="warning" text={t('control:limit.hardwareOffload')} /> : null}
      <ListSection>
        <ListRow title={t('control:limit.enabled')} icon="speed" switchValue={enabled} onSwitch={setEnabled} />
      </ListSection>
      <GlassCard>
        <TextField
          label={t('control:limit.download')}
          value={down}
          onChangeText={setDown}
          keyboardType="decimal-pad"
          placeholder="0"
          testID="limit-down"
        />
        <TextField
          label={t('control:limit.upload')}
          value={up}
          onChangeText={setUp}
          keyboardType="decimal-pad"
          placeholder="0"
          hint={t('control:limit.unlimitedHint')}
          error={showIssues && issues.includes('rate') ? t('control:limit.issues.rate') : undefined}
          testID="limit-up"
        />
      </GlassCard>
      <ListSection title={t('control:limit.schedule')}>
        <ListRow
          title={t('control:limit.someTimes')}
          subtitle={scheduled ? undefined : t('control:limit.always')}
          icon="schedule"
          switchValue={scheduled}
          onSwitch={setScheduled}
        />
      </ListSection>
      {scheduled ? (
        <GlassCard>
          <DayPicker value={days} onChange={setDays} lang={lang} />
          <TimeField label={t('control:limit.from')} value={from} onChange={setFrom} />
          <TimeField label={t('control:limit.to')} value={to} onChange={setTo} />
          <AppText variant="footnote" tone={scheduleIssue ? 'danger' : 'secondary'}>
            {scheduleIssue ? t(`control:limit.issues.${scheduleIssue}`) : t('control:limit.overnightHint')}
          </AppText>
        </GlassCard>
      ) : null}
      <GlassButton
        label={t('save')}
        variant="primary"
        loading={apply.isPending}
        disabled={apply.isPending}
        onPress={save}
        testID="limit-save"
      />
      {rule?.section ? (
        <GlassButton
          label={t('control:limit.delete')}
          icon="trash"
          variant="destructive"
          disabled={apply.isPending}
          onPress={() => setConfirmDelete(true)}
        />
      ) : null}
      <ActionSheet
        visible={confirmDelete}
        title={t('control:limit.deleteTitle', { name })}
        actions={[
          {
            label: t('control:limit.delete'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              setConfirmDelete(false);
              run(deleteRule(rule!.section!), t('control:limit.deleted'));
            },
          },
        ]}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
