import { useRouter } from 'expo-router';

import type { AgentInfo } from '@/api/services/agent';
import { useTrust } from '@/features/wifi-tools/useTrust';
import { useLang, useT } from '@/i18n';
import { ListRow, ListSection } from '@/ui/ListSection';
import { formatBytes } from '@/utils/format';

import { DestinationList } from './Destinations';
import { limitWhen, mbps } from './format';
import { usePluginModule, useQuotaUsage, useRules } from './hooks';

/**
 * P4 on a device's traffic page (TR-4): its speed limit and quota, a push notice when it comes and goes,
 * and where it connects to (destinations, DNS log).
 */
export function DeviceControls({
  mac,
  info,
  start,
  end,
}: {
  mac: string;
  info: AgentInfo;
  start: number;
  end: number;
}) {
  const t = useT();
  const lang = useLang();
  const nav = useRouter();
  const limits = usePluginModule('limits');
  const quotas = usePluginModule('quotas');
  const notify = usePluginModule('notify');
  const dns = usePluginModule('dns');
  const rules = useRules(limits.supported || quotas.supported);
  const usage = useQuotaUsage(quotas.supported);
  const trust = useTrust();
  const limit = rules.data?.limits.find((r) => r.mac === mac);
  const quota = rules.data?.quotas.find((q) => q.mac === mac);
  const used = usage.data?.find((u) => u.section === quota?.section);
  const q = `?mac=${encodeURIComponent(mac)}`;

  if (!limits.supported && !quotas.supported && !dns.supported) return null;
  return (
    <>
      <ListSection title={t('control:section')}>
        {limits.supported ? (
          <ListRow
            title={t('control:limit.row')}
            subtitle={
              limit
                ? [
                    [
                      mbps(limit.download) && `↓ ${mbps(limit.download)}`,
                      mbps(limit.upload) && `↑ ${mbps(limit.upload)}`,
                    ]
                      .filter(Boolean)
                      .join('  '),
                    limitWhen(limit, lang),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
            }
            value={limit ? (limit.enabled ? undefined : t('control:rules.off')) : t('control:limit.none')}
            icon="speed"
            chevron
            onPress={() => nav.push(`/network/traffic/limit${q}`)}
            testID="device-limit"
          />
        ) : null}
        {quotas.supported ? (
          <ListRow
            title={t('control:quota.row')}
            subtitle={
              used
                ? t('control:quota.usage', {
                    used: formatBytes(used.used),
                    limit: formatBytes(used.limit),
                    pct: Math.round(used.pct),
                  })
                : undefined
            }
            value={quota ? (quota.enabled ? undefined : t('control:rules.off')) : t('control:quota.none')}
            icon="chart"
            chevron
            onPress={() => nav.push(`/network/traffic/quota${q}`)}
            testID="device-quota"
          />
        ) : null}
        {notify.supported && trust.source === 'plugin' ? (
          <ListRow
            title={t('control:watch.row')}
            subtitle={t('control:watch.hint')}
            icon="bell"
            switchValue={trust.watched.has(mac)}
            onSwitch={(v) => void trust.setWatch(mac, v)}
          />
        ) : null}
      </ListSection>
      {dns.supported ? (
        <>
          {info.dnsEnabled ? <DestinationList mac={mac} start={start} end={end} limit={5} compact /> : null}
          <ListSection>
            <ListRow
              title={t('control:dest.more')}
              icon="globe"
              chevron
              onPress={() => nav.push(`/network/traffic/destinations${q}`)}
            />
            <ListRow
              title={t('control:dns.row')}
              icon="search"
              chevron
              onPress={() => nav.push(`/network/traffic/dns${q}`)}
              testID="device-dns"
            />
          </ListSection>
        </>
      ) : null}
    </>
  );
}
