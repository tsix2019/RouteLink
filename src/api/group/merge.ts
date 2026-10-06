import { isRandomizedMac } from '@/utils/mac';
import { lookupVendor } from '@/utils/oui';

import type { Client } from '../services/clients';
import type { ApReport, ApStation } from './stations';

/** Merges a gateway's device list with what its access points report (design §14, NG-3). */

export interface MemberRef {
  id: string;
  name: string;
}

export interface MemberReport {
  member: MemberRef;
  /** null: the AP did not answer (offline, or its password is not known). */
  report: ApReport | null;
}

export interface GroupClients {
  clients: Client[];
  /** Access points that did not answer; their clients' Wi-Fi details are unknown. */
  offline: MemberRef[];
}

/** Where each client was last seen, per gateway, for this app session: shown while its AP is offline. */
export type LastSeenAp = Map<string, MemberRef & Pick<ApStation, 'band' | 'ssid'>>;

const wifiOf = (s: ApStation): NonNullable<Client['wifi']> => ({
  ifname: s.ifname,
  ssid: s.ssid,
  band: s.band,
  signal: s.signal,
  rxRate: s.rxRate,
  txRate: s.txRate,
  connectedSec: s.connectedSec,
  inactiveMs: s.inactiveMs,
  noise: s.noise,
});

/**
 * Identity, addresses and leases come from the gateway; Wi-Fi details from the AP the client is
 * associated with. While roaming two APs may both list a client: the one that heard from it last wins.
 */
export function mergeGroupClients(
  gateway: MemberRef,
  gatewayClients: Client[],
  reports: MemberReport[],
  lastSeen: LastSeenAp = new Map(),
): GroupClients {
  const best = new Map<string, { member: MemberRef; station: ApStation }>();
  const offer = (member: MemberRef, station: ApStation) => {
    const current = best.get(station.mac);
    if (!current || station.inactiveMs < current.station.inactiveMs) best.set(station.mac, { member, station });
  };

  for (const c of gatewayClients) {
    if (!c.wifi) continue;
    offer(gateway, {
      mac: c.mac,
      ifname: c.wifi.ifname,
      ssid: c.wifi.ssid,
      band: c.wifi.band,
      signal: c.wifi.signal,
      inactiveMs: c.wifi.inactiveMs ?? 0,
      connectedSec: c.wifi.connectedSec,
      rxRate: c.wifi.rxRate,
      txRate: c.wifi.txRate,
      noise: c.wifi.noise,
    });
  }
  const offline: MemberRef[] = [];
  for (const { member, report } of reports) {
    if (!report) {
      offline.push(member);
      continue;
    }
    for (const s of report.stations) offer(member, s);
  }
  const offlineIds = new Set(offline.map((m) => m.id));

  const byMac = new Map(gatewayClients.map((c) => [c.mac, c]));
  const merged: Client[] = gatewayClients.map((c) => {
    const pick = best.get(c.mac);
    if (pick) {
      lastSeen.set(c.mac, { ...pick.member, band: pick.station.band, ssid: pick.station.ssid });
      return {
        ...c,
        wifi: wifiOf(pick.station),
        connection: 'wifi',
        online: true,
        onlineSource: 'wifi',
        ap: { routerId: pick.member.id, name: pick.member.name, band: pick.station.band, ssid: pick.station.ssid },
      };
    }
    const last = lastSeen.get(c.mac);
    if (last && offlineIds.has(last.id)) {
      // Its AP is offline: the gateway alone can't tell how it is connected now.
      return {
        ...c,
        wifi: undefined,
        connection: 'wifi',
        ap: { routerId: last.id, name: last.name, band: last.band, ssid: last.ssid, stale: true },
      };
    }
    return c;
  });

  // Associated to an AP but unknown to the gateway (static address it has not seen yet, another subnet).
  for (const [mac, { member, station }] of best) {
    if (byMac.has(mac)) continue;
    lastSeen.set(mac, { ...member, band: station.band, ssid: station.ssid });
    const vendor = lookupVendor(mac);
    merged.push({
      mac,
      name: vendor ?? mac,
      vendor,
      randomizedMac: isRandomizedMac(mac),
      ipv6: [],
      online: true,
      onlineSource: 'wifi',
      connection: 'wifi',
      wifi: wifiOf(station),
      ap: { routerId: member.id, name: member.name, band: station.band, ssid: station.ssid },
      isStatic: false,
      isBlocked: false,
    });
  }

  merged.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return { clients: merged, offline };
}
