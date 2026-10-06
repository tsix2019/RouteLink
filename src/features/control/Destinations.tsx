import { useRouter } from 'expo-router';

import { agentDestinations } from '@/api/services/agent-control';
import { AGENT_KEY } from '@/hooks/agent-queries';
import { useRouterQuery } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { Banner, EmptyState, Skeleton } from '@/ui/Feedback';
import { ListRow, ListSection } from '@/ui/ListSection';
import { formatBytes } from '@/utils/format';

/** TR-8: shown instead of destinations while DNS logging is off. */
export function NeedsDns() {
  const t = useT();
  const nav = useRouter();
  return (
    <Banner
      tone="info"
      text={t('control:dest.needsDns')}
      action={{ label: t('control:dns.enable'), onPress: () => nav.push('/network/traffic/dns') }}
    />
  );
}

/** Destinations of a device ranked by traffic; `compact` for the top few on its traffic page. */
export function DestinationList({
  mac,
  start,
  end,
  limit = 100,
  compact,
}: {
  mac: string;
  start: number;
  end: number;
  limit?: number;
  compact?: boolean;
}) {
  const t = useT();
  const q = useRouterQuery([AGENT_KEY, 'destinations', mac, start, end, limit], (c) =>
    agentDestinations(c, { mac, start, end, limit }),
  );
  if (!q.data) return <Skeleton height={compact ? 120 : 240} radius={16} />;
  if (!q.data.length) return compact ? null : <EmptyState icon="globe" title={t('control:dest.empty')} />;
  const total = q.data.reduce((s, d) => s + d.rx + d.tx, 0) || 1;
  return (
    <ListSection
      title={compact ? t('control:dest.top') : undefined}
      footer={compact ? undefined : t('control:dest.encryptedHint')}>
      {q.data.map((d) => (
        <ListRow
          key={`${d.host ?? ''}-${d.ip}`}
          title={d.host ?? d.ip}
          subtitle={[d.host ? d.ip : t('control:dest.unknownHost'), t('control:dest.conns', { count: d.conns })].join(
            ' · ',
          )}
          value={`${formatBytes(d.rx + d.tx)} · ${Math.round(((d.rx + d.tx) / total) * 100)}%`}
          icon="globe"
        />
      ))}
    </ListSection>
  );
}
