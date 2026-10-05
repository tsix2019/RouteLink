import { DemoConnection } from '@/api/connection/demo/connection';
import { getClients } from '@/api/services/clients';

import { runTurn, systemPrompt, trimHistory, type TurnCallbacks } from './agent';
import { demoProvider } from './providers/demo';
import { DEFAULT_PRIVACY } from './redact';
import { DeviceRefs, type ToolContext } from './tools';
import type { ChatMessage, Provider, ProviderRequest, StreamEvent, ToolCall } from './types';

/** A provider that plays back one scripted answer per request, recording what it was sent. */
function scripted(answers: ((req: ProviderRequest) => { text?: string; calls?: ToolCall[] })[]) {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    async *stream(req): AsyncGenerator<StreamEvent> {
      requests.push({ ...req, messages: [...req.messages] });
      const next = answers[requests.length - 1];
      if (!next) throw new Error('no more answers');
      const a = next(req);
      for (const piece of (a.text ?? '').match(/.{1,4}/gs) ?? []) {
        if (req.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        yield { type: 'text', text: piece };
      }
      const calls = a.calls ?? [];
      yield { type: 'done', stop: calls.length ? 'tool_use' : 'end', calls };
    },
    listModels: async () => [],
  };
  return { provider, requests };
}

function setup(confirm = true) {
  const ctx: ToolContext = {
    conn: new DemoConnection(2026, () => 1_800_000_000_000, 0),
    privacy: DEFAULT_PRIVACY,
    refs: new DeviceRefs(),
    tuning: { sleep: async () => {} },
  };
  const log: string[] = [];
  const callbacks: TurnCallbacks = {
    onText: () => undefined,
    onToolCall: (c, t) => log.push(`call ${c.name}${t ? '' : ' (unknown)'}`),
    onToolResult: (c, r) => log.push(`result ${c.name}${r.isError ? ' error' : ''}`),
    confirm: async (c) => {
      log.push(`confirm ${c.name}`);
      return confirm;
    },
  };
  return { ctx, log, callbacks, signal: new AbortController().signal };
}

const lastResults = (req: ProviderRequest) => {
  const m = req.messages[req.messages.length - 1];
  return m.role === 'user' ? (m.results ?? []) : [];
};

