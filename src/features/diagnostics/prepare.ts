import type { RouterConnection } from '@/api/connection/types';
import { getGroupClients, type GroupMember, type MemberRef } from '@/api/group';
import { getAgentStatus } from '@/api/services/agent';
import type { Client } from '@/api/services/clients';
import { getRadios } from '@/api/services/wireless';
import { checkNetwork, parseWifiFeatures, worstLevel, type SecurityLevel } from '@/features/wifi-tools/security';

import type { DiagnoseInput } from './diagnose';

/**
 * Everything the one-click diagnosis needs before it starts (DG-1): the group's devices, which of them is
 * this phone, whether the plugin runs, WF-4's verdict, and the phone-side checks. In demo mode the phone
 * side is simulated so nothing leaves the device.
 */

/** Phone-side HTTP 204 endpoints; any one answering 204 is enough. HTTPS only (no cleartext on Android). */
export const HTTP_204_URLS = [
  'https://connectivitycheck.gstatic.com/generate_204',
  'https://www.google.cn/generate_204',
  'https://cp.cloudflare.com/generate_204',
];

/** True when any of the URLs answers 204 within the timeout (design §18.1 "外网", plan decision 5). */
export async function checkHttp204(
  fetchFn: typeof fetch,
  urls: readonly string[] = HTTP_204_URLS,
  timeoutMs = 5_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await new Promise<boolean>((resolve) => {
      let pending = urls.length;
      if (!pending) resolve(false);
      for (const url of urls) {
        fetchFn(url, { cache: 'no-store', signal: controller.signal })
          .then((r) => r.status === 204)
          .catch(() => false)
          .then((ok) => {
            if (ok) resolve(true);
            else if (--pending === 0) resolve(false);
          });
      }
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** One phone → router round trip in ms (an HTTP request, plan decision 8), null when it failed. */
export function timedPing(ping: () => Promise<boolean>, now: () => number = Date.now): () => Promise<number | null> {
  return async () => {
    const started = now();
    try {
      return (await ping()) ? now() - started : null;
    } catch {
      return null;
    }
  };
}

/** WF-4's worst encryption level over the enabled access-point networks of every router given. */
export async function groupSecurityLevel(conns: RouterConnection[]): Promise<SecurityLevel | undefined> {
  const levels = await Promise.all(
    conns.map(async (conn) => {
      try {
        const [radios, features] = await Promise.all([
          getRadios(conn),
          conn
            .call('luci', 'getFeatures')
            .then(parseWifiFeatures)
            .catch(() => ({})),
        ]);
        return radios
          .filter((r) => !r.disabled)
          .flatMap((r) => r.networks)
          .filter((n) => !n.disabled && n.mode === 'ap')
          .map((n) => checkNetwork(n, features).level);
      } catch {
        return [];
      }
    }),
  );
  return worstLevel(levels.flat());
}

/** The demo's own phone, so the first segment has a signal to show. */
export const DEMO_PHONE = 'iPhone-16-Pro';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface PrepareDeps {
  gateway: RouterConnection;
  /** The active router (the group's gateway when it has access points). */
  gatewayRef: MemberRef;
  members: GroupMember[];
  /** The phone's own IPv4 address (native network info). */
  phoneIp: () => Promise<string | null>;
  /** The phone's HTTP 204 check; left out in demo mode. */
  http204?: () => Promise<boolean>;
  /** Waits in the simulated phone checks; tests pass a no-op. */
  wait?: (ms: number) => Promise<void>;
}

export interface Prepared {
  input: DiagnoseInput;
  clients: Client[];
}

export async function prepareDiagnosis(d: PrepareDeps): Promise<Prepared> {
  const demo = d.gateway.kind === 'demo';
  const wait = d.wait ?? sleep;
  const conns = [d.gateway, ...d.members.flatMap((m) => (m.connection ? [m.connection] : []))];
  const [clients, ownIp, plugin, securityLevel] = await Promise.all([
    getGroupClients(d.gateway, d.gatewayRef, d.members)
      .then((g) => g.clients)
      .catch((): Client[] => []),
    d.phoneIp().catch(() => null),
    getAgentStatus(d.gateway)
      .then((s) => s.state === 'ok')
      .catch(() => false),
    groupSecurityLevel(conns),
  ]);
  let phoneIp = ownIp ?? undefined;
  // The demo network does not contain the real phone: stand in its iPhone.
  if (demo && !clients.some((c) => c.ipv4 && c.ipv4 === phoneIp)) {
    phoneIp = clients.find((c) => c.hostname === DEMO_PHONE || c.name === DEMO_PHONE)?.ipv4;
  }
  let demoRound = 0;
  const input: DiagnoseInput = {
    gateway: d.gateway,
    members: d.members,
    clients,
    phoneIp,
    plugin,
    securityLevel,
    pingRouter: demo
      ? async () => {
          const ms = 6 + ((demoRound++ * 7) % 5);
          await wait(ms * 40);
          return ms;
        }
      : timedPing(() => d.gateway.ping()),
    http204: demo
      ? async () => {
          await wait(400);
          return true;
        }
      : d.http204,
  };
  return { input, clients };
}
