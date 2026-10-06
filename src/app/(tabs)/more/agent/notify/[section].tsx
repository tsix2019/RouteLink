import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { testChannel } from '@/api/services/agent-control';
import {
  channelChanges,
  deleteRule,
  NOTIFY_EVENTS,
  NOTIFY_TYPES,
  validateChannel,
  type NotifyChannel,
  type NotifyType,
} from '@/api/services/agent-rules';
import { AgentGate } from '@/features/agent/AgentGate';
import { useApplyRules, useRules } from '@/features/control/hooks';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useT } from '@/i18n';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { describeError } from '@/ui/errorText';
import { Skeleton } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

const BLANK: NotifyChannel = {
  type: 'bark',
  enabled: true,
  name: '',
  url: '',
  template: '',
  token: '',
  chatId: '',
  secret: '',
  events: ['device_new', 'device_watch', 'quota', 'outage'],
};

/** Default addresses that make the common services a matter of pasting one key. */
const DEFAULT_URL: Partial<Record<NotifyType, string>> = { bark: 'https://api.day.app' };

/** One push channel: service, its fields (design §11's table), events, a test message. `new` adds one. */
export default function ChannelScreen() {
  const t = useT();
  const { section } = useLocalSearchParams<{ section: string }>();
  const rules = useRules();
  const isNew = section === 'new';
  const channel = isNew ? undefined : rules.data?.channels.find((c) => c.section === section);
  return (
    <Screen title={isNew ? t('control:notify.new') : channel?.name || t('control:notify.title')}>
      <AgentGate>
        {() =>
          rules.data && (isNew || channel) ? (
            <ChannelForm channel={channel ?? { ...BLANK, url: DEFAULT_URL.bark ?? '' }} />
          ) : (
            <Skeleton height={240} radius={22} />
          )
        }
      </AgentGate>
    </Screen>
  );
}

function ChannelForm({ channel }: { channel: NotifyChannel }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const { connection } = useActiveRouter();
  const apply = useApplyRules();
  const [c, setC] = useState(channel);
  const [picking, setPicking] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<NotifyChannel>) => setC((v) => ({ ...v, ...patch }));
  const issues = validateChannel(c);
  const issue = (k: (typeof issues)[number]) =>
    showIssues && issues.includes(k) ? t(`control:notify.issues.${k}` as 'control:notify.issues.url') : undefined;
  const test = useMutation({
    mutationFn: () => testChannel(connection!, c.section!),
    onSuccess: (r) =>
      r.ok
        ? toast(t('control:notify.testOk'))
        : toast(t('control:notify.testFailed', { error: r.error ?? '' }), 'error'),
    onError: (e) => toast(describeError(t, e).title, 'error'),
  });

  const save = () => {
    if (issues.length) {
      setShowIssues(true);
      return;
    }
    apply.mutate(channelChanges(c), {
      onSuccess: () => {
        toast(t('control:notify.saved'));
        nav.back();
      },
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };

  const field = (
    key: 'url' | 'token' | 'chatId' | 'secret' | 'template',
    label: string,
    o: { hint?: string; secret?: boolean } = {},
  ) => (
    <TextField
      key={key}
      label={label}
      value={c[key]}
      onChangeText={(v) => set({ [key]: v })}
      autoCapitalize="none"
      autoCorrect={false}
      secret={o.secret}
      hint={o.hint}
      multiline={key === 'template'}
      error={
        key === 'url'
          ? issue('url')
          : key === 'token'
            ? issue('token')
            : key === 'chatId'
              ? issue('chat-id')
              : undefined
      }
    />
  );
  const fields = {
    webhook: [
      field('url', t('control:notify.fields.url')),
      field('template', t('control:notify.fields.template'), { hint: t('control:notify.fields.templateHint') }),
    ],
    bark: [
      field('url', t('control:notify.fields.server')),
      field('token', t('control:notify.fields.deviceKey'), { secret: true }),
    ],
    serverchan: [field('token', t('control:notify.fields.sendKey'), { secret: true })],
    pushplus: [field('token', t('control:notify.fields.token'), { secret: true })],
    telegram: [
      field('token', t('control:notify.fields.botToken'), { secret: true }),
      field('chatId', t('control:notify.fields.chatId')),
    ],
    wecom: [field('url', t('control:notify.fields.webhook'))],
    dingtalk: [
      field('url', t('control:notify.fields.webhook')),
      field('secret', t('control:notify.fields.secret'), { secret: true }),
    ],
    feishu: [
      field('url', t('control:notify.fields.webhook')),
      field('secret', t('control:notify.fields.secret'), { secret: true }),
    ],
  }[c.type];

  return (
    <>
      <ListSection>
        <ListRow
          title={t('control:notify.type')}
          value={t(`control:notify.types.${c.type}`)}
          chevron
          onPress={() => setPicking(true)}
          testID="notify-type"
        />
        <ListRow
          title={t('control:notify.enabled')}
          icon="power"
          switchValue={c.enabled}
          onSwitch={(enabled) => set({ enabled })}
        />
      </ListSection>
      <GlassCard contentStyle={styles.card}>
        <TextField label={t('control:notify.fields.name')} value={c.name} onChangeText={(name) => set({ name })} />
        {fields}
      </GlassCard>
      <ListSection title={t('control:notify.events.title')} footer={t('control:notify.watchHint')}>
        {NOTIFY_EVENTS.map((e) => (
          <ListRow
            key={e}
            title={t(`control:notify.events.${e}`)}
            switchValue={c.events.includes(e)}
            onSwitch={(on) => set({ events: on ? [...c.events, e] : c.events.filter((x) => x !== e) })}
          />
        ))}
      </ListSection>
      {showIssues && issues.includes('events') ? (
        <AppText variant="footnote" tone="danger">
          {t('control:notify.issues.events')}
        </AppText>
      ) : null}
      <GlassButton
        label={t('save')}
        variant="primary"
        loading={apply.isPending}
        disabled={apply.isPending}
        onPress={save}
        testID="notify-save"
      />
      <GlassButton
        label={t('control:notify.test')}
        icon="send"
        loading={test.isPending}
        disabled={test.isPending}
        onPress={() => (c.section ? test.mutate() : toast(t('control:notify.saveFirst'), 'info'))}
        testID="notify-test"
      />
      {c.section ? (
        <GlassButton
          label={t('control:notify.delete')}
          icon="trash"
          variant="destructive"
          onPress={() => setConfirmDelete(true)}
        />
      ) : null}
      <SelectSheet
        visible={picking}
        title={t('control:notify.type')}
        options={NOTIFY_TYPES.map((type) => ({ value: type as string, label: t(`control:notify.types.${type}`) }))}
        value={c.type}
        onSelect={(v) => {
          const type = v as NotifyType;
          set({ type, url: c.url || DEFAULT_URL[type] || '' });
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
      <ActionSheet
        visible={confirmDelete}
        title={t('control:notify.deleteTitle', { name: c.name || t(`control:notify.types.${c.type}`) })}
        actions={[
          {
            label: t('control:notify.delete'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              setConfirmDelete(false);
              apply.mutate(deleteRule(c.section!), {
                onSuccess: () => {
                  toast(t('control:notify.deleted'));
                  nav.back();
                },
                onError: (e) => toast(describeError(t, e).title, 'error'),
              });
            },
          },
        ]}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.s },
});
