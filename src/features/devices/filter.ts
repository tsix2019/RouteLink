import type { Client } from '@/api/services/clients';

export type StatusFilter = 'all' | 'online' | 'offline';
export type LinkFilter = 'all' | 'wifi' | 'wired';

export function filterClients(clients: Client[], query: string, status: StatusFilter, link: LinkFilter): Client[] {
  const q = query.trim().toLowerCase();
  return clients.filter((c) => {
    if (status === 'online' && !c.online) return false;
    if (status === 'offline' && c.online) return false;
    if (link === 'wifi' && c.connection !== 'wifi') return false;
    if (link === 'wired' && c.connection === 'wifi') return false;
    if (!q) return true;
    return [c.name, c.hostname, c.ipv4, c.mac, c.vendor].some((v) => v?.toLowerCase().includes(q));
  });
}
