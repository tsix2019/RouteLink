import { useRouter } from 'expo-router';

import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useGroupClients } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { Banner } from '@/ui/Feedback';

/** NG-5: access points of the group that did not answer; their clients show without Wi-Fi details. */
export function GroupBanner() {
  const t = useT();
  const nav = useRouter();
  const { group } = useActiveRouter();
  const clients = useGroupClients();
  const offline = clients.data?.offline ?? [];
  if (!group.members.length || !offline.length) return null;
  return (
    <>
      {offline.map((m) => {
        const needsPassword = !group.members.find((x) => x.id === m.id)?.connection;
        return (
          <Banner
            key={m.id}
            tone="warning"
            text={t(needsPassword ? 'devices:group.needsPassword' : 'devices:group.offline', { name: m.name })}
            action={
              needsPassword
                ? {
                    label: t('devices:group.enterPassword'),
                    onPress: () => nav.push(`/more/router/${encodeURIComponent(m.id)}`),
                  }
                : { label: t('devices:group.retry'), onPress: () => void clients.refetch() }
            }
          />
        );
      })}
    </>
  );
}
