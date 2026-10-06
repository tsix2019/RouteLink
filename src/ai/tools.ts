import type { RouterConnection } from '@/api/connection/types';
import { blockClient, kickClient, unblockClient } from '@/api/services/client-actions';
import { getClients, type Client } from '@/api/services/clients';
import { getConnections } from '@/api/services/conntrack';
import { forwardConflicts, getFirewall, portForwardChanges, validatePortForward } from '@/api/services/firewall';
import { systemLog } from '@/api/services/logs';
import { getInterfaces } from '@/api/services/network';
import { isCritical, listServices, serviceAction } from '@/api/services/services';
import { getSystem, reboot } from '@/api/services/system';
import { getRadios, networkChanges, radioChanges, validateNetwork } from '@/api/services/wireless';
import { stageAndApply, type ApplyOptions, type ApplyOutcome } from '@/api/uci';

import { ipOut, macOut, nameOut, scrubText, stripSecrets, type Privacy } from './redact';
import type { ToolSchema } from './types';

/** Design §18: read-only tools run at once; every write asks first (medium risk, §10); nothing high-risk. */
export type ToolRisk = 'read' | 'medium';

export interface ToolContext {
  conn: RouterConnection;
  privacy: Privacy;
  /** Device codes ("d3") the AI uses instead of MAC addresses; kept on the phone, per conversation. */
  refs: DeviceRefs;
  /** Apply timing (tests skip the waits). */
  tuning?: Omit<ApplyOptions, 'mode'>;
}

export interface Tool extends ToolSchema {
  risk: ToolRisk;
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
}

/** Stable codes for devices, so the AI can name a device it saw only with a masked MAC (or none). */
export class DeviceRefs {
  constructor(private readonly byRef: Record<string, string> = {}) {}

  refOf(mac: string): string {
    const key = mac.toUpperCase();
    const found = Object.entries(this.byRef).find(([, m]) => m === key);
    if (found) return found[0];
    const ref = `d${Object.keys(this.byRef).length + 1}`;
    this.byRef[ref] = key;
    return ref;
  }

  macOf(ref: unknown): string | undefined {
    return typeof ref === 'string' ? this.byRef[ref.trim().toLowerCase()] : undefined;
  }

  toJSON(): Record<string, string> {
    return { ...this.byRef };
  }
}

/** A failure the AI should read and explain (wrong device code, invalid port, …). */
export class ToolInputError extends Error {}