describe('runTurn', () => {
  it('runs read tools at once and answers with what they found', async () => {
    const { provider, requests } = scripted([
      () => ({ text: '我看一下。', calls: [{ id: 'c1', name: 'get_overview', input: {} }] }),
      (req) => {
        const overview = JSON.parse(lastResults(req)[0].content) as { devices_online: number };
        return { text: `现在有 ${overview.devices_online} 台设备在线。` };
      },
    ]);
    const s = setup();
    const out = await runTurn({ provider, system: systemPrompt('zh-CN'), history: [], text: '有几台设备在线？', ...s });
    expect(out.stop).toBe('end');
    expect(s.log).toEqual(['call get_overview', 'result get_overview']);
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect((out.messages[3] as Extract<ChatMessage, { role: 'assistant' }>).text).toMatch(/现在有 \d+ 台设备在线/);
    expect(requests[0].tools.map((t) => t.name)).toContain('reboot_router');
  });

  it('asks before a write, and tells the model when the user declines', async () => {
    const { provider, requests } = scripted([
      () => ({ calls: [{ id: 'c1', name: 'list_devices', input: {} }] }),
      () => ({ calls: [{ id: 'c2', name: 'block_device', input: { device: 'd1', block: true } }] }),
      (req) => ({ text: lastResults(req)[0].isError ? '好的，不改了。' : '已拉黑。' }),
    ]);
    const s = setup(false);
    const out = await runTurn({ provider, system: 's', history: [], text: '把第一台拉黑', ...s });
    expect(s.log).toEqual([
      'call list_devices',
      'result list_devices',
      'call block_device',
      'confirm block_device',
      'result block_device error',
    ]);
    expect(lastResults(requests[2])[0].content).toBe('The user declined this action.');
    expect((await getClients(s.ctx.conn)).some((c) => c.isBlocked && c.mac === s.ctx.refs.macOf('d1'))).toBe(false);
    expect(out.stop).toBe('end');
  });

  it('runs a confirmed write', async () => {
    const { provider } = scripted([
      () => ({ calls: [{ id: 'c1', name: 'list_devices', input: { online_only: true } }] }),
      () => ({ calls: [{ id: 'c2', name: 'block_device', input: { device: 'd2', block: true } }] }),
      () => ({ text: '已拉黑。' }),
    ]);
    const s = setup(true);
    await runTurn({ provider, system: 's', history: [], text: '拉黑 d2', ...s });
    const mac = s.ctx.refs.macOf('d2');
    expect((await getClients(s.ctx.conn)).find((c) => c.mac.toUpperCase() === mac)?.isBlocked).toBe(true);
  });

  it('answers unknown tools with an error and stops after the round limit', async () => {
    const loop = () => ({ calls: [{ id: `c${Math.random()}`, name: 'make_coffee', input: {} }] });
    const { provider } = scripted([loop, loop, loop]);
    const s = setup();
    const out = await runTurn({ provider, system: 's', history: [], text: '?', ...s, maxRounds: 3 });
    expect(out.stop).toBe('rounds');
    expect(s.log.filter((l) => l === 'call make_coffee (unknown)')).toHaveLength(3);
    // Still a valid history: the last tool call has its result.
    expect(out.messages[out.messages.length - 1]).toMatchObject({ role: 'user', results: [{ isError: true }] });
  });

  it('keeps what was said when stopped, closing any open tool call', async () => {
    const controller = new AbortController();
    const { provider } = scripted([
      () => ({ calls: [{ id: 'c1', name: 'reboot_router', input: {} }] }),
      () => ({ text: '这段回答会被打断，后面还有很多字。' }),
    ]);
    const s = setup();
    s.callbacks.confirm = async () => {
      controller.abort();
      return true;
    };
    const out = await runTurn({ provider, system: 's', history: [], text: '重启', ...s, signal: controller.signal });
    expect(out.stop).toBe('stopped');
    expect(out.error).toBeUndefined();
    expect(out.messages[out.messages.length - 1]).toMatchObject({
      role: 'user',
      results: [{ id: 'c1', isError: true }],
    });
  });

  it('trims history at a question, never inside a tool exchange', () => {
    const turn = (i: number): ChatMessage[] => [
      { role: 'user', text: `q${i}` },
      { role: 'assistant', text: '', calls: [{ id: `c${i}`, name: 'get_overview', input: {} }] },
      { role: 'user', text: '', results: [{ id: `c${i}`, content: '{}' }] },
      { role: 'assistant', text: `a${i}`, calls: [] },
    ];
    const all = [1, 2, 3].flatMap(turn);
    const kept = trimHistory(all, 6);
    expect(kept[0]).toEqual({ role: 'user', text: 'q3' });
    expect(kept).toHaveLength(4);
  });
});

describe('demo assistant', () => {
  it('looks things up on the demo router and answers in the app language', async () => {
    const s = setup();
    const out = await runTurn({
      provider: demoProvider('zh-CN'),
      system: 's',
      history: [],
      text: '现在谁在线？',
      ...s,
    });
    expect(s.log).toEqual(['call list_devices', 'result list_devices']);
    const reply = out.messages[out.messages.length - 1] as Extract<ChatMessage, { role: 'assistant' }>;
    expect(reply.text).toMatch(/台设备\*\*在线/);
  });

  it('asks before rebooting', async () => {
    const s = setup(false);
    const out = await runTurn({
      provider: demoProvider('en'),
      system: 's',
      history: [],
      text: 'Please reboot the router',
      ...s,
    });
    expect(s.log).toContain('confirm reboot_router');
    expect((out.messages[out.messages.length - 1] as Extract<ChatMessage, { role: 'assistant' }>).text).toMatch(
      /won't restart/,
    );
  });
});
