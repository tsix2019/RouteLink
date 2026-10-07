import type { Band } from '@/api/services/clients';
import { networkChanges, type WifiNetwork } from '@/api/services/wireless';
import {
  ssidTwins,
  syncFields,
  syncPlan,
  twinsToChange,
  type RouterRadios,
  type SyncStep,
  type Twin,
} from '@/features/wireless/ssidSync';

import {
  byRisk,
  checkNetwork,
  fixChanges,
  fixNeedsKey,
  type SecurityFix,
  type SecurityReport,
  type WifiFeatures,
} from './security';

/** The security check over a whole network group (design §17.4, WF-4). */

export interface NetworkCheck extends SecurityReport {
  routerId: string;
  routerName: string;
  band: Band;
  network: WifiNetwork;
  /** The phone is connected to this network. */
  phone: boolean;
  /** What the router's hostapd supports; `sae` unknown on old LuCI. */
  features: WifiFeatures;
}

export type PhoneOn = (routerId: string, ifname?: string) => boolean;

/** Every enabled access-point network of every router that answered, worst first. */
export function checkGroup(
  groups: RouterRadios[],
  features: Readonly<Record<string, WifiFeatures>>,
  phoneOn: PhoneOn,
): NetworkCheck[] {
  return groups
    .flatMap((g) =>
      (g.radios ?? [])
        .filter((r) => !r.disabled)
        .flatMap((r) =>
          r.networks
            .filter((n) => n.mode === 'ap' && !n.disabled)
            .map((network) => {
              const f = features[g.routerId] ?? {};
              return {
                ...checkNetwork(network, f),
                routerId: g.routerId,
                routerName: g.name,
                band: r.band,
                network,
                phone: phoneOn(g.routerId, network.ifname),
                features: f,
              };
            }),
        ),
    )
    .sort((a, b) => byRisk(a, b) || a.ssid.localeCompare(b.ssid));
}

/** The encryption a network ends up with after the chosen fixes. */
export function encryptionAfter(n: WifiNetwork, fixes: SecurityFix[]): string {
  if (fixes.includes('upgrade-wpa3')) return 'sae-mixed';
  if (fixes.includes('upgrade-wpa2')) return 'psk2+ccmp';
  return n.encryption;
}

export interface FixPlan {
  /** One safe apply per router (ssidSync.syncPlan); empty when nothing changes. */
  steps: SyncStep[];
  /** Same-name networks elsewhere in the group whose security would then differ. */
  twins: Twin[];
  /** A step changes the phone's own network: applied without rollback. */
  phoneDrops: boolean;
  /** The phone has to join again with new credentials (encryption or password changed under it). */
  rejoin: boolean;
  /** The chosen fixes set a new password. */
  newKey: boolean;
}

/**
 * The fixes for one network as WL-2 applies, optionally with the same encryption and password for its
 * same-name networks in the group (roaming needs them to match).
 */
export function planFix(
  check: Pick<NetworkCheck, 'routerId' | 'network'>,
  fixes: SecurityFix[],
  key: string | undefined,
  groups: RouterRadios[],
  phoneOn: PhoneOn,
  sync: boolean,
): FixPlan {
  const n = check.network;
  const newKey = fixes.some((f) => fixNeedsKey(n, f));
  const changes = fixChanges(n, fixes, newKey ? key : undefined);
  const fields = syncFields({ ssid: n.ssid, encryption: encryptionAfter(n, fixes), key: newKey ? key : n.key });
  const credentials = networkChanges(n, fields).length > 0;
  const twins = credentials
    ? twinsToChange(ssidTwins(groups, n.ssid, { routerId: check.routerId, section: n.section }), fields)
    : [];
  const steps = syncPlan({ routerId: check.routerId, network: n, changes }, sync ? twins : [], fields, phoneOn);
  const phoneDrops = steps.some((s) => s.mode === 'direct');
  return { steps, twins, phoneDrops, rejoin: phoneDrops && credentials, newKey };
}
