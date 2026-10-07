import { useRouter } from 'expo-router';

import { AgentGate } from '@/features/agent/AgentGate';
import { limitWhen, mbps } from '@/features/control/format';
import { usePluginModule, useQuotaUsage, useRules } from '@/features/control/hooks';
import { useDeviceLabels } from '@/features/traffic/labels';
import { useLang, useT } from '@/i18n';
import { EmptyState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { formatBytes } from '@/utils/format';

/** TR-7: every speed limit and quota with the current use; tap to edit. */
export default function RulesScreen() {
  const t = useT();
  return (
    <Screen title={t('control:rules.title')}>
      <AgentGate>{() => <RulesList />}</AgentGate>
    </Screen>
  );
}

function RulesList() {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const rules = useRules();
  const quotas = usePluginModule('quotas');
  const usage = useQuotaUsage(quotas.supported);
  const label = useDeviceLabels();
  if (!rules.data) return <Skeleton height={160} radius={16} />;
  const { limits, quotas: rows } = rules.data;
  if (!limits.length && !rows.length) {
    return <EmptyState icon="speed" title={t('control:rules.empty')} message={t('control:rules.emptyHint')} />;
  }
  const open = (page: 'limit' | 'quota', mac: string) =>
    nav.push(`/network/traffic/${page}?mac=${encodeURIComponent(mac)}`);
  return (
    <>
      {limits.length ? (
        <ListSection title={t('control:rules.limits')}>
          {limits.map((r) => (
            <ListRow
              key={r.section}
              title={label(r.mac).name}
              subtitle={[
                [mbps(r.download) && `↓ ${mbps(r.download)}`, mbps(r.upload) && `↑ ${mbps(r.upload)}`]
                  .filter(Boolean)
                  .join('  '),
                limitWhen(r, lang),
              ]
                .filter(Boolean)
                .join(' · ')}
              value={r.enabled ? undefined : t('control:rules.off')}
              icon="speed"
              chevron
              onPress={() => open('limit', r.mac)}
            />
          ))}
        </ListSection>
      ) : null}
      {rows.length ? (
        <ListSection title={t('control:rules.quotas')}>
          {rows.map((q) => {
            const u = usage.data?.find((x) => x.section === q.section);
            return (
              <ListRow
                key={q.section}
                title={label(q.mac).name}
                subtitle={
                  u
                    ? t('control:quota.usage', {
                        used: formatBytes(u.used),
                        limit: formatBytes(u.limit),
                        pct: Math.round(u.pct),
                      })
                    : t(`control:quota.periods.${q.period}`)
                }
                value={
                  !q.enabled
                    ? t('control:rules.off')
                    : u && u.state !== 'ok'
                      ? t(`control:quota.states.${u.state === 'allowed' ? 'ok' : u.state}`)
                      : undefined
                }
                icon="chart"
                chevron
                onPress={() => open('quota', q.mac)}
              />
            );
          })}
        </ListSection>
      ) : null}
    </>
  );
}