const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const DEVICE = { type: 'string', description: 'Device code from list_devices, e.g. "d3"' };

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const int = (v: unknown, min: number, max: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt;

async function deviceOf(ctx: ToolContext, input: Record<string, unknown>): Promise<Client> {
  const mac = ctx.refs.macOf(input.device);
  if (!mac) throw new ToolInputError(`Unknown device code ${JSON.stringify(input.device)}: call list_devices first.`);
  const client = (await getClients(ctx.conn)).find((c) => c.mac.toUpperCase() === mac);
  if (!client) throw new ToolInputError('That device is no longer known to the router.');
  return client;
}

const applied = (o: ApplyOutcome) =>
  o.status === 'rolled-back'
    ? { done: false, note: 'The router undid the change because the app could not reach it afterwards.' }
    : { done: true };

const deviceView = (c: Client, ctx: ToolContext) => ({
  device: ctx.refs.refOf(c.mac),
  name: nameOut(c.alias ?? c.hostname, ctx.privacy),
  vendor: c.vendor ?? undefined,
  ip: ipOut(c.ipv4, ctx.privacy),
  mac: macOut(c.mac, ctx.privacy),
  online: c.online,
  link: c.connection,
  wifi: c.wifi ? { band: c.wifi.band, signal_dbm: c.wifi.signal } : undefined,
  blocked: c.isBlocked || undefined,
  static_ip: c.isStatic || undefined,
});

export const TOOLS: Tool[] = [
  {
    name: 'get_overview',
    description: 'Router model, firmware, uptime, load, memory, internet (WAN) status and how many devices are online.',
    parameters: object(),
    risk: 'read',
    async run(ctx) {
      const [system, interfaces, clients] = await Promise.all([
        getSystem(ctx.conn),
        getInterfaces(ctx.conn),
        getClients(ctx.conn),
      ]);
      const wan = interfaces.find((i) => i.hasDefaultRoute) ?? interfaces.find((i) => i.name === 'wan');
      const m = system.memory;
      return {
        model: system.model,
        firmware: system.firmware,
        hostname: nameOut(system.hostname, ctx.privacy),
        uptime_hours: Math.round(system.uptimeSec / 360) / 10,
        load_1_5_15: system.load,
        memory_used_percent: m.total ? Math.round(((m.total - m.available) / m.total) * 100) : undefined,
        internet: wan
          ? { interface: wan.name, protocol: wan.proto, up: wan.up, address: ipOut(wan.ipv4[0]?.address, ctx.privacy) }
          : { up: false },
        devices_online: clients.filter((c) => c.online).length,
        devices_known: clients.length,
      };
    },
  },
  {
    name: 'list_devices',
    description:
      'Devices the router knows: a code to refer to each, name, vendor, address, online state, Wi-Fi band and signal, blocked state.',
    parameters: object({ online_only: { type: 'boolean', description: 'Only devices online now' } }),
    risk: 'read',
    async run(ctx, input) {
      const clients = await getClients(ctx.conn);
      return clients.filter((c) => !bool(input.online_only) || c.online).map((c) => deviceView(c, ctx));
    },
  },
  {
    name: 'get_wifi',
    description:
      'Radios (band, channel, width, power, on/off) and their Wi-Fi networks (name, security, hidden, on/off).',
    parameters: object(),
    risk: 'read',
    async run(ctx) {
      return (await getRadios(ctx.conn)).map((r) => ({
        radio: r.name,
        band: r.band,
        channel: r.channel,
        width: r.htmode,
        txpower_dbm: r.txpower,
        enabled: !r.disabled,
        networks: r.networks.map((n) => ({
          ssid: n.ssid,
          security: n.encryption,
          hidden: n.hidden,
          enabled: !n.disabled,
          mode: n.mode,
        })),
      }));
    },
  },
  {
    name: 'get_interfaces',
    description: 'Network interfaces (lan, wan, …): protocol, up/down, addresses, gateway, DNS, uptime.',
    parameters: object(),
    risk: 'read',
    async run(ctx) {
      return (await getInterfaces(ctx.conn)).map((i) => ({
        name: i.name,
        protocol: i.proto,
        up: i.up,
        device: i.device,
        ipv4: i.ipv4.map((a) => ipOut(a.address, ctx.privacy)).filter(Boolean),
        gateway: ipOut(i.gateway, ctx.privacy),
        dns: i.dns.map((d) => ipOut(d, ctx.privacy)).filter(Boolean),
        uptime_hours: Math.round(i.uptimeSec / 360) / 10,
        errors: i.errors.length ? i.errors : undefined,
      }));
    },
  },
  {
    name: 'get_firewall',
    description: 'Port forwards and traffic rules, with their names (needed to remove a port forward).',
    parameters: object(),
    risk: 'read',
    async run(ctx) {
      const fw = await getFirewall(ctx.conn);
      return {
        defaults: fw.defaults,
        port_forwards: fw.forwards.map((f) => ({
          name: f.name,
          protocols: f.protocols,
          external_port: f.externalPort,
          internal_ip: ipOut(f.internalIp, ctx.privacy),
          internal_port: f.internalPort ?? f.externalPort,
          enabled: f.enabled,
        })),
        rules: fw.rules.map((r) => ({
          name: r.name,
          from: r.src ?? 'router',
          to: r.dest ?? 'router',
          protocols: r.protocols,
          port: r.destPort,
          action: r.target,
          enabled: r.enabled,
        })),
      };
    },
  },
  {
    name: 'read_log',
    description: 'The latest system log lines, newest last, optionally only lines containing some text.',
    parameters: object({
      lines: { type: 'integer', description: 'How many lines, 1 to 100 (default 40)' },
      contains: { type: 'string', description: 'Only lines containing this text (case-insensitive)' },
    }),
    risk: 'read',
    async run(ctx, input) {
      if (!ctx.privacy.logs) throw new ToolInputError('The user does not share logs with the assistant.');
      const needle = str(input.contains)?.toLowerCase();
      const lines = (await systemLog(ctx.conn)).filter((l) => !needle || l.text.toLowerCase().includes(needle));
      return lines
        .slice(-int(input.lines, 1, 100, 40))
        .map((l) => scrubText(`${l.time ?? ''} ${l.source ?? ''}: ${l.text}`.trim(), ctx.privacy));
    },
  },
  {
    name: 'list_connections',
    description: 'Live connections through the router, busiest first: protocol, source, destination, port, bytes.',
    parameters: object({ limit: { type: 'integer', description: '1 to 50 (default 20)' } }),
    risk: 'read',
    async run(ctx, input) {
      const list = (await getConnections(ctx.conn)).sort((a, b) => b.bytes - a.bytes);
      return list.slice(0, int(input.limit, 1, 50, 20)).map((c) => ({
        protocol: c.protocol,
        from: ipOut(c.src, ctx.privacy),
        to: ipOut(c.dst, ctx.privacy),
        port: c.dport,
        bytes: c.bytes,
      }));
    },
  },

  // ---- writes: each one waits for the user's confirmation ----

  {
    name: 'reboot_router',
    description: 'Restart the router. Every device loses its connection for one to two minutes.',
    parameters: object(),
    risk: 'medium',
    async run(ctx) {
      await reboot(ctx.conn);
      return { done: true, note: 'The router is restarting; the app will be unreachable for a minute or two.' };
    },
  },
  {
    name: 'kick_device',
    description: 'Disconnect a Wi-Fi device; it may reconnect at once.',
    parameters: object({ device: DEVICE }, ['device']),
    risk: 'medium',
    async run(ctx, input) {
      const client = await deviceOf(ctx, input);
      if (!client.wifi) throw new ToolInputError('Only Wi-Fi devices can be disconnected.');
      await kickClient(ctx.conn, client);
      return { done: true };
    },
  },
  {
    name: 'block_device',
    description: "Block or unblock a device's internet access (it stays on the local network).",
    parameters: object({ device: DEVICE, block: { type: 'boolean', description: 'true to block, false to unblock' } }, [
      'device',
      'block',
    ]),
    risk: 'medium',
    async run(ctx, input) {
      const client = await deviceOf(ctx, input);
      const block = input.block !== false;
      if (block === client.isBlocked) return { done: true, note: block ? 'Already blocked.' : 'Was not blocked.' };
      const outcome = block ? blockClient(ctx.conn, client, ctx.tuning) : unblockClient(ctx.conn, client, ctx.tuning);
      return applied(await outcome);
    },
  },
  {
    name: 'set_wifi',
    description:
      'Change one Wi-Fi network, named by its current SSID: switch it on or off, rename it, or set a new password (8 to 63 characters).',
    parameters: object(
      {
        ssid: { type: 'string', description: 'The network to change, by its current SSID' },
        enabled: { type: 'boolean' },
        new_ssid: { type: 'string' },
        new_password: { type: 'string' },
      },
      ['ssid'],
    ),
    risk: 'medium',
    async run(ctx, input) {
      const radios = await getRadios(ctx.conn);
      const matches = radios.flatMap((r) => r.networks).filter((n) => n.ssid === str(input.ssid));
      if (!matches.length) throw new ToolInputError(`No Wi-Fi network named ${JSON.stringify(input.ssid)}.`);
      const patch = {
        ...(bool(input.enabled) !== undefined ? { disabled: !input.enabled } : {}),
        ...(str(input.new_ssid) ? { ssid: str(input.new_ssid) } : {}),
        ...(str(input.new_password) ? { key: str(input.new_password) } : {}),
      };
      const changes = matches.flatMap((n) => {
        const issues = validateNetwork({
          ssid: patch.ssid ?? n.ssid,
          encryption: n.encryption,
          key: patch.key ?? n.key,
        });
        if (issues.length) throw new ToolInputError(`Not valid: ${issues.join(', ')}.`);
        return networkChanges(n, patch);
      });
      if (!changes.length) return { done: true, note: 'Nothing to change.' };
      return applied(await stageAndApply(ctx.conn, changes, { mode: 'rollback', ...ctx.tuning }));
    },
  },
  {
    name: 'set_radio',
    description: 'Switch a whole radio (all its Wi-Fi networks) on or off.',
    parameters: object({ radio: { type: 'string', description: 'e.g. radio0' }, enabled: { type: 'boolean' } }, [
      'radio',
      'enabled',
    ]),
    risk: 'medium',
    async run(ctx, input) {
      const radio = (await getRadios(ctx.conn)).find((r) => r.name === str(input.radio));
      if (!radio) throw new ToolInputError(`No radio named ${JSON.stringify(input.radio)}.`);
      const changes = radioChanges(radio, { disabled: input.enabled === false });
      if (!changes.length) return { done: true, note: 'Already so.' };
      return applied(await stageAndApply(ctx.conn, changes, { mode: 'rollback', ...ctx.tuning }));
    },
  },
  {
    name: 'add_port_forward',
    description: 'Forward a port from the internet to a device on the local network.',
    parameters: object(
      {
        name: { type: 'string' },
        protocol: { type: 'string', enum: ['tcp', 'udp', 'tcp udp'] },
        external_port: { type: 'string', description: 'Port or range, e.g. "8080" or "6000-6100"' },
        device: DEVICE,
        internal_port: { type: 'string', description: 'Defaults to the external port' },
      },
      ['name', 'protocol', 'external_port', 'device'],
    ),
    risk: 'medium',
    async run(ctx, input) {
      const client = await deviceOf(ctx, input);
      if (!client.ipv4) throw new ToolInputError('That device has no IPv4 address.');
      const forward = {
        name: str(input.name) ?? 'forward',
        protocols: (str(input.protocol) ?? 'tcp')
          .split(/\s+/)
          .filter((p): p is 'tcp' | 'udp' => p === 'tcp' || p === 'udp'),
        srcZone: 'wan',
        externalPort: str(input.external_port) ?? '',
        destZone: 'lan',
        internalIp: client.ipv4,
        internalPort: str(input.internal_port) ?? '',
      };
      const problems = Object.entries(validatePortForward(forward));
      if (problems.length) throw new ToolInputError(`Not valid: ${problems.map(([k, v]) => `${k} ${v}`).join(', ')}.`);
      const taken = forwardConflicts((await getFirewall(ctx.conn)).forwards, forward);
      if (taken.length) throw new ToolInputError(`The port is already forwarded by "${taken[0].name}".`);
      return applied(await stageAndApply(ctx.conn, portForwardChanges(forward), { mode: 'rollback', ...ctx.tuning }));
    },
  },
  {
    name: 'remove_port_forward',
    description: 'Remove a port forward, by its name from get_firewall.',
    parameters: object({ name: { type: 'string' } }, ['name']),
    risk: 'medium',
    async run(ctx, input) {
      const forward = (await getFirewall(ctx.conn)).forwards.find((f) => f.name === str(input.name));
      if (!forward) throw new ToolInputError(`No port forward named ${JSON.stringify(input.name)}.`);
      return applied(
        await stageAndApply(
          ctx.conn,
          [{ object: 'uci', method: 'delete', params: { config: 'firewall', section: forward.section } }],
          { mode: 'rollback', ...ctx.tuning },
        ),
      );
    },
  },
  {
    name: 'restart_service',
    description:
      'Restart one service (init script), e.g. dnsmasq. Services the router needs to stay reachable are refused.',
    parameters: object({ name: { type: 'string' } }, ['name']),
    risk: 'medium',
    async run(ctx, input) {
      const name = str(input.name) ?? '';
      if (isCritical(name))
        throw new ToolInputError(`${name} keeps the router reachable; restart it from the Services page.`);
      if (!(await listServices(ctx.conn)).some((s) => s.name === name)) {
        throw new ToolInputError(`No service named ${JSON.stringify(name)}.`);
      }
      await serviceAction(ctx.conn, name, 'restart');
      return { done: true };
    },
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** Runs a tool and turns the outcome into what the AI reads: privacy rules applied, secrets dropped. */
export async function runTool(
  tool: Tool,
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  if ('__invalid' in input) return { content: 'The arguments were not valid JSON.', isError: true };
  try {
    return { content: JSON.stringify(stripSecrets(await tool.run(ctx, input))) };
  } catch (error) {
    const message =
      error instanceof ToolInputError
        ? error.message
        : `Failed: ${error instanceof Error ? error.message : String(error)}`;
    return { content: message, isError: true };
  }
}
