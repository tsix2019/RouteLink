import type { Language } from '../agent';
import type { ChatMessage, Provider, ProviderRequest, StreamEvent, ToolCall } from '../types';

/**
 * Demo mode (design §16): a scripted assistant, no network and no key. It looks things up with the same tools
 * (on the demo router), and asks to reboot when asked to, so the confirmation card can be tried too.
 */

type Json = Record<string, unknown>;

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const has = (text: string, words: RegExp) => words.test(text.toLowerCase());

/** The first move for a question. */
function firstCall(question: string): ToolCall {
  const name = has(question, /重启|reboot|restart/)
    ? 'reboot_router'
    : has(question, /设备|手机|电脑|谁|在线|device|online|who|phone/)
      ? 'list_devices'
      : has(question, /wi-?fi|无线|信号|信道|ssid|wireless|channel|signal/)
        ? 'get_wifi'
        : 'get_overview';
  return { id: `demo_${Date.now().toString(36)}`, name, input: name === 'list_devices' ? { online_only: true } : {} };
}

function answer(lang: Language, tool: string, result: { content: string; isError?: boolean }): string {
  const zh = lang === 'zh-CN';
  const data = parse(result.content);
  if (tool === 'reboot_router') {
    if (result.isError) return zh ? '好的，不重启了。' : "OK, I won't restart it.";
    return zh
      ? '已经让路由器重启，一两分钟后所有设备会自动连回来。'
      : 'The router is restarting. Devices reconnect by themselves in a minute or two.';
  }
  if (tool === 'list_devices' && Array.isArray(data)) {
    const devices = data as Json[];
    const wifi = devices.filter((d) => d.link === 'wifi');
    const names = devices
      .map((d) => d.name)
      .filter(Boolean)
      .slice(0, 5)
      .join(zh ? '、' : ', ');
    const weakest = [...wifi].sort(
      (a, b) => Number((a.wifi as Json)?.signal_dbm ?? 0) - Number((b.wifi as Json)?.signal_dbm ?? 0),
    )[0];
    return zh
      ? `现在有 **${devices.length} 台设备**在线，其中 ${wifi.length} 台用 Wi-Fi，${devices.length - wifi.length} 台用网线。\n\n在线的有：${names} 等。${
          weakest
            ? `\n\n信号最弱的是 ${String(weakest.name ?? weakest.device)}（${String((weakest.wifi as Json)?.signal_dbm)} dBm），离路由器近一点会更稳定。`
            : ''
        }`
      : `**${devices.length} devices** are online: ${wifi.length} on Wi-Fi and ${devices.length - wifi.length} wired.\n\nAmong them: ${names}.${
          weakest
            ? `\n\nThe weakest signal is ${String(weakest.name ?? weakest.device)} (${String((weakest.wifi as Json)?.signal_dbm)} dBm); closer to the router it would be steadier.`
            : ''
        }`;
  }
  if (tool === 'get_wifi' && Array.isArray(data)) {
    const lines = (data as Json[]).map((r) => {
      const nets = ((r.networks as Json[]) ?? []).map((n) => n.ssid).join(zh ? '、' : ', ');
      return zh
        ? `- **${String(r.band)}**：信道 ${String(r.channel)}，${r.enabled ? '开着' : '关着'}，网络：${nets}`
        : `- **${String(r.band)}**: channel ${String(r.channel)}, ${r.enabled ? 'on' : 'off'}, networks: ${nets}`;
    });
    return (zh ? '路由器的无线设置：\n\n' : "The router's Wi-Fi:\n\n") + lines.join('\n');
  }
  const o = (data ?? {}) as Json;
  const internet = (o.internet ?? {}) as Json;
  return zh
    ? `路由器是 **${String(o.model)}**，固件 ${String(o.firmware)}，已经运行 ${String(o.uptime_hours)} 小时。\n\n- 外网：${internet.up ? `正常（${String(internet.protocol)}）` : '没连上'}\n- 在线设备：${String(o.devices_online)} 台\n- 内存用了 ${String(o.memory_used_percent)}%\n\n一切正常。想看看哪些设备在线，或者无线设置吗？`
    : `It's an **${String(o.model)}** running ${String(o.firmware)}, up for ${String(o.uptime_hours)} hours.\n\n- Internet: ${internet.up ? `connected (${String(internet.protocol)})` : 'down'}\n- Devices online: ${String(o.devices_online)}\n- Memory used: ${String(o.memory_used_percent)}%\n\nAll fine. Want to see which devices are online, or the Wi-Fi settings?`;
}

async function* typed(text: string): AsyncGenerator<StreamEvent> {
  for (const piece of text.match(/[\s\S]{1,3}/g) ?? []) {
    await new Promise((r) => setTimeout(r, 18));
    yield { type: 'text', text: piece };
  }
}

export function demoProvider(lang: Language): Provider {
  return {
    async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
      const last = req.messages[req.messages.length - 1] as ChatMessage;
      if (last?.role === 'user' && last.results?.length) {
        const previous = req.messages[req.messages.length - 2];
        const tool = previous?.role === 'assistant' ? (previous.calls[0]?.name ?? '') : '';
        yield* typed(answer(lang, tool, last.results[0]));
        yield { type: 'done', stop: 'end', calls: [] };
        return;
      }
      const question = last?.role === 'user' ? last.text : '';
      const call = firstCall(question);
      const zh = lang === 'zh-CN';
      if (call.name === 'reboot_router') {
        yield* typed(
          zh
            ? '重启会让所有设备断网一两分钟。请在下面确认。'
            : 'Restarting cuts every device off for a minute or two. Please confirm below.',
        );
      }
      yield { type: 'done', stop: 'tool_use', calls: [call] };
    },
    listModels: async () => ['demo'],
  };
}
