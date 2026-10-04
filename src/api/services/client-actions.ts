import { isIPv4 } from '@/utils/net';

import type { RouterConnection } from '../connection/types';
import { stageAndApply, uci, type ApplyOptions, type ApplyOutcome, type UciValues } from '../uci';
import type { UbusCall } from '../ubus/types';
import { ActionError } from './action-error';
import { ALIAS_OPTION, BLOCK_RULE_PREFIX, type Client } from './clients';

type Tuning = Omit<ApplyOptions, 'mode'>;

/** A single DNS label: dnsmasq accepts it as a DHCP host name. */
export const isDnsSafeName = (s: string): boolean => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(s);

/**
 * DNS-safe names go into the dhcp host `name` (visible in LuCI and DNS); anything else (spaces, CJK)
 * goes into ALIAS_OPTION, because dnsmasq refuses to start on an invalid host name.
 */
export function renameChanges(client: Client, newName: string): UbusCall[] {
  const name = newName.trim();
  if (!name) throw new ActionError('name-empty');
  if (name.length > 64) throw new ActionError('name-too-long');
  const dnsSafe = isDnsSafeName(name);
  const values: UciValues = dnsSafe ? { name } : { [ALIAS_OPTION]: name };
  if (!client.hostSection) return [uci.add('dhcp', 'host', { mac: client.mac, ...values })];
  const calls = [uci.set('dhcp', client.hostSection, values)];
  if (dnsSafe && client.aliasSource === 'custom') calls.push(uci.delOption('dhcp', client.hostSection, ALIAS_OPTION));
  return calls;
}

export function staticIpChanges(client: Client, ip: string, clients: Client[]): UbusCall[] {
  const addr = ip.trim();
  if (!isIPv4(addr)) throw new ActionError('ip-invalid');
  if (clients.some((c) => c.mac !== client.mac && c.staticIp === addr)) throw new ActionError('ip-in-use');
  if (client.hostSection) return [uci.set('dhcp', client.hostSection, { ip: addr })];
  const name: UciValues = client.hostname && isDnsSafeName(client.hostname) ? { name: client.hostname } : {};
  return [uci.add('dhcp', 'host', { mac: client.mac, ip: addr, ...name })];
}

export function removeStaticIpChanges(client: Client): UbusCall[] {
  if (!client.hostSection || !client.staticIp) throw new ActionError('not-static');
  // Keep the section when it still carries a name; otherwise remove it entirely.
  return client.alias ? [uci.delOption('dhcp', client.hostSection, 'ip')] : [uci.del('dhcp', client.hostSection)];
}

/** Forward rule across all zones: the device keeps LAN access to the router but cannot reach anything else. */
export function blockChanges(client: Client): UbusCall[] {
  if (client.isBlocked) throw new ActionError('already-blocked');
  return [
    uci.add('firewall', 'rule', {
      name: `${BLOCK_RULE_PREFIX}${client.mac}`,
      src: '*',
      dest: '*',
      src_mac: [client.mac],
      proto: 'all',
      target: 'REJECT',
    }),
  ];
}

export function unblockChanges(client: Client): UbusCall[] {
  if (!client.blockSection) throw new ActionError('not-blocked');
  return [uci.del('firewall', client.blockSection)];
}

const apply = (conn: RouterConnection, changes: UbusCall[], t?: Tuning) =>
  stageAndApply(conn, changes, { mode: 'rollback', ...t });

export const renameClient = (conn: RouterConnection, client: Client, name: string, t?: Tuning): Promise<ApplyOutcome> =>
  apply(conn, renameChanges(client, name), t);

export const setStaticIp = (conn: RouterConnection, client: Client, ip: string, clients: Client[], t?: Tuning) =>
  apply(conn, staticIpChanges(client, ip, clients), t);

export const removeStaticIp = (conn: RouterConnection, client: Client, t?: Tuning) =>
  apply(conn, removeStaticIpChanges(client), t);

export const blockClient = (conn: RouterConnection, client: Client, t?: Tuning) => apply(conn, blockChanges(client), t);

export const unblockClient = (conn: RouterConnection, client: Client, t?: Tuning) =>
  apply(conn, unblockChanges(client), t);

/** Deauthenticates a Wi-Fi client; `banMinutes` keeps it from reconnecting for a while. */
export async function kickClient(conn: RouterConnection, client: Client, banMinutes = 0): Promise<void> {
  if (!client.wifi) throw new ActionError('not-wireless');
  await conn.call(`hostapd.${client.wifi.ifname}`, 'del_client', {
    addr: client.mac.toLowerCase(),
    reason: 5,
    deauth: true,
    ban_time: banMinutes * 60_000,
  });
}

export interface WolOptions {
  /** etherwake is installed and permitted (capability clients.wol.router). */
  routerSide: boolean;
  /** LAN device to send on, usually br-lan. */
  lanDevice?: string;
  /** Phone-side broadcast (Android only). */
  sendFromPhone?: (mac: string) => Promise<void>;
}

export async function wakeOnLan(conn: RouterConnection, mac: string, o: WolOptions): Promise<'router' | 'phone'> {
  if (o.routerSide) {
    const r = await conn.call<{ code?: number; stderr?: string }>('file', 'exec', {
      command: '/usr/bin/etherwake',
      params: ['-D', '-i', o.lanDevice ?? 'br-lan', mac],
    });
    if (r.code !== 0) throw new ActionError('wol-failed', r.stderr || `etherwake exited with ${r.code}`);
    return 'router';
  }
  if (o.sendFromPhone) {
    await o.sendFromPhone(mac);
    return 'phone';
  }
  throw new ActionError('wol-unavailable');
}
