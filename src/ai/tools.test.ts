import { DemoConnection } from '@/api/connection/demo/connection';
import { getClients } from '@/api/services/clients';
import { getFirewall } from '@/api/services/firewall';
import { getRadios } from '@/api/services/wireless';

import { DEFAULT_PRIVACY, type Privacy } from './redact';
import { DeviceRefs, runTool, toolByName, TOOLS, type ToolContext } from './tools';

const fast = { sleep: async () => {} };

function context(privacy: Partial<Privacy> = {}): ToolContext & { conn: DemoConnection } {
  return {
    conn: new DemoConnection(2026, () => 1_800_000_000_000, 0),
    privacy: { ...DEFAULT_PRIVACY, ...privacy },
    refs: new DeviceRefs(),
    tuning: fast,
  };
}

const call = async (ctx: ToolContext, name: string, input: Record<string, unknown> = {}) => {
  const r = await runTool(toolByName(name)!, ctx, input);
  return { ...r, data: r.isError ? undefined : (JSON.parse(r.content) as unknown) };
};

describe('assistant tools', () => {
  it('describes every tool with a JSON schema and a risk; nothing high-risk is offered', () => {
    for (const t of TOOLS) {
      expect(t.parameters).toMatchObject({ type: 'object' });
      expect(['read', 'medium']).toContain(t.risk);
    }
    const names = TOOLS.map((t) => t.name);
    for (const banned of ['flash_firmware', 'factory_reset', 'restore_backup', 'set_vlan']) {
      expect(names).not.toContain(banned);
    }
  });

  it('lists devices by code, masking MACs, and leaves out what the user keeps private', async () => {
    const ctx = context();
    const { data } = await call(ctx, 'list_devices', { online_only: true });
    const devices = data as { device: string; name?: string; mac?: string; ip?: string }[];
    expect(devices.length).toBeGreaterThan(5);
    expect(devices[0].device).toBe('d1');
    expect(devices.every((d) => /^[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:\*\*:\*\*:\*\*$/.test(d.mac ?? ''))).toBe(true);
    expect(devices.some((d) => d.name)).toBe(true);

    const quiet = context({ names: false, macs: false, ips: false });
    const { data: bare } = await call(quiet, 'list_devices');
    for (const d of bare as Record<string, unknown>[]) {
      expect(d).not.toHaveProperty('name');
      expect(d).not.toHaveProperty('mac');
      expect(d).not.toHaveProperty('ip');
    }
  });

  it('never hands out a Wi-Fi password', async () => {
    const ctx = context();
    const { content } = await call(ctx, 'get_wifi');
    const keys = (await getRadios(ctx.conn)).flatMap((r) => r.networks.map((n) => n.key)).filter(Boolean);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(content).not.toContain(key as string);
  });

  it('masks the public address in the overview', async () => {
    const { data } = await call(context(), 'get_overview');
    expect(data).toMatchObject({ model: 'OpenWrt One', internet: { up: true, address: '203.0.*.*' } });
  });

  it('reads the log only when the user shares it', async () => {
    expect(await call(context({ logs: false }), 'read_log')).toMatchObject({ isError: true });
    const { data } = await call(context(), 'read_log', { lines: 5 });
    expect((data as string[]).length).toBe(5);
  });

  it('acts on a device by its code, and refuses codes it never gave out', async () => {
    const ctx = context();
    expect(await call(ctx, 'block_device', { device: 'd1', block: true })).toMatchObject({ isError: true });
    const devices = (await call(ctx, 'list_devices')).data as { device: string; name?: string }[];
    const target = devices.find((d) => d.name === 'Galaxy-S25')!;
    expect(await call(ctx, 'block_device', { device: target.device, block: true })).toMatchObject({
      data: { done: true },
    });
    expect((await getClients(ctx.conn)).find((c) => c.name === 'Galaxy-S25')?.isBlocked).toBe(true);
  });

  it('adds and removes a port forward for a device', async () => {
    const ctx = context();
    const devices = (await call(ctx, 'list_devices')).data as { device: string; name?: string }[];
    const nas = devices.find((d) => d.name === 'Desk-PC')!;
    const added = await call(ctx, 'add_port_forward', {
      name: 'game',
      protocol: 'udp',
      external_port: '27015',
      device: nas.device,
    });
    expect(added).toMatchObject({ data: { done: true } });
    expect((await getFirewall(ctx.conn)).forwards.some((f) => f.name === 'game')).toBe(true);
    expect(await call(ctx, 'remove_port_forward', { name: 'game' })).toMatchObject({ data: { done: true } });
    expect((await getFirewall(ctx.conn)).forwards.some((f) => f.name === 'game')).toBe(false);
  });

  it('explains bad input instead of guessing', async () => {
    const ctx = context();
    expect(await call(ctx, 'set_wifi', { ssid: 'No-Such-Net', enabled: false })).toMatchObject({
      isError: true,
      content: expect.stringContaining('No Wi-Fi network'),
    });
    expect(await call(ctx, 'restart_service', { name: 'network' })).toMatchObject({ isError: true });
    expect(await runTool(toolByName('reboot_router')!, ctx, { __invalid: '{' })).toMatchObject({ isError: true });
  });
});
