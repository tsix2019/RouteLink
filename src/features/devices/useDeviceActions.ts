import RouteLinkNative from 'routelink-native';
import { Platform } from 'react-native';

import { isAvailable } from '@/api/capabilities';
import { toNativeError } from '@/api/http/errors';
import { ActionError } from '@/api/services/action-error';
import {
  blockClient,
  kickClient,
  removeStaticIp,
  renameClient,
  setStaticIp,
  unblockClient,
  wakeOnLan,
} from '@/api/services/client-actions';
import type { Client } from '@/api/services/clients';
import type { ApplyOutcome } from '@/api/uci';
import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useCapabilities, useInterfaces, useRouterMutation } from '@/hooks/router-queries';
import { useT } from '@/i18n';
import { describeError } from '@/ui/errorText';
import { useToast } from '@/ui/Toast';

const CLIENTS = [['clients']] as const;

/** Device actions with result toasts; every uci change goes through safe apply. */
export function useDeviceActions() {
  const t = useT();
  const toast = useToast();
  const caps = useCapabilities();
  const lanDevice = useInterfaces().data?.find((i) => i.name === 'lan')?.device;
  const { router, group } = useActiveRouter();

  const report = (outcome: ApplyOutcome) =>
    outcome.status === 'rolled-back'
      ? toast(t('devices:result.rolledBack'), 'warning')
      : toast(t('devices:result.applied'));
  const fail = (error: unknown) => toast(describeError(t, error).title, 'error');

  const rename = useRouterMutation(
    (conn, a: { client: Client; name: string }) => renameClient(conn, a.client, a.name),
    CLIENTS,
  );
  const reserve = useRouterMutation(
    (conn, a: { client: Client; ip: string; clients: Client[] }) => setStaticIp(conn, a.client, a.ip, a.clients),
    CLIENTS,
  );
  const release = useRouterMutation((conn, client: Client) => removeStaticIp(conn, client), CLIENTS);
  const block = useRouterMutation((conn, client: Client) => blockClient(conn, client), CLIENTS);
  const unblock = useRouterMutation((conn, client: Client) => unblockClient(conn, client), CLIENTS);
  // NG-5: a station is kicked on the access point it is associated with.
  const kick = useRouterMutation((conn, a: { client: Client; ban: boolean }) => {
    const apId = a.client.ap?.routerId;
    const target = !apId || apId === router?.id ? conn : group.members.find((m) => m.id === apId)?.connection;
    if (!target) throw new ActionError('ap-unreachable');
    return kickClient(target, a.client, a.ban ? 5 : 0);
  }, CLIENTS);
  const wake = useRouterMutation(
    (conn, mac: string) =>
      wakeOnLan(conn, mac, {
        routerSide: isAvailable(caps.data, 'clients.wol.router'),
        lanDevice,
        sendFromPhone:
          Platform.OS === 'android'
            ? async (m) => {
                try {
                  await RouteLinkNative.sendWakeOnLan(m);
                } catch (e) {
                  throw toNativeError(e);
                }
              }
            : undefined,
      }),
    CLIENTS,
  );

  return {
    busy: [rename, reserve, release, block, unblock, kick, wake].some((m) => m.isPending),
    rename: (client: Client, name: string) => rename.mutate({ client, name }, { onSuccess: report, onError: fail }),
    reserve: (client: Client, ip: string, clients: Client[]) =>
      reserve.mutate({ client, ip, clients }, { onSuccess: report, onError: fail }),
    release: (client: Client) => release.mutate(client, { onSuccess: report, onError: fail }),
    block: (client: Client) => block.mutate(client, { onSuccess: report, onError: fail }),
    unblock: (client: Client) => unblock.mutate(client, { onSuccess: report, onError: fail }),
    kick: (client: Client, ban: boolean) =>
      kick.mutate({ client, ban }, { onSuccess: () => toast(t('devices:result.applied')), onError: fail }),
    wake: (mac: string) =>
      wake.mutate(mac, {
        onSuccess: (via) => toast(via === 'phone' ? t('devices:result.wokenByPhone') : t('devices:result.woken')),
        onError: fail,
      }),
  };
}
