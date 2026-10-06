import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionError } from '@/api/services/action-error';
import {
  describeSchedule,
  findEntry,
  readCrontab,
  validateSchedule,
  writeCrontab,
  type CronEntry,
  type CronLine,
  type Crontab,
} from '@/api/services/cron';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { currentLanguage, useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { FormPlaceholder, FormScreen, useFormExit, useLoaded } from '@/ui/FormScreen';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const PRESETS = [
  { key: 'presetDaily', schedule: '0 3 * * *' },
  { key: 'presetWeekly', schedule: '0 4 * * 1' },
  { key: 'presetHourly', schedule: '0 * * * *' },
  { key: 'presetHalfHour', schedule: '*/30 * * * *' },
] as const;

const fields = (schedule: string) => schedule.trim().split(/\s+/);

/** MO-6: add a scheduled task, or edit the one at line `?index=` of the root crontab. */
export default function EditCron() {
  const t = useT();
  const params = useLocalSearchParams<{ index?: string }>();
  const tab = useRouterQuery(['cron'], readCrontab);
  // The crontab as the page opened: saving changes this one line of it (and the list refetches).
  const loaded = useLoaded(tab.data);
  const index = params.index === undefined ? null : Number(params.index);
  const line = index === null ? undefined : loaded?.lines[index];
  const entry = line?.kind === 'entry' && !line.managed ? line : undefined;
  const title = index === null ? t('more:cronScreen.add') : t('more:cronScreen.edit');
  if (!loaded || (index !== null && !entry)) {
    return (
      <FormPlaceholder
        title={title}
        error={tab.error}
        onRetry={() => void tab.refetch()}
        missing={!!loaded && index !== null && !entry}
      />
    );
  }
  return (
    <CronForm
      title={title}
      crontab={loaded}
      index={index}
      entry={entry}
      reload={() => tab.refetch().then((r) => r.data)}
    />
  );
}

function CronForm({
  title,
  crontab,
  index,
  entry,
  reload,
}: {
  title: string;
  crontab: Crontab;
  index: number | null;
  entry?: CronEntry;
  reload(): Promise<Crontab | undefined>;
}) {
  const t = useT();
  const toast = useToast();
  const exit = useFormExit();
  // Moves to a fresh read when the crontab was changed elsewhere before saving.
  const [base, setBase] = useState({ crontab, index });
  const [gone, setGone] = useState(false);
  const [initial] = useState(() => ({
    schedule: entry?.schedule.join(' ') ?? '0 3 * * *',
    command: entry?.command ?? '',
  }));
  const [schedule, setSchedule] = useState(initial.schedule);
  const [command, setCommand] = useState(initial.command);
  const [errors, setErrors] = useState<{ schedule?: string; command?: string }>({});
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const write = useRouterMutation(
    (conn, a: { lines: CronLine[]; original: string }) => writeCrontab(conn, a.lines, a.original),
    [['cron']],
  );
  const preview =
    validateSchedule(fields(schedule)) === null ? describeSchedule(fields(schedule), currentLanguage()) : null;

  const submit = () => {
    const problem = validateSchedule(fields(schedule));
    const found = {
      schedule: problem ? t(`more:cronScreen.error.${problem}`) : undefined,
      command: !command.trim() || /[\r\n]/.test(command) ? t('more:cronScreen.error.command') : undefined,
    };
    setErrors(found);
    if (!found.schedule && !found.command) setPending('save');
  };

  const changedElsewhere = async () => {
    toast(t('more:cronScreen.changed'), 'error');
    const fresh = await reload();
    if (!fresh) return;
    if (base.index === null || !entry) return setBase({ crontab: fresh, index: null });
    const at = findEntry(fresh.lines, entry, base.index);
    if (at === null) setGone(true);
    else setBase({ crontab: fresh, index: at });
  };

  const run = () => {
    const kind = pending;
    setPending(null);
    const { lines, original } = base.crontab;
    const edited: CronEntry = {
      kind: 'entry',
      schedule: fields(schedule) as CronEntry['schedule'],
      command: command.trim(),
      managed: false,
    };
    const next =
      kind === 'delete'
        ? lines.filter((_, i) => i !== base.index)
        : base.index === null
          ? [...lines, edited]
          : lines.map((l, i) => (i === base.index ? edited : l));
    write.mutate(
      { lines: next, original },
      {
        onSuccess: () => {
          toast(t('more:cronScreen.saved'));
          exit.back();
        },
        onError: (error) => {
          if (error instanceof ActionError && error.code === 'cron-changed') void changedElsewhere();
          else toast(describeError(t, error).title, 'error');
        },
      },
    );
  };

  if (gone) return <FormPlaceholder title={title} missing />;
  return (
    <>
      <FormScreen
        title={title}
        dirty={schedule !== initial.schedule || command !== initial.command}
        leaving={exit.leaving}
        onSave={submit}
        saving={write.isPending}
        onDelete={entry ? () => setPending('delete') : undefined}
        deleteLabel={t('more:cronScreen.delete')}
        testID="cron-form">
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('more:cronScreen.schedule')}
            value={schedule}
            onChangeText={(v) => {
              setSchedule(v);
              setErrors((e) => ({ ...e, schedule: undefined }));
            }}
            placeholder={t('more:cronScreen.scheduleHint')}
            hint={preview ?? t('more:cronScreen.scheduleHint')}
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={errors.schedule}
            testID="cron-schedule"
          />
          <View style={styles.presets}>
            {PRESETS.map((p) => (
              <GlassButton
                key={p.key}
                label={t(`more:cronScreen.${p.key}`)}
                compact
                onPress={() => {
                  setSchedule(p.schedule);
                  setErrors((e) => ({ ...e, schedule: undefined }));
                }}
              />
            ))}
          </View>
        </GlassCard>
        <GlassCard contentStyle={styles.card}>
          <TextField
            label={t('more:cronScreen.command')}
            value={command}
            onChangeText={(v) => {
              setCommand(v);
              setErrors((e) => ({ ...e, command: undefined }));
            }}
            placeholder="/etc/init.d/dnsmasq restart"
            autoCapitalize="none"
            autoCorrect={false}
            monospace
            error={errors.command}
            testID="cron-command"
          />
        </GlassCard>
      </FormScreen>

      <RiskConfirm
        visible={!!pending}
        level="medium"
        title={pending === 'delete' ? t('more:cronScreen.deleteTitle') : t('more:cronScreen.saveTitle')}
        consequences={[
          pending === 'delete' ? t('more:cronScreen.deleteConsequence') : t('more:cronScreen.saveConsequence'),
        ]}
        confirmLabel={pending === 'delete' ? t('more:cronScreen.delete') : t('save')}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.m },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
});
