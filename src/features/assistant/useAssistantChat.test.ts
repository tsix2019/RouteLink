import { act, renderHook, waitFor } from '@testing-library/react-native';

import { DemoConnection } from '@/api/connection/demo/connection';
import { useAssistant } from '@/state/assistant';

import { useAssistantChat } from './useAssistantChat';

const conversations = () => Object.values(useAssistant.getState().conversations);
// The demo assistant streams its answer in small pieces, like a real one.
const ANSWERED = { timeout: 8_000 };

async function setup() {
  const connection = new DemoConnection(2026, () => 1_800_000_000_000, 0);
  const hook = await renderHook(() => useAssistantChat({ routerId: 'r1', connection, language: 'zh-CN' }));
  const ask = async (text: string) => {
    await act(async () => hook.result.current.send(text));
    await waitFor(() => expect(hook.result.current.busy).toBe(false), ANSWERED);
  };
  return { hook, ask };
}

beforeEach(() => useAssistant.getState().clear());

jest.setTimeout(30_000);

describe('assistant conversations', () => {
  it('starts a conversation with the first question and keeps adding to it', async () => {
    const { hook, ask } = await setup();
    expect(hook.result.current.id).toBeUndefined();
    await ask('哪些设备在线？');
    const id = hook.result.current.id;
    expect(conversations()).toEqual([expect.objectContaining({ id, routerId: 'r1', title: '哪些设备在线？' })]);
    await ask('路由器怎么样？');
    expect(hook.result.current.id).toBe(id);
    expect(hook.result.current.messages.filter((m) => m.role === 'user' && m.text)).toHaveLength(2);
  });

  it('opens a new conversation and goes back to an old one', async () => {
    const { hook, ask } = await setup();
    await ask('哪些设备在线？');
    const first = hook.result.current.id!;
    await act(async () => hook.result.current.newChat());
    expect(hook.result.current.messages).toEqual([]);
    await ask('Wi-Fi 信道合适吗？');
    expect(conversations()).toHaveLength(2);
    await act(async () => hook.result.current.open(first));
    expect(hook.result.current.title).toBe('哪些设备在线？');
  });

  it('answers the last question again in place of its old answer', async () => {
    const { hook, ask } = await setup();
    await ask('哪些设备在线？');
    await ask('路由器怎么样？');
    const before = hook.result.current.messages.length;
    await act(async () => hook.result.current.regenerate());
    await waitFor(() => expect(hook.result.current.busy).toBe(false), ANSWERED);
    const after = hook.result.current.messages;
    expect(after).toHaveLength(before);
    expect(after.filter((m) => m.role === 'user' && m.text).map((m) => m.text)).toEqual([
      '哪些设备在线？',
      '路由器怎么样？',
    ]);
  });
});
