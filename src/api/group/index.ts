import type { RouterConnection } from '../connection/types';
import { getClients } from '../services/clients';
import { mergeGroupClients, type GroupClients, type LastSeenAp, type MemberRef } from './merge';
import { getApStations, type ApReport } from './stations';

export * from './members';
export * from './merge';
export * from './stations';

/** An access point of the active gateway; `connection` is null while its password is unknown. */
export interface GroupMember extends MemberRef {
  connection: RouterConnection | null;
  isDemo?: boolean;
}

const lastSeenByGateway = new Map<string, LastSeenAp>();

/** Reads every AP in parallel; one that fails counts as offline instead of failing the whole list. */
export async function getMemberReports(
  members: GroupMember[],
): Promise<{ member: MemberRef; report: ApReport | null }[]> {
  return Promise.all(
    members.map(async (m) => ({
      member: { id: m.id, name: m.name },
      report: m.connection ? await getApStations(m.connection).catch(() => null) : null,
    })),
  );
}

/** The gateway's device list merged with its access points' clients. */
export async function getGroupClients(
  conn: RouterConnection,
  gateway: MemberRef,
  members: GroupMember[],
): Promise<GroupClients> {
  const [clients, reports] = await Promise.all([getClients(conn), getMemberReports(members)]);
  if (!members.length) return { clients, offline: [] };
  let lastSeen = lastSeenByGateway.get(gateway.id);
  if (!lastSeen) lastSeenByGateway.set(gateway.id, (lastSeen = new Map()));
  return mergeGroupClients(gateway, clients, reports, lastSeen);
}
