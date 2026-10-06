import { useRouter } from 'expo-router';
import { useState } from 'react';

import { notifyStatus } from '@/api/services/agent-control';
import { langChanges, type NotifyLang } from '@/api/services/agent-rules';
import { uci } from '@/api/uci';
import { AgentGate } from '@/features/agent/AgentGate';
import { useApplyRules, usePluginModule, useRules } from '@/features/control/hooks';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { AGENT_KEY } from '@/hooks/agent-queries';
import { useRouterQuery } from '@/hooks/router-queries';
import { useLang, useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { Banner, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { useToast } from '@/ui/Toast';
import { formatDayTime } from '@/utils/dates';

const LANGS: NotifyLang[] = ['auto', 'zh_cn', 'en'];

/** AG-14: the plugin's push channels, their last result, and the message language. */
export default function NotifyScreen() {
  const t = useT();
  const nav = useRouter();
  return (
    <Screen
      title={t('control:notify.title')}
      headerRight={
        <HeaderButton
          icon="plus"
          accessibilityLabel={t('control:notify.add')}
          onPress={() => nav.push('/more/agent/notify/new')}
          testID="notify-add"
        />
      }>
      <AgentGate>{() => <Channels />}</AgentGate>
    </Screen>
  );
}

function Channels() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const toast = useToast();
  const { connection } = useActiveRouter();
  const { supported } = usePluginModule('notify');
  const rules = useRules(supported);
  const status = useRouterQuery([AGENT_KEY, 'notify-status'], notifyStatus, {
    enabled: supported,
    refetchInterval: 15_000,
  });
  const apply = useApplyRules();
  const [picking, setPicking] = useState(false);

  if (!supported) return <Banner tone="warning" text={t('control:needsUpgrade')} />;
  if (!rules.data) return <Skeleton height={200} radius={16} />;

  const setLang = async (value: NotifyLang) => {
    setPicking(false);
    if (!connection) return;
    apply.mutate(langChanges(await uci.get(connection, 'routelink'), value), {
      onError: (e) => toast(describeError(t, e).title, 'error'),
    });
  };
  const pending = status.data?.pending ?? 0;

  return (
    <>
      {pending ? <Banner tone="info" text={t('control:notify.pending', { count: pending })} /> : null}
      <ListSection title={t('control:notify.channels')} footer={t('control:notify.intro')}>
        {rules.data.channels.map((c) => {
          const s = status.data?.channels.find((x) => x.section === c.section);
          const failed = s && s.lastError && s.lastErrorTs >= s.lastOk;
          return (
            <ListRow
              key={c.section}
              title={c.name || t(`control:notify.types.${c.type}`)}
              subtitle={
                failed
                  ? t('control:notify.lastError', { error: s.lastError, time: formatDayTime(s.lastErrorTs, lang) })
                  : s?.lastOk
                    ? t('control:notify.lastOk', { time: formatDayTime(s.lastOk, lang) })
                    : t(`control:notify.types.${c.type}`)
              }
              value={c.enabled ? undefined : t('control:rules.off')}
              icon={failed ? 'warning' : 'bell'}
              chevron
              onPress={() => nav.push(`/more/agent/notify/${encodeURIComponent(c.section!)}`)}
            />
          );
        })}
        <ListRow
          title={t('control:notify.add')}
          icon="plus"
          chevron
          onPress={() => nav.push('/more/agent/notify/new')}
        />
      </ListSection>
      <ListSection>
        <ListRow
          title={t('control:notify.lang')}
          value={t(`control:notify.langs.${rules.data.lang}`)}
          icon="language"
          chevron
          onPress={() => setPicking(true)}
        />
      </ListSection>
      <SelectSheet
        visible={picking}
        title={t('control:notify.lang')}
        options={LANGS.map((l) => ({ value: l, label: t(`control:notify.langs.${l}`) }))}
        value={rules.data.lang}
        onSelect={(v) => void setLang(v as NotifyLang)}
        onCancel={() => setPicking(false)}
      />
    </>
  );
}
