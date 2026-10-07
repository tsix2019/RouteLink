import type { Band } from '@/api/services/clients';
import { needsKey, networkChanges, type Radio, type WifiNetwork } from '@/api/services/wireless';
import type { ApplyMode } from '@/api/uci';
import type { UbusCall } from '@/api/ubus/types';

/**
 * Same-name SSIDs across a network group (design §14 NG-4): clients roam between APs only when name,
 * encryption and password match, so an edit of one is offered to all of them. Every router applies its
 * part through its own WL-2 flow (rollback unless the phone is on one of the changed networks).
 */

export interface RouterRadios {
  routerId: string;
  name: string;
  radios?: Radio[];
}

export interface Twin {
  routerId: string;
  routerName: string;
  band: Band;
  network: WifiNetwork;
}

/** Access-point networks named `ssid` anywhere in the group, except `self`. */
export function ssidTwins(groups: RouterRadios[], ssid: string, self: { routerId: string; section: string }): Twin[] {
  if (!ssid) return [];
  return groups.flatMap((g) =>
    (g.radios ?? []).flatMap((r) =>
      r.networks
        .filter((n) => n.mode === 'ap' && n.ssid === ssid)
        .filter((n) => !(g.routerId === self.routerId && n.section === self.section))
        .map((network) => ({ routerId: g.routerId, routerName: g.name, band: r.band, network })),
    ),
  );
}

export interface SyncFields {
  ssid: string;
  encryption: string;
  key?: string;
}

/** The fields that have to match for roaming: what the twins are set to. */
export const syncFields = (p: SyncFields): SyncFields => ({
  ssid: p.ssid,
  encryption: p.encryption,
  key: needsKey(p.encryption) ? p.key : undefined,
});

/** Twins that differ from the new values at all (an identical one needs no apply). */
export const twinsToChange = (twins: Twin[], fields: SyncFields): Twin[] =>
  twins.filter((t) => networkChanges(t.network, syncFields(fields)).length > 0);

export interface SyncStep {
  routerId: string;
  changes: UbusCall[];
  mode: ApplyMode;
  /** wifi-iface sections changed on this router. */
  sections: string[];
}

/**
 * One apply per router. Routers where the phone is on a changed network go last and without rollback:
 * after them the phone may be offline until it rejoins.
 */
export function syncPlan(
  primary: { routerId: string; network: WifiNetwork; changes: UbusCall[] },
  twins: Twin[],
  fields: SyncFields,
  phoneOn: (routerId: string, ifname?: string) => boolean,
): SyncStep[] {
  const byRouter = new Map<string, { changes: UbusCall[]; sections: string[]; phone: boolean }>();
  const add = (routerId: string, network: WifiNetwork, changes: UbusCall[]) => {
    if (!changes.length) return;
    const step = byRouter.get(routerId) ?? { changes: [], sections: [], phone: false };
    step.changes.push(...changes);
    step.sections.push(network.section);
    step.phone ||= phoneOn(routerId, network.ifname);
    byRouter.set(routerId, step);
  };
  add(primary.routerId, primary.network, primary.changes);
  for (const t of twins) add(t.routerId, t.network, networkChanges(t.network, syncFields(fields)));
  return [...byRouter.entries()]
    .map(([routerId, s]) => ({
      routerId,
      changes: s.changes,
      sections: s.sections,
      mode: (s.phone ? 'direct' : 'rollback') as ApplyMode,
    }))
    .sort((a, b) => Number(a.mode === 'direct') - Number(b.mode === 'direct'));
}
