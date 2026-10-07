import { useRouter } from 'expo-router';
import { useState } from 'react';

import { apsOf, gatewayOf, roleOf } from '@/api/group';
import { useT } from '@/i18n';
import { sortedRouters, useRouters, type RouterProfile } from '@/state/routers';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { ListRow, ListSection } from '@/ui/ListSection';
import { useToast } from '@/ui/Toast';

/** Moves a router into a role, keeping the group consistent (NG-1). */
export function useSetRole() {
  const update = useRouters((s) => s.update);
  return async (profile: RouterProfile, role: 'standalone' | 'gateway' | { gatewayId: string }) => {
    // Fresh state: callers may have just added routers.
    const routers = useRouters.getState().routers;
    // A gateway that stops being one sets its access points free.
    if (roleOf(profile) === 'gateway' && role !== 'gateway') {
      for (const ap of apsOf(routers, profile.id)) await update(ap.id, { role: 'standalone', gatewayId: undefined });
    }
    if (typeof role === 'object') {
      const gateway = routers.find((r) => r.id === role.gatewayId);
      if (gateway && roleOf(gateway) !== 'gateway') await update(gateway.id, { role: 'gateway', gatewayId: undefined });
      await update(profile.id, { role: 'ap', gatewayId: role.gatewayId });
    } else {
      await update(profile.id, { role, gatewayId: undefined });
    }
  };
}

/** "Network group" on a router's settings page: its role, and the access points of a gateway. */
export function GroupSection({ profile }: { profile: RouterProfile }) {
  const t = useT();
  const nav = useRouter();
  const toast = useToast();
  const routers = sortedRouters(useRouters((s) => s.routers));
  const setRole = useSetRole();
  const [picking, setPicking] = useState(false);

  const role = roleOf(profile);
  const gateway = gatewayOf(routers, profile);
  const aps = role === 'gateway' ? apsOf(routers, profile.id) : [];
  const value =
    role === 'gateway'
      ? t('routers:group.gateway')
      : role === 'ap' && gateway
        ? t('routers:group.apOf', { name: gateway.name })
        : t('routers:group.standalone');

  const choose = (next: Parameters<typeof setRole>[1]) => {
    setPicking(false);
    void setRole(profile, next).then(() => toast(t('routers:group.saved')));
  };
  const actions: SheetAction[] = [
    { label: t('routers:group.standalone'), icon: 'router', onPress: () => choose('standalone') },
    { label: t('routers:group.gateway'), icon: 'router', onPress: () => choose('gateway') },
    ...routers
      .filter((r) => r.id !== profile.id && roleOf(r) !== 'ap')
      .map((r) => ({
        label: t('routers:group.joinAs', { name: r.name }),
        icon: 'accessPoint' as const,
        onPress: () => choose({ gatewayId: r.id }),
      })),
  ];

  return (
    <>
      <ListSection title={t('routers:group.section')} footer={t('routers:group.footer')}>
        <ListRow
          title={t('routers:group.role')}
          value={value}
          icon="accessPoint"
          chevron
          onPress={() => setPicking(true)}
          testID="router-role"
        />
        {aps.map((ap) => (
          <ListRow
            key={ap.id}
            title={ap.name}
            subtitle={t('routers:group.apTag')}
            icon="wifi"
            chevron
            onPress={() => nav.push(`/more/router/${encodeURIComponent(ap.id)}`)}
          />
        ))}
      </ListSection>
      <ActionSheet
        visible={picking}
        title={t('routers:group.role')}
        actions={actions}
        onCancel={() => setPicking(false)}
      />
    </>
  );
}
