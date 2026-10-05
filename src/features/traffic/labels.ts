import type { AgentDevice } from '@/api/services/agent';
import type { Client } from '@/api/services/clients';
import { deviceIcon } from '@/features/devices/deviceIcon';
import { useAgentDevices } from '@/hooks/agent-queries';
import { useClients } from '@/hooks/router-queries';
import type { IconName } from '@/ui/Icon';

export interface DeviceLabel {
  mac: string;
  name: string;
  /** IP address, or the MAC when there is none. */
  detail: string;
  icon: IconName;
  online?: boolean;
  client?: Client;
}

/**
 * Names for MACs: the app's device list first (names set in the app, DHCP hostnames, vendors), then what
 * the plugin knows (devices that have left the network since), then the MAC itself.
 */
export function labelFor(mac: string, clients: readonly Client[] = [], agent: readonly AgentDevice[] = []): DeviceLabel {
  const client = clients.find((c) => c.mac === mac);
  const known = agent.find((d) => d.mac === mac);
  const name = client?.name || known?.name || known?.hostname || mac;
  const ip = client?.ipv4 ?? known?.ipv4[0];
  return {
    mac,
    name,
    detail: ip ?? mac,
    icon: deviceIcon(client ?? { name, hostname: known?.hostname, vendor: null, connection: 'unknown' }),
    online: client?.online ?? known?.online,
    client,
  };
}

export function useDeviceLabels(): (mac: string) => DeviceLabel {
  const clients = useClients().data;
  const agent = useAgentDevices(true).data;
  return (mac) => labelFor(mac, clients, agent);
}
