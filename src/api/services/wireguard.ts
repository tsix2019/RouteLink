import type { RouterConnection } from '../connection/types';
import { UbusError } from '../ubus/errors';

export interface WgPeer {
  /** uci `description` of the peer, when it has one. */
  name?: string;
  publicKey: string;
  /** Where the peer was last seen ("198.51.100.7:40211"); unset before the first handshake. */
  endpoint?: string;
  allowedIps: string[];
  /** Epoch seconds; unset when there was none. */
  latestHandshake?: number;
  rx: number;
  tx: number;
  /** Persistent keepalive in seconds, when set. */
  keepalive?: number;
}

export interface WgInterface {
  name: string;
  publicKey: string;
  listenPort?: number;
  peers: WgPeer[];
}

const positive = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' && v !== '(none)' && v !== 'off' ? v : undefined;

/** `luci.wireguard getWgInstances` (luci-proto-wireguard): `wg show all dump` per interface. */
export function parseWgInstances(raw: unknown): WgInterface[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: WgInterface[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const i = value as Record<string, unknown> | null;
    if (!i || typeof i !== 'object') continue;
    const iface: WgInterface = {
      name: text(i.name) ?? key,
      publicKey: text(i.public_key) ?? '',
      peers: (Array.isArray(i.peers) ? i.peers : []).flatMap((p: Record<string, unknown> | null) => {
        if (!p || typeof p.public_key !== 'string') return [];
        const peer: WgPeer = {
          publicKey: p.public_key,
          allowedIps: Array.isArray(p.allowed_ips) ? p.allowed_ips.map(String) : [],
          rx: positive(p.transfer_rx) ?? 0,
          tx: positive(p.transfer_tx) ?? 0,
        };
        const name = text(p.name);
        const endpoint = text(p.endpoint);
        const handshake = positive(p.latest_handshake);
        const keepalive = positive(p.persistent_keepalive);
        if (name) peer.name = name;
        if (endpoint) peer.endpoint = endpoint;
        if (handshake) peer.latestHandshake = handshake;
        if (keepalive) peer.keepalive = keepalive;
        return [peer];
      }),
    };
    const port = positive(i.listen_port);
    if (port) iface.listenPort = port;
    out.push(iface);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Without luci-proto-wireguard the object doesn't exist: no tunnels to show. */
export async function getWireGuard(conn: RouterConnection): Promise<WgInterface[]> {
  try {
    return parseWgInstances(await conn.call('luci.wireguard', 'getWgInstances'));
  } catch (error) {
    if (error instanceof UbusError && error.code === 'NOT_FOUND') return [];
    throw error;
  }
}

/** WireGuard renews its session every two minutes: an older handshake means the peer is gone. */
export const peerConnected = (peer: WgPeer, nowSec: number): boolean =>
  !!peer.latestHandshake && nowSec - peer.latestHandshake <= 180;
