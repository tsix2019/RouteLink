import type { RouterConnection } from '../connection/types';
import { parseStations as parsePluginStations, type AgentStation } from '../services/agent-wifi';
import { bandOfFreq, parseStations, parseWifiIfaces, type Band, type WifiIface } from '../services/clients';
import type { UbusResult } from '../ubus/types';

/** One access point's view of its wireless clients (NG-3). */

export interface ApStation {
  mac: string;
  ifname: string;
  ssid: string;
  band: Band;
  signal: number;
  inactiveMs: number;
  connectedSec?: number;
  /** kbit/s */
  rxRate?: number;
  txRate?: number;
  noise?: number;
  /** Plugin-only details. */
  plugin?: AgentStation;
}

export interface ApReport {
  /** `plugin`: routelink stations; `iwinfo`: LuCI's assoclist. */
  source: 'plugin' | 'iwinfo';
  ifaces: WifiIface[];
  stations: ApStation[];
}

const data = <T>(r: UbusResult | undefined): T | undefined => (r?.ok ? (r.data as T) : undefined);

/** Stations from the plugin when it samples this AP, otherwise from iwinfo (one more request). */
export async function getApStations(conn: RouterConnection): Promise<ApReport> {
  const [plugin, wireless] = await conn.batch([
    { object: 'routelink', method: 'stations' },
    { object: 'luci-rpc', method: 'getWirelessDevices' },
  ]);
  const ifaces = parseWifiIfaces(data<Parameters<typeof parseWifiIfaces>[0]>(wireless) ?? {});

  if (plugin.ok) {
    const p = parsePluginStations(plugin.data);
    // A plugin without the wifi module (0.1.0, or a gateway with it switched off) reports no interfaces.
    if (p.interfaces.length || !ifaces.length) {
      const byIf = new Map(p.interfaces.map((i) => [i.ifname, i]));
      return {
        source: 'plugin',
        ifaces: p.interfaces.length
          ? p.interfaces.map((i) => ({
              radio: ifaces.find((w) => w.ifname === i.ifname)?.radio ?? i.phy,
              section: ifaces.find((w) => w.ifname === i.ifname)?.section ?? i.ifname,
              ifname: i.ifname,
              ssid: i.ssid,
              band: bandOfFreq(i.freq),
            }))
          : ifaces,
        stations: p.stations.map((s) => {
          const iface = byIf.get(s.ifname);
          return {
            mac: s.mac,
            ifname: s.ifname,
            ssid: iface?.ssid ?? ifaces.find((w) => w.ifname === s.ifname)?.ssid ?? '',
            band: bandOfFreq(s.freq || iface?.freq || 0),
            signal: s.signal,
            inactiveMs: s.inactiveMs,
            connectedSec: s.connectedSec,
            rxRate: s.rxRate,
            txRate: s.txRate,
            noise: s.noise ?? iface?.noise,
            plugin: s,
          };
        }),
      };
    }
  }

  const assoc = ifaces.length
    ? await conn.batch(ifaces.map((w) => ({ object: 'iwinfo', method: 'assoclist', params: { device: w.ifname } })))
    : [];
  return {
    source: 'iwinfo',
    ifaces,
    stations: ifaces.flatMap((w, i) =>
      parseStations(data(assoc[i])).map((s) => ({
        mac: s.mac.toUpperCase(),
        ifname: w.ifname,
        ssid: w.ssid,
        band: w.band,
        signal: s.signal,
        inactiveMs: s.inactiveMs,
        connectedSec: s.connectedSec,
        rxRate: s.rxRate,
        txRate: s.txRate,
        noise: s.noise,
      })),
    ),
  };
}
