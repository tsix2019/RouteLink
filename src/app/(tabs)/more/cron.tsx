import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionError } from '@/api/services/action-error';
import {
  describeSchedule,
  readCrontab,
  validateSchedule,
  writeCrontab,
  type CronEntry,
  type CronLine,
} from '@/api/services/cron';
import { FeatureGate } from '@/features/capabilities/FeatureGate';
import { ConnectionBanner } from '@/features/routers/ConnectionBanner';
import { useRouterMutation, useRouterQuery } from '@/hooks/router-queries';
import { currentLanguage, useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { EmptyState, ErrorState, Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const PRESETS = [
  { key: 'presetDaily', schedule: '0 3 * * *' },
  { key: 'presetWeekly', schedule: '0 4 * * 1' },
  { key: 'presetHourly', schedule: '0 * * * *' },
  { key: 'presetHalfHour', schedule: '*/30 * * * *' },
] as const;

type Draft = { index: number | null; schedule: string; command: string };
type Pending = { kind: 'save' | 'delete'; lines: CronLine[] } | null;

/** MO-6: the root crontab. Comments and odd lines stay as they are; App-managed tasks are read-only. */
export default function ScheduledTasks() {
  const t = useT();
  const toast = useToast();
  const tab = useRouterQuery(['cron'], readCrontab);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const write = useRouterMutation(
    (conn, a: { lines: CronLine[]; original: string }) => writeCrontab(conn, a.lines, a.original),
    [['cron']],
  );

  const lines = tab.data?.lines ?? [];
  const entries = lines.flatMap((l, index) => (l.kind === 'entry' ? [{ entry: l, index }] : []));
  const lang = currentLanguage();
  const describe = (e: CronEntry) => describeSchedule(e.schedule, lang) ?? e.schedule.join(' ');

  const commit = (next: CronLine[]) => {
    if (!tab.data) return;
    write.mutate(
      { lines: next, original: tab.data.original },
      {
        onSuccess: () => toast(t('more:cronScreen.saved')),
        onError: (error) => {
          if (error instanceof ActionError && error.code === 'cron-changed') {
            toast(t('more:cronScreen.changed'), 'error');
            void tab.refetch();
          } else toast(describeError(t, error).title, 'error');
        },
      },
    );
  };

  const save = (d: Draft) => {
    const entry: CronEntry = {
      kind: 'entry',
      schedule: d.schedule.trim().split(/\s+/) as CronEntry['schedule'],
      command: d.command.trim(),
      managed: false,
    };
    const next = d.index === null ? [...lines, entry] : lines.map((l, i) => (i === d.index ? entry : l));
    setDraft(null);
    setPending({ kind: 'save', lines: next });
  };

  const chosen = selected === null ? null : (lines[selected] as CronEntry | undefined);

  return (
    <>
      <Screen
        title={t('more:cron')}
        onRefresh={() => tab.refetch()}
        top={tab.data ? <ConnectionBanner error={tab.error} onRetry={() => void tab.refetch()} /> : null}>
        <FeatureGate feature="system.cron" icon="schedule">
          {tab.data ? (
            entries.length ? (
              <ListSection footer={entries.some((e) => e.entry.managed) ? t('more:cronScreen.managedHint') : undefined}>
                {entries.map(({ entry, index }) => (
                  <ListRow
                    key={index}
                    title={entry.command}
                    subtitle={describe(entry)}
                    icon="schedule"
                    right={entry.managed ? <Badge label={t('more:cronScreen.managed')} tone="accent" /> : undefined}
                    chevron={!entry.managed}
                    onPress={entry.managed ? undefined : () => setSelected(index)}
                    testID={`cron-${index}`}
                  />
                ))}
              </ListSection>
            ) : (
              <EmptyState icon="schedule" title={t('more:cronScreen.empty')} message={t('more:cronScreen.emptyHint')} />
            )
          ) : tab.isError ? (
            <ErrorState error={tab.error} onRetry={() => void tab.refetch()} />
          ) : (
            <View style={styles.loading}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} radius={14} />
              ))}
            </View>
          )}
          {tab.data ? (
            <GlassButton
              label={t('more:cronScreen.add')}
              icon="plus"
              variant="primary"
              disabled={write.isPending}
              onPress={() => setDraft({ index: null, schedule: '0 3 * * *', command: '' })}
              testID="cron-add"
            />
          ) : null}
        </FeatureGate>
      </Screen>

      <ActionSheet
        visible={!!chosen}
        title={chosen?.command}
        message={chosen ? describe(chosen) : undefined}
        actions={
          chosen && selected !== null
            ? [
                {
                  label: t('more:cronScreen.edit'),
                  icon: 'edit' as const,
                  onPress: () => {
                    setDraft({ index: selected, schedule: chosen.schedule.join(' '), command: chosen.command });
                    setSelected(null);
                  },
                },
                {
                  label: t('more:cronScreen.delete'),
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: () => {
                    setPending({ kind: 'delete', lines: lines.filter((_, i) => i !== selected) });
                    setSelected(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSelected(null)}
      />
      {draft ? <EditSheet draft={draft} onSave={save} onCancel={() => setDraft(null)} /> : null}
      <RiskConfirm
        visible={!!pending}
        level="medium"
        title={pending?.kind === 'delete' ? t('more:cronScreen.deleteTitle') : t('more:cronScreen.saveTitle')}
        consequences={[
          pending?.kind === 'delete' ? t('more:cronScreen.deleteConsequence') : t('more:cronScreen.saveConsequence'),
        ]}
        confirmLabel={pending?.kind === 'delete' ? t('more:cronScreen.delete') : t('save')}
        onConfirm={() => {
          if (pending) commit(pending.lines);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function EditSheet({ draft, onSave, onCancel }: { draft: Draft; onSave(d: Draft): void; onCancel(): void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [schedule, setSchedule] = useState(draft.schedule);
  const [command, setCommand] = useState(draft.command);
  const [errors, setErrors] = useState<{ schedule?: string; command?: string }>({});
  const preview =
    validateSchedule(schedule.trim().split(/\s+/)) === null
      ? describeSchedule(schedule.trim().split(/\s+/), currentLanguage())
      : null;

  const submit = () => {
    const problem = validateSchedule(schedule.trim().split(/\s+/));
    const next = {
      schedule: problem ? t(`more:cronScreen.error.${problem}`) : undefined,
      command: !command.trim() || /[\r\n]/.test(command) ? t('more:cronScreen.error.command') : undefined,
    };
    setErrors(next);
    if (!next.schedule && !next.command) onSave({ ...draft, schedule, command });
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
          <GlassSurface variant="floating" style={[styles.sheet, { marginBottom: insets.bottom + spacing.m }]}>
            <AppText variant="title">
              {draft.index === null ? t('more:cronScreen.add') : t('more:cronScreen.edit')}
            </AppText>
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
            <GlassButton label={t('save')} variant="primary" onPress={submit} testID="cron-save" />
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: { gap: spacing.s },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
});
